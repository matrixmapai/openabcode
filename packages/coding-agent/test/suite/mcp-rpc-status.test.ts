import { LATEST_PROTOCOL_VERSION } from "@earendil-works/pi-mcp";
import { createInMemoryTransportPair } from "@earendil-works/pi-mcp/testing";
import { expect, it, vi } from "vitest";
import type { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { createMcpExtension } from "../../src/extensions/mcp/index.ts";
import { runRpcMode } from "../../src/modes/rpc/rpc-mode.ts";
import { createHarness } from "./harness.ts";

const io = vi.hoisted(() => ({ lines: [] as string[], handler: undefined as ((line: string) => void) | undefined }));
vi.mock("../../src/core/output-guard.ts", () => ({
	takeOverStdout: () => {},
	flushRawStdout: async () => {},
	waitForRawStdoutBackpressure: async () => {},
	writeRawStdout: (line: string) => io.lines.push(line),
}));
vi.mock("../../src/modes/rpc/jsonl.ts", () => ({
	serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
	attachJsonlLineReader: (_stream: unknown, handler: (line: string) => void) => {
		io.handler = handler;
		return () => {};
	},
}));

it("queries live MCP state through RPC and emits pure JSON state changes", async () => {
	const previousSignals = new Map(
		(["SIGTERM", "SIGHUP"] as const).map((signal) => [signal, new Set(process.listeners(signal))]),
	);
	const harness = await createHarness({
		extensionFactories: [
			createMcpExtension({
				loadConfig: () => ({
					servers: [{ name: "rpc", config: { command: "unused" }, source: "test", scope: "global" }],
					errors: [],
				}),
				createTransport: () => {
					const pair = createInMemoryTransportPair();
					pair.server.onMessage((request) => {
						if (!("id" in request) || !("method" in request)) return;
						const result =
							request.method === "initialize"
								? {
										protocolVersion: LATEST_PROTOCOL_VERSION,
										capabilities: { tools: {} },
										serverInfo: { name: "rpc", version: "1" },
									}
								: { tools: [{ name: "run", inputSchema: { type: "object", properties: {} } }] };
						queueMicrotask(() => void pair.server.send({ jsonrpc: "2.0", id: request.id, result }));
					});
					void pair.server.start();
					return pair.client;
				},
			}),
		],
	});
	const host = { session: harness.session, setRebindSession: () => {} } as unknown as AgentSessionRuntime;
	try {
		void runRpcMode(host);
		await vi.waitFor(() => expect(harness.session.getMcpStatus().servers[0]?.state).toBe("connected"));
		io.handler?.(JSON.stringify({ id: "status", type: "get_mcp_status" }));
		await vi.waitFor(() =>
			expect(io.lines.map((line) => JSON.parse(line)).some((record) => record.id === "status")).toBe(true),
		);
		const records = io.lines.map((line) => JSON.parse(line));
		expect(records.find((record) => record.id === "status")).toMatchObject({
			type: "response",
			command: "get_mcp_status",
			success: true,
			data: { servers: [{ name: "rpc", state: "connected", tools: ["run"] }], errors: [], overridden: [] },
		});
		expect(
			records.some((record) => record.type === "mcp_status_change" && record.servers[0]?.state === "connected"),
		).toBe(true);
	} finally {
		await harness.session.dispose();
		harness.cleanup();
		for (const [signal, previous] of previousSignals) {
			for (const listener of process.listeners(signal)) if (!previous.has(listener)) process.off(signal, listener);
		}
		io.handler = undefined;
		io.lines = [];
	}
});
