import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type JsonRpcRequest, LATEST_PROTOCOL_VERSION } from "@earendil-works/pi-mcp";
import { createInMemoryTransportPair } from "@earendil-works/pi-mcp/testing";
import { fauxAssistantMessage, fauxToolCall } from "@openabcode/ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionFactory } from "../../src/core/extensions/types.ts";
import type { McpServerEntry } from "../../src/extensions/mcp/config.ts";
import { createMcpExtension } from "../../src/extensions/mcp/index.ts";
import { createToolSearchExtension } from "../../src/extensions/tool-search/index.ts";
import { createTestExtensionsResult } from "../utilities.ts";
import { createHarness, getMessageText, getToolResult, type Harness } from "./harness.ts";

const tools = [{ name: "run", description: "Run audit task", inputSchema: { type: "object", properties: {} } }];

function fixture(list: () => unknown[], calls: string[]) {
	const pair = createInMemoryTransportPair();
	pair.server.onMessage((message) => {
		if (!("id" in message) || !("method" in message)) return;
		const request = message as JsonRpcRequest;
		let result: unknown;
		if (request.method === "initialize") {
			result = {
				protocolVersion: LATEST_PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: "audit", version: "1" },
			};
		} else if (request.method === "tools/list") result = { tools: list() };
		else {
			calls.push(request.method);
			result = { content: [{ type: "text", text: "executed" }] };
		}
		queueMicrotask(() => void pair.server.send({ jsonrpc: "2.0", id: request.id, result }));
	});
	void pair.server.start();
	return pair;
}

describe("MCP lifecycle, reachability, and structured status", () => {
	const harnesses: Harness[] = [];
	afterEach(async () => {
		while (harnesses.length) {
			const harness = harnesses.pop();
			if (harness) {
				await harness.session.dispose();
				harness.cleanup();
			}
		}
	});

	async function setup(
		options: { exposure?: "direct" | "deferred"; list?: () => unknown[]; extensions?: ExtensionFactory[] } = {},
	) {
		const calls: string[] = [];
		const pairs: ReturnType<typeof fixture>[] = [];
		let closed = 0;
		const entry: McpServerEntry = {
			name: "audit",
			config: { command: "unused", exposure: options.exposure ?? "direct" },
			source: "mcp.json",
			scope: "global",
		};
		const harness = await createHarness({
			extensionFactories: [
				...(options.extensions ?? []),
				createToolSearchExtension(),
				createMcpExtension({
					loadConfig: () => ({ servers: [entry], errors: [] }),
					createTransport: () => {
						const pair = fixture(options.list ?? (() => tools), calls);
						pair.client.onClose(() => closed++);
						pairs.push(pair);
						return pair.client;
					},
				}),
			],
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({});
		await vi.waitFor(() => expect(harness.session.getMcpStatus().servers[0]?.state).toBe("connected"));
		return { harness, pairs, calls, closed: () => closed };
	}

	async function call(harness: Harness, args: Record<string, unknown> = {}) {
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("mcp__audit__run", args)], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("run");
		return getToolResult(harness, "mcp__audit__run");
	}

	it("rejects a withdrawn tool after reconnect before sending tools/call", async () => {
		let current: unknown[] = tools;
		const { harness, pairs, calls } = await setup({ list: () => current });
		current = [];
		await pairs[0].server.close();
		const result = await call(harness);
		expect(result.isError).toBe(true);
		expect(getMessageText(result)).toContain("no longer available");
		expect(calls).toEqual([]);
		expect(harness.session.getActiveToolNames()).not.toContain("mcp__audit__run");
	});

	it("validates against the replacement schema after reconnect", async () => {
		let current: unknown[] = tools;
		const { harness, pairs, calls } = await setup({ list: () => current });
		current = [
			{
				...tools[0],
				inputSchema: { type: "object", properties: { approval: { const: "yes" } }, required: ["approval"] },
			},
		];
		await pairs[0].server.close();
		expect((await call(harness)).isError).toBe(true);
		expect(calls).toEqual([]);
	});

	it("awaits MCP shutdown exactly once on direct SDK disposal", async () => {
		const { harness, closed } = await setup();
		await Promise.all([harness.session.dispose(), harness.session.dispose()]);
		expect(closed()).toBe(1);
		expect(harness.session.getMcpStatus()).toEqual({ servers: [], errors: [], overridden: [] });
	});

	it("reconnects after reload even when extensions were bound without a UI", async () => {
		const { harness, pairs, closed } = await setup();
		// The real loader recreates extension factories on reload; preserve that behavior here.
		const serverConfig: McpServerEntry = {
			name: "audit",
			config: { command: "unused", exposure: "direct" },
			source: "test",
		};
		const next = await createTestExtensionsResult([
			createMcpExtension({
				loadConfig: () => ({ servers: [serverConfig], errors: [] }),
				createTransport: () => {
					const pair = fixture(() => tools, []);
					pairs.push(pair);
					return pair.client;
				},
			}),
		]);
		vi.spyOn(harness.session.resourceLoader, "getExtensions").mockImplementation(() => next);
		await harness.session.reload();
		await vi.waitFor(() => expect(pairs).toHaveLength(2));
		expect(closed()).toBe(1);
	});

	it("exposes file and registered servers, emits changes, and returns isolated snapshots", async () => {
		let api: ExtensionAPI | undefined;
		const { harness } = await setup({
			extensions: [
				(extension) => {
					api = extension;
					extension.registerMcpServer("plugin", { command: "unused" });
				},
			],
		});
		await vi.waitFor(() =>
			expect(harness.session.getMcpStatus().servers.every((server) => server.state === "connected")).toBe(true),
		);
		const snapshot = harness.session.getMcpStatus();
		expect(snapshot.servers.map((server) => [server.name, server.scope])).toEqual([
			["audit", "global"],
			["plugin", "extension"],
		]);
		expect(api?.getMcpStatus()).toEqual(snapshot);
		snapshot.servers[0].tools.length = 0;
		expect(harness.session.getMcpStatus().servers[0].tools).toEqual(["run"]);
		expect(
			harness
				.eventsOfType("mcp_status_change")
				.some((event) => event.servers.some((server) => server.state === "connected")),
		).toBe(true);
	});

	it("reports tool-list refresh failures while connected and clears them after recovery", async () => {
		const { harness, pairs } = await setup();
		const transport = pairs[0].client;
		const send = transport.send.bind(transport);
		transport.send = async (message) => {
			if ("method" in message && message.method === "tools/list") throw new Error("refresh failed");
			return send(message);
		};
		await pairs[0].server.send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
		await vi.waitFor(() =>
			expect(harness.session.getMcpStatus().servers[0]).toMatchObject({
				state: "connected",
				error: "Failed to refresh tools: refresh failed",
			}),
		);
		transport.send = send;
		await pairs[0].server.send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
		await vi.waitFor(() => expect(harness.session.getMcpStatus().servers[0].error).toBeUndefined());
	});

	it("keeps a hundred deferred schemas out of the initial request and preserves existing tools when loading", async () => {
		const { harness } = await setup({
			exposure: "deferred",
			list: () => Array.from({ length: 100 }, (_, index) => ({ ...tools[0], name: `task_${index}` })),
		});
		expect(harness.session.getAllTools().filter((tool) => tool.name.startsWith("mcp__audit__"))).toHaveLength(100);
		expect(harness.session.getActiveToolNames().filter((name) => name.startsWith("mcp__"))).toEqual([]);
		harness.setResponses([
			(context) => {
				expect(context.tools?.filter((tool) => tool.name.startsWith("mcp__"))).toEqual([]);
				return fauxAssistantMessage([fauxToolCall("tool_search", { query: "task_42", limit: 1 })], {
					stopReason: "toolUse",
				});
			},
			(context) => {
				expect(context.tools?.filter((tool) => tool.name.startsWith("mcp__")).map((tool) => tool.name)).toEqual([
					"mcp__audit__task_42",
				]);
				return fauxAssistantMessage([fauxToolCall("mcp__audit__task_42", {})], { stopReason: "toolUse" });
			},
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("find a task");
		expect(harness.session.getActiveToolNames()).toEqual(
			expect.arrayContaining(["read", "bash", "tool_search", "mcp__audit__task_42"]),
		);
		expect(getToolResult(harness, "mcp__audit__task_42").isError).toBe(false);
	});

	it("honors a non-interactive permission rejection without calling the server", async () => {
		const { harness, calls } = await setup({
			extensions: [
				(api) =>
					api.on("tool_call", (event) =>
						event.toolName.startsWith("mcp__") ? { block: true, reason: "Approval required" } : undefined,
					),
			],
		});
		const result = await call(harness);
		expect(result.isError).toBe(true);
		expect(getMessageText(result)).toContain("Approval required");
		expect(calls).toEqual([]);
	});

	it("loads SDK MCP configuration from the explicitly supplied agent directory", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		expect(harness.session.getMcpStatus()).toEqual({ servers: [], errors: [], overridden: [] });
		const agentDir = join(harness.tempDir, "isolated-agent");
		mkdirSync(agentDir);
		writeFileSync(
			join(agentDir, "mcp.json"),
			JSON.stringify({ mcpServers: { isolated: { command: "unused", exposure: "direct" } } }),
		);
		const isolated = await createHarness({
			extensionFactories: [createMcpExtension({ agentDir, createTransport: () => fixture(() => tools, []).client })],
		});
		harnesses.push(isolated);
		await isolated.session.bindExtensions({});
		await vi.waitFor(() => expect(isolated.session.getMcpStatus().servers[0]?.state).toBe("connected"));
		expect(isolated.session.getMcpStatus().servers[0].source).toBe(join(agentDir, "mcp.json"));
	});
});
