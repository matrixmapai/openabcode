import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type JsonRpcMessage,
	LATEST_PROTOCOL_VERSION,
	McpAuthRequiredError,
	McpHttpError,
	McpSessionExpiredError,
} from "@earendil-works/pi-mcp";
import { createInMemoryTransportPair, type InMemoryTransport } from "@earendil-works/pi-mcp/testing";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryAuthStorageBackend } from "../src/core/auth-storage.ts";
import { truncateMiddle } from "../src/core/tools/truncate.ts";
import {
	addMcpServerConfig,
	getMcpToolExposure,
	loadMcpConfig,
	type McpServerEntry,
	updateMcpServerConfig,
} from "../src/extensions/mcp/config.ts";
import { MAX_SERVERS_SECTION_CHARS, renderServersSection } from "../src/extensions/mcp/index.ts";
import {
	createDefaultTransport,
	ManagedStdioTransport,
	McpOAuthCredentialStore,
	McpServerConnection,
	McpServerLog,
} from "../src/extensions/mcp/runtime.ts";
import { convertMcpResult, createMcpResultSchema, createMcpToolName } from "../src/extensions/mcp/tools.ts";

// Config values are resolved at connect time, so the literal reference must survive loading.
// biome-ignore lint/suspicious/noTemplateCurlyInString: literal config value reference
const TOKEN_HEADER = "Bearer ${TOKEN}";
const EXITING_PARENT_FIXTURE = resolve(import.meta.dirname, "./fixtures/mcp-exiting-parent-server.mjs");

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return true;
}

describe("MCP config", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function setup(global: unknown, project: unknown) {
		const root = mkdtempSync(join(tmpdir(), "openabcode-mcp-config-"));
		dirs.push(root);
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(cwd, ".openabcode"), { recursive: true });
		writeFileSync(join(agentDir, "mcp.json"), JSON.stringify(global));
		writeFileSync(join(cwd, ".openabcode", "mcp.json"), JSON.stringify(project));
		return { agentDir, cwd };
	}

	it("merges global and trusted project servers and validates entries", () => {
		const paths = setup(
			{
				mcpServers: {
					shared: { command: "global-cmd" },
					remote: { url: "https://example.com/mcp", headers: { Authorization: TOKEN_HEADER } },
					off: { command: "x", enabled: false },
					bad: { args: ["no command"] },
					legacy: { type: "sse", url: "https://example.com/sse" },
					badUrl: { url: "example.com/mcp" },
					"bad name": { command: "x" },
				},
			},
			{ mcpServers: { shared: { command: "project-cmd", exposure: "direct" } } },
		);

		const trusted = loadMcpConfig({ ...paths, projectTrusted: true });
		// Disabled servers are kept so /mcp can enable them again.
		expect(trusted.servers.map((server) => [server.name, server.scope, server.config])).toEqual([
			["shared", "project", { command: "project-cmd", exposure: "direct" }],
			["remote", "global", { url: "https://example.com/mcp", headers: { Authorization: TOKEN_HEADER } }],
			["off", "global", { command: "x", enabled: false }],
		]);
		expect(trusted.errors).toHaveLength(4);
		expect(trusted.errors[0]).toContain('server "bad" needs either "command"');
		expect(trusted.errors[1]).toContain("legacy SSE transport is not supported");
		expect(trusted.errors[2]).toContain('server "badUrl": url must be an http or https URL');
		expect(trusted.errors[3]).toContain('invalid server name "bad name"');

		// Untrusted projects cannot add or override servers, since stdio servers run commands.
		const untrusted = loadMcpConfig({ ...paths, projectTrusted: false });
		expect(untrusted.servers.find((server) => server.name === "shared")?.config).toEqual({ command: "global-cmd" });
	});

	it("lets project entries override enabled and exposure of global servers", () => {
		const paths = setup(
			{ mcpServers: { tools: { command: "x", env: { TOKEN: "secret" } } } },
			// An override cannot change the command, which would run with the global env.
			{ mcpServers: { tools: { enabled: false, args: ["y"] }, missing: { enabled: false } } },
		);
		const project = join(paths.cwd, ".openabcode", "mcp.json");
		const { servers, errors } = loadMcpConfig({ ...paths, projectTrusted: true });
		expect(servers.map((server) => [server.name, server.override, server.config])).toEqual([
			["tools", undefined, { command: "x", env: { TOKEN: "secret" } }],
		]);
		expect(errors).toEqual([
			expect.stringContaining('server "tools": an override can only set enabled, exposure, toolExposure'),
			expect.stringContaining('server "missing" needs "command" or "url", or a global server to override'),
		]);

		writeFileSync(project, JSON.stringify({ mcpServers: { tools: { enabled: false } } }));
		const [tools] = loadMcpConfig({ ...paths, projectTrusted: true }).servers;
		expect([tools.override, tools.config]).toEqual([
			project,
			{ command: "x", env: { TOKEN: "secret" }, enabled: false },
		]);

		// Overrides keep `enabled: true`, since it replaces the global value.
		updateMcpServerConfig(project, "tools", { enabled: true });
		expect(JSON.parse(readFileSync(project, "utf8")).mcpServers.tools).toEqual({ enabled: true });
	});

	it("reads and edits mcp.json files that start with a UTF-8 BOM", () => {
		const paths = setup({}, {});
		const global = join(paths.agentDir, "mcp.json");
		const project = join(paths.cwd, ".openabcode", "mcp.json");
		writeFileSync(global, '\uFEFF{"mcpServers":{"demo":{"command":"echo","enabled":false}}}\n');
		writeFileSync(project, '\uFEFF{"mcpServers":{"local":{"command":"local-cmd"}}}\n');

		const loaded = loadMcpConfig({ ...paths, projectTrusted: true });
		expect(loaded.errors).toEqual([]);
		expect(loaded.servers.map((server) => [server.name, server.scope])).toEqual([
			["demo", "global"],
			["local", "project"],
		]);

		expect(addMcpServerConfig(global, "other", { command: "other-cmd" })).toBe(false);
		expect(JSON.parse(readFileSync(global, "utf8")).mcpServers).toEqual({
			demo: { command: "echo", enabled: false },
			other: { command: "other-cmd" },
		});
	});

	it("rejects server names that differ only in - and _", () => {
		const paths = setup({ mcpServers: { "work-files": { command: "a" }, work_files: { command: "b" } } }, {});
		const { servers, errors } = loadMcpConfig({ ...paths, projectTrusted: false });
		expect(servers.map((server) => server.name)).toEqual(["work-files"]);
		expect(errors).toEqual([expect.stringContaining('server "work_files" conflicts with "work-files"')]);
	});

	it("validates exposure and rejects unsupported modes like codemode", () => {
		const paths = setup(
			{
				mcpServers: {
					later: { command: "x", exposure: "deferred" },
					directServer: { command: "x", exposure: "direct" },
					off: { command: "x", exposure: "hidden" },
					scripts: { command: "x", exposure: "codemode" },
					wrong: { command: "x", exposure: "model-only" },
					described: { command: "x", description: "Docs search" },
					badDescription: { command: "x", description: 1 },
				},
			},
			{},
		);

		const loaded = loadMcpConfig({ ...paths, projectTrusted: false });
		expect(loaded.servers.map((server) => [server.name, server.config.exposure])).toEqual([
			["later", "deferred"],
			["directServer", "direct"],
			["off", "hidden"],
			["described", undefined],
		]);
		expect(loaded.servers[3].config.description).toBe("Docs search");
		expect(loaded.errors).toEqual([
			expect.stringContaining('server "scripts": exposure must be one of "deferred", "direct", "hidden"'),
			expect.stringContaining('server "wrong": exposure must be one of "deferred", "direct", "hidden"'),
			expect.stringContaining('server "badDescription": description must be a string'),
		]);
	});

	it("validates the OAuth callback URL, scope, and client name", () => {
		const paths = setup(
			{
				mcpServers: {
					ok: {
						url: "https://a.example/mcp",
						oauth: { callbackUrl: "http://localhost:8080/callback", scope: "a b" },
					},
					ipv6: { url: "https://a.example/mcp", oauth: { callbackUrl: "http://[::1]/cb", callbackPort: 9000 } },
					same: { url: "https://a.example/mcp", oauth: { callbackUrl: "http://127.0.0.1:2/cb", callbackPort: 2 } },
					remote: { url: "https://a.example/mcp", oauth: { callbackUrl: "https://example.com/callback" } },
					both: { url: "https://a.example/mcp", oauth: { callbackUrl: "http://127.0.0.1:1/cb", callbackPort: 2 } },
					scope: { url: "https://a.example/mcp", oauth: { scope: ["a"] } },
					named: { url: "https://a.example/mcp", oauth: { clientName: "Claude Code" } },
					unnamed: { url: "https://a.example/mcp", oauth: { clientName: " " } },
					metadata: { url: "https://a.example/mcp", oauth: { authServerMetadataUrl: "https://idp.example/m" } },
					plainMetadata: {
						url: "https://a.example/mcp",
						oauth: { authServerMetadataUrl: "http://idp.example/m" },
					},
					auto: { url: "https://a.example/mcp", oauth: { clientRegistration: "auto", clientName: "x" } },
					dcr: { url: "https://a.example/mcp", oauth: { clientRegistration: "dcr" } },
					cimd: { url: "https://a.example/mcp", oauth: { clientRegistration: "cimd" } },
					badRegistration: { url: "https://a.example/mcp", oauth: { clientRegistration: "oidc" } },
				},
			},
			{},
		);
		const { servers, errors } = loadMcpConfig({ ...paths, projectTrusted: false });
		expect(servers.map((server) => server.name)).toEqual(["ok", "ipv6", "same", "named", "metadata", "auto", "dcr"]);
		expect(errors).toEqual([
			expect.stringContaining('server "remote": oauth.callbackUrl must be an http URI on localhost'),
			expect.stringContaining('server "both": oauth.callbackUrl and oauth.callbackPort name different ports'),
			expect.stringContaining('server "scope": oauth.scope must be a string'),
			expect.stringContaining('server "unnamed": oauth.clientName must be a non-empty string'),
			expect.stringContaining('server "plainMetadata": oauth.authServerMetadataUrl must be an https URL'),
			expect.stringContaining('server "cimd": oauth.clientRegistration must be "auto" or "dcr"'),
			expect.stringContaining('server "badRegistration": oauth.clientRegistration must be "auto" or "dcr"'),
		]);
	});

	it("resolves per-tool exposure from exact names, then patterns in order, defaulting to deferred", () => {
		const paths = setup(
			{
				mcpServers: {
					gh: {
						command: "x",
						exposure: "deferred",
						toolExposure: { "get_*": "direct", get_me: "hidden", "*delete*": "hidden", "get_file.*": "direct" },
					},
					bad: { command: "x", toolExposure: { a: "visible" } },
				},
			},
			{},
		);
		const { servers, errors } = loadMcpConfig({ ...paths, projectTrusted: false });
		expect(errors).toEqual([expect.stringContaining('server "bad": toolExposure "a" must be one of')]);
		const config = servers[0].config;
		expect(getMcpToolExposure(config, "get_me")).toBe("hidden");
		expect(getMcpToolExposure(config, "get_issue")).toBe("direct");
		expect(getMcpToolExposure(config, "get_delete_hint")).toBe("direct");
		expect(getMcpToolExposure(config, "delete_repo")).toBe("hidden");
		expect(getMcpToolExposure(config, "list_issues")).toBe("deferred");
		// Only `*` is special, and default exposure is `deferred`.
		expect(getMcpToolExposure({ command: "x", toolExposure: { "get_file.*": "direct" } }, "get_file_x")).toBe(
			"deferred",
		);
	});

	it("rejects forwarding provider credentials via auth", () => {
		const paths = setup(
			{
				mcpServers: {
					radius: { url: "https://radius.example/mcp", auth: { provider: "openabcode" } },
				},
			},
			{},
		);
		const { servers, errors } = loadMcpConfig({ ...paths, projectTrusted: false });
		expect(servers).toEqual([]);
		expect(errors).toEqual([
			expect.stringContaining('server "radius": forwarding provider credentials via "auth" is not supported'),
		]);
	});
});

describe("MCP tools", () => {
	it("creates provider-safe tool names", () => {
		expect(createMcpToolName("docs", "search")).toBe("mcp__docs__search");
		expect(createMcpToolName("my-server", "get.item/v2")).toBe("mcp__my_server__get_item_v2");
		const long = createMcpToolName("server", "x".repeat(100));
		expect(long).toHaveLength(64);
		expect(long).toMatch(/^mcp__server__x+_[0-9a-f]{8}$/);
		expect(createMcpToolName("server", `${"x".repeat(100)}y`)).not.toBe(long);
		// Names that sanitize to one already taken by another tool get a hash suffix.
		const taken = createMcpToolName("s", "a_b");
		const second = createMcpToolName("s", "a-b", (name) => name === taken);
		expect(second).toMatch(/^mcp__s__a_b_[0-9a-f]{8}$/);
	});

	it("keeps references in the server's output schema", () => {
		expect(createMcpResultSchema(undefined)).toMatchObject({
			type: "object",
			required: ["content"],
			properties: {
				structuredContent: {},
				isError: { type: "boolean" },
			},
		});

		const hit = { type: "object", properties: { id: { type: "string" } }, required: ["id"] };
		const schema = createMcpResultSchema({
			type: "object",
			properties: {
				hits: { type: "array", items: { $ref: "#/$defs/Hit~1v1" } },
				again: { $ref: "#/properties/hits" },
				children: { type: "array", items: { $ref: "#" } },
				default: { $ref: "#/definitions/Hit" },
				remote: { $ref: "https://example.com/schema.json" },
			},
			required: ["hits"],
			$defs: { "Hit/v1": { ...hit, default: { $ref: "#/stays" } } },
			definitions: { Hit: hit },
		}) as unknown as {
			properties: {
				structuredContent: {
					properties: Record<string, { $ref?: string; items?: { $ref?: string } }>;
					$defs: Record<string, { default: unknown }>;
				};
			};
		};
		expect(schema.properties.structuredContent.$defs["Hit/v1"].default).toEqual({ $ref: "#/stays" });
		expect(schema.properties.structuredContent.properties.hits.items?.$ref).toBe(
			"#/properties/structuredContent/$defs/Hit~1v1",
		);
		expect(schema.properties.structuredContent.properties.again.$ref).toBe(
			"#/properties/structuredContent/properties/hits",
		);
		expect(schema.properties.structuredContent.properties.children.items?.$ref).toBe(
			"#/properties/structuredContent",
		);
		expect(schema.properties.structuredContent.properties.remote.$ref).toBe("https://example.com/schema.json");
	});

	it("converts results, preserving structuredContent and flagging errors", async () => {
		const blocks = [
			{ type: "resource_link" as const, uri: "file:///a", name: "a" },
			{ type: "resource" as const, resource: { uri: "file:///b", text: "b text" } },
			{ type: "audio" as const, data: "", mimeType: "audio/wav" },
		];
		expect(
			await convertMcpResult("docs", "t", {
				content: blocks,
				structuredContent: { ok: true },
				_meta: { trace: "x" },
			}),
		).toEqual({
			content: [
				{ type: "text", text: '[Resource file:///a "a"]' },
				{ type: "text", text: "b text" },
				{ type: "text", text: "[audio audio/wav omitted]" },
			],
			details: { server: "docs", tool: "t" },
			structuredContent: { content: blocks, structuredContent: { ok: true } },
		});
		expect((await convertMcpResult("docs", "t", { content: [], structuredContent: { n: 1 } })).content).toEqual([
			{ type: "text", text: '{\n  "n": 1\n}' },
		]);
		expect(await convertMcpResult("docs", "t", { content: [], structuredContent: [{ id: 1 }] })).toEqual({
			content: [{ type: "text", text: '[\n  {\n    "id": 1\n  }\n]' }],
			details: { server: "docs", tool: "t" },
			structuredContent: { content: [], structuredContent: [{ id: 1 }] },
		});
		expect(await convertMcpResult("docs", "t", { content: [{ type: "text", text: "nope" }], isError: true })).toEqual(
			{
				content: [{ type: "text", text: "nope" }],
				details: { server: "docs", tool: "t" },
				structuredContent: { content: [{ type: "text", text: "nope" }], isError: true },
				isError: true,
			},
		);
		expect((await convertMcpResult("docs", "t", { content: [], isError: true })).content).toEqual([
			{ type: "text", text: "MCP tool docs/t returned an error" },
		]);
	});

	it("points resource links to read_mcp_resource and saves binary resources", async () => {
		const saved: [string | Uint8Array, string][] = [];
		const saveOutput = async (data: string | Uint8Array, extension: string) => {
			saved.push([data, extension]);
			return `/tmp/saved${extension}`;
		};
		const converted = await convertMcpResult(
			"docs",
			"t",
			{
				content: [
					{
						type: "resource_link",
						uri: "docs://guide",
						name: "guide",
						title: "The Guide",
						mimeType: "text/markdown",
						size: 2048,
						description: "How to use it",
					},
					{
						type: "resource",
						resource: { uri: "file:///r/report.pdf", mimeType: "application/pdf", blob: "JVBERg==" },
					},
					{ type: "resource", resource: { uri: "docs://logo", mimeType: "image/png", blob: "AAAA" } },
				],
			},
			{ saveOutput, readableResources: true },
		);
		expect(converted.content).toEqual([
			{
				type: "text",
				text: '[Resource docs://guide "The Guide" (text/markdown, 2.0KB): How to use it. Read it with read_mcp_resource (server "docs")]',
			},
			{ type: "text", text: "[Binary resource file:///r/report.pdf (application/pdf, 4B) saved to /tmp/saved.pdf]" },
			{ type: "image", data: "AAAA", mimeType: "image/png" },
		]);
		expect(saved).toEqual([[Buffer.from("%PDF"), ".pdf"]]);
	});

	it("cuts the middle of model-facing text over 20KB and keeps the full result", async () => {
		const saved: (string | Uint8Array)[] = [];
		const saveOutput = async (data: string | Uint8Array) => {
			saved.push(data);
			return "/tmp/full.txt";
		};
		const lines = Array.from({ length: 3000 }, (_, index) => `line ${index + 1}`);
		const full = lines.join("\n");
		const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
		const result = { content: [{ type: "text" as const, text: full }, image] };
		const converted = await convertMcpResult("docs", "snapshot", result, { saveOutput });
		expect(converted.content).toHaveLength(2);
		const text = (converted.content[0] as { text: string }).text;
		expect(text).toMatch(
			new RegExp(
				`^Warning: truncated output \\(original token count: ${Math.ceil(full.length / 4)}\\)\nTotal output lines: 3000\n\nline 1\nline 2\n`,
			),
		);
		expect(text).toMatch(/…\d+ chars truncated…/);
		expect(text.endsWith("line 3000\n\n[Full output: /tmp/full.txt (read it with offset/limit)]")).toBe(true);
		expect(Buffer.byteLength(text)).toBeLessThan(21 * 1024);
		expect(converted.content[1]).toEqual(image);
		expect(converted.details).toEqual({ server: "docs", tool: "snapshot", fullOutputPath: "/tmp/full.txt" });
		expect(saved).toEqual([full]);
		expect(converted.structuredContent).toEqual(result);

		// Text within the limit is not saved.
		await convertMcpResult("docs", "small", { content: [{ type: "text", text: "ok" }] }, { saveOutput });
		expect(saved).toHaveLength(1);
	});

	it("cuts multi-byte text only at character boundaries", () => {
		const text = `${"é".repeat(20_000)}end`;
		const result = truncateMiddle(text, 1001);
		expect(result.truncated).toBe(true);
		expect(result.content).not.toContain("\uFFFD");
		expect(result.content.endsWith("end")).toBe(true);
		const [head, tail] = result.content.split(/…\d+ chars truncated…/);
		expect(Buffer.byteLength(head)).toBeLessThanOrEqual(500);
		expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(501);
		expect(Array.from(head).length + Array.from(tail).length + result.removedChars).toBe(Array.from(text).length);
	});
});

describe("MCP connections", () => {
	const servers: InMemoryTransport[] = [];

	/** In-memory server that answers initialize, tools/list, and tools/call with "ok". */
	function createTransport(
		options: {
			expireFirstCall?: boolean;
			methods?: string[];
			noTools?: boolean;
			resources?: boolean;
			withdrawn?: boolean;
		} = {},
	) {
		const pair = createInMemoryTransportPair();
		servers.push(pair.server);
		pair.server.onMessage((message) => {
			if (!("id" in message) || !("method" in message)) return;
			options.methods?.push(message.method);
			const response: JsonRpcMessage =
				message.method === "initialize"
					? {
							jsonrpc: "2.0",
							id: message.id,
							result: {
								protocolVersion: LATEST_PROTOCOL_VERSION,
								capabilities: {
									...(options.noTools ? { prompts: {} } : { tools: {} }),
									...(options.resources ? { resources: {} } : {}),
								},
								serverInfo: { name: "fake", version: "1.0.0" },
							},
						}
					: message.method === "tools/list"
						? options.noTools
							? { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } }
							: {
									jsonrpc: "2.0",
									id: message.id,
									result: {
										tools: options.withdrawn
											? []
											: [{ name: "echo", inputSchema: { type: "object", properties: {} } }],
									},
								}
						: message.method === "resources/read"
							? { jsonrpc: "2.0", id: message.id, result: { contents: [{ uri: "docs://a", text: "ok" }] } }
							: { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "ok" }] } };
			queueMicrotask(() => void pair.server.send(response));
		});
		void pair.server.start();
		if (options.expireFirstCall) {
			const send = pair.client.send.bind(pair.client);
			pair.client.send = async (message: JsonRpcMessage) => {
				if ("method" in message && message.method === "tools/call") throw new McpSessionExpiredError("gone");
				return send(message);
			};
		}
		return pair.client;
	}

	function connect(
		entry: McpServerEntry,
		transports: (() => ReturnType<typeof createTransport>)[],
		log?: McpServerLog,
	) {
		let opened = 0;
		const connection = new McpServerConnection({
			entry,
			cwd: process.cwd(),
			createTransport: () => transports[opened++](),
			credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),
			log,
			onTools: () => {},
		});
		return { connection, opened: () => opened };
	}

	it("starts a new session and retries once when the session expired", async () => {
		const { connection, opened } = connect({ name: "fake", config: { command: "unused" }, source: "test" }, [
			() => createTransport({ expireFirstCall: true }),
			() => createTransport(),
		]);
		const results = await Promise.all([connection.callTool("echo", {}, {}), connection.callTool("echo", {}, {})]);
		expect(results).toEqual([
			{ content: [{ type: "text", text: "ok" }] },
			{ content: [{ type: "text", text: "ok" }] },
		]);
		expect(opened()).toBe(2);
		await connection.close();
	});

	it("does not execute a withdrawn tool during an expired-session retry", async () => {
		const methods: string[] = [];
		const { connection, opened } = connect({ name: "fake", config: { command: "unused" }, source: "test" }, [
			() => createTransport({ expireFirstCall: true }),
			() => createTransport({ withdrawn: true, methods }),
		]);
		await expect(connection.callTool("echo", {}, {})).rejects.toThrow("no longer available");
		expect(opened()).toBe(2);
		expect(methods).not.toContain("tools/call");
		await connection.close();
	});

	it("redacts unlabelled configured secrets from connection errors", async () => {
		const { connection } = connect(
			{
				name: "fake",
				config: { url: "https://unused.invalid", headers: { "X-Secret": "synthetic-config-secret" } },
				source: "test",
			},
			[
				() => {
					throw new Error("server echoed synthetic-config-secret");
				},
			],
		);
		await expect(connection.getClient()).rejects.toThrow("server echoed [REDACTED]");
		expect(connection.error).not.toContain("synthetic-config-secret");
		await connection.close();
	});

	it.skipIf(process.platform === "win32")(
		"expands ~ in the command, arguments, and cwd of stdio servers",
		async () => {
			const home = mkdtempSync(join(tmpdir(), "openabcode-mcp-home-"));
			const previousHome = process.env.HOME;
			process.env.HOME = home;
			mkdirSync(join(home, "work"));
			writeFileSync(
				join(home, "server.mjs"),
				`import { createInterface } from "node:readline";
for await (const line of createInterface({ input: process.stdin })) {
	const message = JSON.parse(line);
	if (!("id" in message)) continue;
	const result = message.method === "initialize"
		? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "cwd", version: "1" } }
		: message.method === "tools/list"
			? { tools: [{ name: "cwd", inputSchema: { type: "object" } }] }
			: { content: [{ type: "text", text: process.cwd() }] };
	process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
}`,
			);
			const connection = new McpServerConnection({
				entry: {
					name: "home",
					config: { command: process.execPath, args: ["~/server.mjs"], cwd: "~/work" },
					source: "test",
				},
				cwd: tmpdir(),
				createTransport: createDefaultTransport,
				credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),
				onTools: () => {},
			});
			try {
				const result = await connection.callTool("cwd", {}, {});
				expect(realpathSync((result.content[0] as { text: string }).text)).toBe(realpathSync(join(home, "work")));
			} finally {
				await connection.close();
				process.env.HOME = previousHome;
				rmSync(home, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(process.platform === "win32")(
		"kills children still holding the pipes after the server process exited",
		async () => {
			const transport = new ManagedStdioTransport({
				command: process.execPath,
				args: [EXITING_PARENT_FIXTURE],
				closeTimeoutMs: 100,
			});
			let closeEvents = 0;
			transport.onClose(() => closeEvents++);
			await transport.start();
			const serverPid = transport.pid as number;
			let helper: number | undefined;
			await waitFor(() => {
				const match = /helper (\d+)/.exec(transport.stderr);
				if (match) helper = Number(match[1]);
				return helper !== undefined;
			});
			expect(helper).toBeTypeOf("number");
			expect(await waitFor(() => !isAlive(serverPid))).toBe(true);
			try {
				expect(isAlive(helper as number)).toBe(true);

				await transport.close();
				expect(await waitFor(() => !isAlive(helper as number))).toBe(true);
				expect(closeEvents).toBe(1);
			} finally {
				try {
					process.kill(helper as number, "SIGKILL");
				} catch {}
			}
		},
		10_000,
	);

	it("connects to servers without the tools capability without listing tools", async () => {
		const methods: string[] = [];
		const { connection } = connect({ name: "fake", config: { command: "unused" }, source: "test" }, [
			() => createTransport({ noTools: true, methods }),
		]);
		await connection.getClient();
		expect(connection.state).toBe("connected");
		expect(connection.tools).toEqual([]);
		expect(methods).toEqual(["initialize"]);
		await connection.close();
	});

	it("marks a dropped connection and reconnects on the next call", async () => {
		const { connection, opened } = connect({ name: "fake", config: { command: "unused" }, source: "test" }, [
			() => createTransport(),
			() => createTransport(),
		]);
		await connection.getClient();
		await servers.at(-1)?.close();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(connection.state).toBe("disconnected");
		expect(connection.error).toBe("Connection closed");
		expect(await connection.callTool("echo", {}, {})).toEqual({ content: [{ type: "text", text: "ok" }] });
		expect(connection.state).toBe("connected");
		expect(opened()).toBe(2);
		await connection.close();
	});

	it("retries HTTP connections that fail with a transient error", async () => {
		const { connection, opened } = connect(
			{ name: "fake", config: { url: "http://unused.invalid", headers: { Authorization: "x" } }, source: "test" },
			[
				() => {
					const transport = createTransport();
					transport.send = async () => {
						throw new McpHttpError(503, "MCP HTTP request failed with status 503");
					};
					return transport;
				},
				() => createTransport(),
			],
		);
		await connection.getClient();
		expect(connection.state).toBe("connected");
		expect(opened()).toBe(2);
		await connection.close();

		const failing = connect(
			{ name: "fake", config: { url: "http://unused.invalid", headers: { Authorization: "x" } }, source: "test" },
			[
				() => {
					const transport = createTransport();
					transport.send = async () => {
						throw new McpHttpError(400, "MCP HTTP request failed with status 400: bad");
					};
					return transport;
				},
			],
		);
		await expect(failing.connection.getClient()).rejects.toThrow("status 400: bad");
		expect(failing.connection.state).toBe("failed");
		expect(failing.opened()).toBe(1);
	});

	it("closes a connection that is still initializing before close returns", async () => {
		const pair = createInMemoryTransportPair();
		const initializing = new Promise<void>((resolve) => {
			pair.server.onMessage(() => resolve());
		});
		void pair.server.start();
		let transportClosed = false;
		pair.client.onClose(() => {
			transportClosed = true;
		});
		const { connection } = connect({ name: "fake", config: { command: "unused" }, source: "test" }, [
			() => pair.client,
		]);
		let failure: unknown;
		void connection.getClient().catch((error) => {
			failure = error;
		});
		await initializing;
		await connection.close();
		expect(transportClosed).toBe(true);
		expect(String(failure)).toContain("failed to connect");
	});

	it("stops waiting to retry a connection when closed", async () => {
		const { connection } = connect(
			{ name: "fake", config: { url: "http://unused.invalid", headers: { Authorization: "x" } }, source: "test" },
			[
				() => {
					const transport = createTransport();
					transport.send = async () => {
						throw new McpHttpError(503, "MCP HTTP request failed with status 503");
					};
					return transport;
				},
			],
		);
		let failure: unknown;
		void connection.getClient().catch((error) => {
			failure = error;
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		await connection.close();
		expect(String(failure)).toContain("status 503");
	});

	it("retries resource reads, but not tool calls, after a transient HTTP error", async () => {
		const transport = createTransport();
		const send = transport.send.bind(transport);
		const failed = new Set<string>();
		transport.send = async (message) => {
			const method = "method" in message ? message.method : "";
			if ((method === "resources/read" || method === "tools/call") && !failed.has(method)) {
				failed.add(method);
				throw new McpHttpError(502, "MCP HTTP request failed with status 502");
			}
			return send(message);
		};
		const { connection } = connect({ name: "fake", config: { command: "unused" }, source: "test" }, [
			() => transport,
		]);
		expect(await connection.readResource("docs://a", {})).toEqual({ contents: [{ uri: "docs://a", text: "ok" }] });
		await expect(connection.callTool("echo", {}, {})).rejects.toThrow("status 502");
		await connection.close();
	});

	it("asks OAuth servers that keep rejecting requests for a new sign-in", async () => {
		const { connection } = connect({ name: "fake", config: { url: "http://unused.invalid" }, source: "test" }, [
			() => {
				const transport = createTransport();
				transport.send = async () => {
					throw new McpAuthRequiredError(new Response(null, { status: 401 }));
				};
				return transport;
			},
		]);
		await expect(connection.getClient()).rejects.toThrow('MCP server "fake" requires sign-in. Run /mcp to sign in.');
		expect(connection.state).toBe("needs-auth");
		await connection.close();
	});

	it("appends server log messages to the log file and redacts credentials", async () => {
		const dir = mkdtempSync(join(tmpdir(), "openabcode-mcp-log-"));
		try {
			const path = join(dir, "mcp.log");
			const { connection } = connect(
				{
					name: "fake",
					config: { command: "unused", env: { API_TOKEN: "synthetic-unlabelled-secret" } },
					source: "test",
				},
				[() => createTransport()],
				new McpServerLog(path),
			);
			await connection.getClient();
			const server = servers.at(-1);
			await server?.send({
				jsonrpc: "2.0",
				method: "notifications/message",
				params: { level: "warning", logger: "db", data: "slow\nquery Bearer secret-token-123" },
			});
			await server?.send({
				jsonrpc: "2.0",
				method: "notifications/message",
				params: {
					level: "error",
					data: { code: 7, access_token: "topsecret", note: "synthetic-unlabelled-secret" },
				},
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			const lines = readFileSync(path, "utf8").replace(/^\S+ /gm, "");
			expect(lines).toBe(
				'[fake] warning db: slow\n    query Bearer [REDACTED]\n[fake] error {"code":7,"access_token":"[REDACTED]","note":"[REDACTED]"}\n',
			);
			await connection.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("resolves the OAuth client secret lazily", async () => {
		const { connection } = connect(
			{
				name: "fake",
				config: { url: "http://unused.invalid", oauth: { clientSecret: "!exit 1" } },
				source: "test",
			},
			[() => createTransport()],
		);
		expect(await connection.callTool("echo", {}, {})).toEqual({ content: [{ type: "text", text: "ok" }] });
		expect(() => connection.oauthSettings()).toThrow("oauth.clientSecret");
		await connection.close();
	});

	it("connects to servers with resources without listing them", async () => {
		const methods: string[] = [];
		const { connection } = connect({ name: "fake", config: { command: "unused" }, source: "test" }, [
			() => createTransport({ resources: true, methods }),
		]);
		await connection.getClient();
		expect(connection.state).toBe("connected");
		expect(connection.hasResources).toBe(true);
		expect(methods).toEqual(["initialize", "tools/list"]);
		await connection.close();
	});
});

describe("MCP servers section", () => {
	const server = (name: string, description?: string, exposure?: "deferred" | "direct") => ({
		entry: {
			name,
			config: { command: "x", ...(description ? { description } : {}), ...(exposure ? { exposure } : {}) },
			source: "test",
		},
	});

	it("lists servers with how their tools are reached and the first line of their description", () => {
		const section = renderServersSection([
			server("docs", "Docs search.\nMore."),
			server("later", undefined, "deferred"),
			server("direct", "Declared.", "direct"),
			{ entry: server("plain").entry, connection: { instructions: "From instructions." } },
		]);
		expect(section?.split("\n").slice(1)).toEqual([
			"- mcp__docs (tool_search): Docs search.",
			"- mcp__later (tool_search)",
			"- mcp__plain (tool_search): From instructions.",
		]);
		expect(renderServersSection([server("direct", "Declared.", "direct")])).toBeUndefined();
	});

	it("shortens descriptions to fit the size limit", () => {
		const servers = Array.from({ length: 40 }, (_, index) => server(`server${index}`, "x".repeat(400)));
		const section = renderServersSection(servers) ?? "";
		expect(section.length).toBeLessThanOrEqual(MAX_SERVERS_SECTION_CHARS);
		expect(section.split("\n")).toHaveLength(41);
		expect(section).toContain("- mcp__server39 (tool_search): x");
	});

	it("leaves out the last servers when their names alone do not fit", () => {
		const servers = Array.from({ length: 200 }, (_, index) => server(`server-with-a-long-name-${index}`, "desc"));
		const section = renderServersSection(servers) ?? "";
		expect(section.length).toBeLessThanOrEqual(MAX_SERVERS_SECTION_CHARS);
		const lines = section.split("\n");
		expect(lines.at(-1)).toMatch(/^- … \d+ more servers; find their tools with tool_search$/);
		const omitted = Number(/(\d+) more/.exec(lines.at(-1) ?? "")?.[1]);
		expect(lines.length - 2 + omitted).toBe(200);
	});
});
