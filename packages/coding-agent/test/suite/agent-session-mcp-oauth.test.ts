import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, type ToolResultMessage } from "@openabcode/ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuthStorageBackend } from "../../src/core/auth-storage.ts";
import { emitSessionShutdownEvent } from "../../src/core/extensions/runner.ts";
import { runMcpCommand } from "../../src/extensions/mcp/cli.ts";
import type { McpOAuthConfig, McpServerEntry } from "../../src/extensions/mcp/config.ts";
import { createMcpExtension } from "../../src/extensions/mcp/index.ts";
import { McpOAuthCredentialStore } from "../../src/extensions/mcp/oauth.ts";
import { createHarness, createTestUiContext, getMessageText, type Harness } from "./harness.ts";
import { startOAuthMcpServer } from "./mcp-oauth-server.ts";

describe("AgentSession MCP OAuth", () => {
	const cleanups: (() => Promise<void> | void)[] = [];

	afterEach(async () => {
		while (cleanups.length > 0) await cleanups.pop()?.();
	});

	async function setup(
		browser: "follow" | "paste",
		oauth?: McpOAuthConfig,
		options: { mode?: "rpc" | "print"; hasUI?: boolean; loginTimeoutMs?: number; noBrowser?: boolean } = {},
	) {
		const server = await startOAuthMcpServer();
		cleanups.push(server.close);
		const backend = new InMemoryAuthStorageBackend();
		const entry: McpServerEntry = {
			name: "issues",
			config: { url: server.url, exposure: "direct", ...(oauth ? { oauth } : {}) },
			source: "test",
		};
		const notifications: string[] = [];
		const opened: URL[] = [];
		let redirectLocation: Promise<string> | undefined;
		const harness: Harness = await createHarness({
			initialActiveToolNames: [],
			extensionFactories: [
				createMcpExtension({
					loginTimeoutMs: options.loginTimeoutMs,
					loadConfig: () => ({ servers: [entry], errors: [] }),
					credentials: new McpOAuthCredentialStore(backend),
					openUrl: (url) => {
						opened.push(new URL(url));
						if (options.noBrowser) return;
						if (browser === "follow") {
							void fetch(url);
						} else {
							redirectLocation = fetch(url, { redirect: "manual" }).then(
								(response) => response.headers.get("location") ?? "",
							);
						}
					},
				}),
			],
		});
		cleanups.push(async () => {
			await harness.session.dispose();
			harness.cleanup();
		});
		await harness.session.bindExtensions({
			mode: options.mode,
			uiContext:
				options.hasUI === false
					? undefined
					: createTestUiContext({
							notify: (message) => notifications.push(message),
							input: (_title, _placeholder, opts) =>
								browser === "paste"
									? Promise.resolve(redirectLocation)
									: new Promise((resolve) =>
											opts?.signal?.addEventListener("abort", () => resolve(undefined), { once: true }),
										),
						}),
		});
		return { harness, server, notifications, backend, opened };
	}

	async function callWhoami(harness: Harness): Promise<ToolResultMessage> {
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("mcp__issues__whoami", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		const before = harness.session.messages.length;
		await harness.session.prompt("who am i");
		const result = harness.session.messages
			.slice(before)
			.find((message): message is ToolResultMessage => message.role === "toolResult");
		if (!result) throw new Error("no tool result");
		return result;
	}

	it("signs in through the browser, refreshes expired tokens, and signs out", async () => {
		const { harness, server, notifications, backend } = await setup("follow");

		await harness.session.prompt("/mcp");
		expect(notifications).toContain("MCP servers need attention:\n  issues: needs sign-in\nRun /mcp to fix.");
		expect(notifications.at(-1)).toBe("issues: needs sign-in, run /mcp login issues (direct)");

		await harness.session.prompt("/mcp login issues");
		expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
		expect(server.log).toEqual(["401 none", "register", "token code"]);
		expect(backend.withLock((current) => ({ result: current }))).toContain('"access_token": "access-1"');

		expect(getMessageText(await callWhoami(harness))).toBe("token access-1");

		// An expired access token is refreshed without user interaction.
		server.expireAccessTokens();
		expect(getMessageText(await callWhoami(harness))).toBe("token access-2");
		expect(server.log.slice(-3)).toEqual(["401 access-1", "token refresh", "call access-2"]);

		// A token past its expiry is refreshed before the request, without a 401 round trip.
		backend.withLock((current) => {
			const states = JSON.parse(current ?? "{}") as Record<string, { tokensExpireAt?: number }>;
			for (const state of Object.values(states)) state.tokensExpireAt = Date.now() - 1_000;
			return { result: undefined, next: JSON.stringify(states) };
		});
		expect(getMessageText(await callWhoami(harness))).toBe("token access-3");
		expect(server.log.slice(-2)).toEqual(["token refresh", "call access-3"]);

		await harness.session.prompt("/mcp logout issues");
		expect(notifications.at(-1)).toBe('Signed out of MCP server "issues".');
		const result = await callWhoami(harness);
		expect(result.isError).toBe(true);
		expect(getMessageText(result)).toBe('MCP server "issues" requires sign-in. Run /mcp to sign in.');
	});

	it("accepts a pasted redirect URL when the browser cannot reach the callback", async () => {
		const { harness, server, notifications } = await setup("paste");

		await harness.session.prompt("/mcp login");
		expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
		expect(getMessageText(await callWhoami(harness))).toBe("token access-1");
		expect(server.log).toContain("token code");
	});

	async function shutdown(harness: Harness): Promise<number> {
		const start = Date.now();
		await emitSessionShutdownEvent(harness.session.extensionRunner, { type: "session_shutdown", reason: "quit" });
		return Date.now() - start;
	}

	for (const path of ["/.well-known/oauth-authorization-server", "/token"]) {
		it(`cancels a sign-in waiting on ${path} when the session shuts down`, async () => {
			const { harness, server, notifications } = await setup("follow");
			server.stall.add(path);
			const login = harness.session.prompt("/mcp login issues");
			await vi.waitFor(() => expect(server.stalled).toHaveLength(1), { timeout: 5_000 });

			expect(await shutdown(harness)).toBeLessThan(2_000);
			await login;
			await vi.waitFor(() => expect(server.stalled[0]?.request.socket.destroyed).toBe(true));
			expect(notifications.filter((message) => message.startsWith("Sign-in"))).toEqual([]);
		});
	}

	it("closes the session without refreshing an expiring token", async () => {
		const { harness, server, notifications, backend } = await setup("follow");
		await harness.session.prompt("/mcp login issues");
		expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
		backend.withLock((current) => {
			const states = JSON.parse(current ?? "{}") as Record<string, { tokensExpireAt?: number }>;
			for (const state of Object.values(states)) state.tokensExpireAt = Date.now() + 10_000;
			return { result: undefined, next: JSON.stringify(states) };
		});
		server.stall.add("/token");

		expect(await shutdown(harness)).toBeLessThan(2_000);
		expect(server.stalled).toEqual([]);
		expect(server.deletes).toEqual(["access-1"]);
	});

	async function freePort(): Promise<number> {
		return new Promise<number>((resolve) => {
			const probe = createServer().listen(0, "127.0.0.1", () => {
				const address = probe.address() as AddressInfo;
				probe.close(() => resolve(address.port));
			});
		});
	}

	it("uses the configured callback URL and scope", async () => {
		const callbackUrl = `http://localhost:${await freePort()}/callback`;
		const { harness, notifications, opened } = await setup("follow", { callbackUrl, scope: "issues:read" });

		await harness.session.prompt("/mcp login issues");
		expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
		expect(opened[0].searchParams.get("redirect_uri")).toBe(callbackUrl);
		expect(opened[0].searchParams.get("scope")).toBe("issues:read");
		expect(getMessageText(await callWhoami(harness))).toBe("token access-1");
	});

	it("registers with the configured client name or openabcode by default", async () => {
		const { harness, server, notifications } = await setup("follow", { clientName: "Claude Code" });
		await harness.session.prompt("/mcp login issues");
		expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
		expect(server.registrations.map((metadata) => metadata.client_name)).toEqual(["Claude Code"]);

		const fallback = await setup("follow");
		await fallback.harness.session.prompt("/mcp login issues");
		expect(fallback.server.registrations.map((metadata) => metadata.client_name)).toEqual(["openabcode"]);
		expect(fallback.server.registrations.map((metadata) => metadata.application_type)).toEqual(["native"]);
	});

	it("adds the listening port to a callback URL without one", async () => {
		const { harness, notifications, opened } = await setup("follow", { callbackUrl: "http://127.0.0.1/oauth/done" });
		await harness.session.prompt("/mcp login issues");
		expect(notifications.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');
		expect(opened[0].searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/done$/);

		const port = await freePort();
		const fixed = await setup("follow", { callbackUrl: "http://127.0.0.1/oauth/done", callbackPort: port });
		await fixed.harness.session.prompt("/mcp login issues");
		expect(fixed.opened[0].searchParams.get("redirect_uri")).toBe(`http://127.0.0.1:${port}/oauth/done`);
	});

	it("gives up on openabcode mcp login after --timeout, also while the authorization server hangs", async () => {
		const server = await startOAuthMcpServer();
		cleanups.push(server.close);
		const agentDir = mkdtempSync(join(tmpdir(), "openabcode-mcp-login-"));
		cleanups.push(() => rmSync(agentDir, { recursive: true, force: true }));
		writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { issues: { url: server.url } } }));
		const login = async () => {
			const output: string[] = [];
			const exitCode = await runMcpCommand(["login", "issues", "--timeout", "0.5"], {
				cwd: agentDir,
				agentDir,
				credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),
				openUrl: () => {},
				log: (line) => output.push(line),
				error: (line) => output.push(line),
			});
			return { exitCode, output };
		};

		const unapproved = await login();
		expect(unapproved.exitCode).toBe(1);
		expect(unapproved.output.at(-1)).toContain("was cancelled or not completed within");

		server.stall.add("/.well-known/oauth-authorization-server");
		const stalled = await login();
		expect(stalled.exitCode).toBe(1);
		expect(stalled.output.at(-1)).toContain("was cancelled or not completed within");
	});

	it.each([
		{ mode: "rpc" as const, hasUI: true },
		{ mode: "print" as const, hasUI: false },
	])("does not start an interactive MCP login in $mode", async (options) => {
		const { harness, server, opened, notifications } = await setup("follow", undefined, options);
		await harness.session.prompt("/mcp login issues");
		expect(opened).toEqual([]);
		expect(server.registrations).toEqual([]);
		expect(
			[...notifications, ...harness.eventsOfType("message_end").map((event) => getMessageText(event.message))].some(
				(message) => message.includes("openabcode mcp login issues"),
			),
		).toBe(true);
	});

	it("bounds interactive SDK login and closes the callback without approval", async () => {
		const { harness, opened, notifications } = await setup("follow", undefined, {
			loginTimeoutMs: 500,
			noBrowser: true,
		});
		const start = Date.now();
		await harness.session.prompt("/mcp login issues");
		expect(Date.now() - start).toBeLessThan(2000);
		expect(notifications.at(-1)).toBe("Sign-in cancelled.");
		expect(opened).toHaveLength(1);
		const redirect = opened[0].searchParams.get("redirect_uri");
		if (!redirect) throw new Error("no callback URL");
		await expect(fetch(redirect)).rejects.toThrow();
	});

	it("uses credentials from openabcode mcp login on the next turn", async () => {
		const { harness, server, backend } = await setup("follow");
		const agentDir = mkdtempSync(join(tmpdir(), "openabcode-mcp-login-"));
		cleanups.push(() => rmSync(agentDir, { recursive: true, force: true }));
		writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { issues: { url: server.url } } }));

		const output: string[] = [];
		const exitCode = await runMcpCommand(["login", "issues"], {
			cwd: agentDir,
			agentDir,
			credentials: new McpOAuthCredentialStore(backend),
			openUrl: (url) => void fetch(url),
			log: (line) => output.push(line),
			error: (line) => output.push(line),
		});
		expect(exitCode).toBe(0);
		expect(output.at(-1)).toBe('Signed in to MCP server "issues" (1 tools).');

		expect(getMessageText(await callWhoami(harness))).toBe("token access-1");
	});
});
