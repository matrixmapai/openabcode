import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type OAuthChallenge, OAuthIssuerMismatchError } from "@earendil-works/pi-mcp/oauth";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryAuthStorageBackend } from "../src/core/auth-storage.ts";
import {
	createMcpAuthProvider,
	McpOAuthCredentialStore,
	type McpOAuthSettings,
	type McpSignInPrompt,
	signInMcpServer,
} from "../src/extensions/mcp/oauth.ts";
import { startOAuthMcpServer } from "./suite/mcp-oauth-server.ts";

describe("MCP OAuth refresh", () => {
	const cleanups: (() => Promise<void> | void)[] = [];

	afterEach(async () => {
		while (cleanups.length > 0) await cleanups.pop()?.();
	});

	async function signedIn() {
		const server = await startOAuthMcpServer();
		cleanups.push(server.close);
		const lockDir = mkdtempSync(join(tmpdir(), "openabcode-mcp-refresh-"));
		cleanups.push(() => rmSync(lockDir, { recursive: true, force: true }));
		// Stores sharing the credential file and lock directory stand in for separate processes.
		const backend = new InMemoryAuthStorageBackend();
		const process = () => {
			const store = new McpOAuthCredentialStore(backend, lockDir).forServer("test", server.url);
			const provider = createMcpAuthProvider({
				serverUrl: server.url,
				store,
				settings: () => ({}),
				onChallenge: () => {},
			});
			return { store, provider };
		};
		await signInMcpServer({
			serverUrl: server.url,
			store: process().store,
			settings: {},
			prompt: {
				showAuthorizationUrl: (url) => void fetch(url),
				promptForRedirectUrl: (signal) =>
					new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true })),
			},
		});
		return { server, lockDir, process };
	}

	it("refreshes once when several processes find the same token rejected", async () => {
		const { server, lockDir, process } = await signedIn();
		server.expireAccessTokens();
		const processes = [process(), process(), process()];

		// The server rotates refresh tokens: a second refresh with refresh-1 would fail with invalid_grant.
		await Promise.all(
			processes.map(({ provider }) =>
				provider.onUnauthorized?.({
					response: new Response(null, { status: 401 }),
					serverUrl: new URL(server.url),
					fetch: globalThis.fetch,
					token: "access-1",
				}),
			),
		);

		expect(server.log.filter((entry) => entry === "token refresh")).toHaveLength(1);
		for (const { provider } of processes) expect(await provider.token()).toBe("access-2");
		// The lock is released.
		expect(readdirSync(lockDir)).toEqual([]);
	});

	it("waits for a running refresh to save the new tokens", async () => {
		const { server, process } = await signedIn();
		server.expireAccessTokens();
		const { store, provider } = process();

		const refresh = provider.onUnauthorized?.({
			response: new Response(null, { status: 401 }),
			serverUrl: new URL(server.url),
			fetch: globalThis.fetch,
			token: "access-1",
		});
		await provider.settled();
		expect((await store.load())?.tokens?.access_token).toBe("access-2");
		await refresh;
	});
});

describe("MCP OAuth sign-in", () => {
	async function signIn(options: { iss?: string }, settings: (serverUrl: string) => McpOAuthSettings = () => ({})) {
		const server = await startOAuthMcpServer(options);
		try {
			await signInMcpServer({
				serverUrl: server.url,
				store: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()).forServer("test", server.url),
				settings: settings(server.url),
				prompt: {
					showAuthorizationUrl: (url) => void fetch(url),
					promptForRedirectUrl: (signal) =>
						new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true })),
				},
			});
		} finally {
			await server.close();
		}
	}

	it("rejects an authorization response from another issuer", async () => {
		await expect(signIn({ iss: "https://attacker.example" })).rejects.toBeInstanceOf(OAuthIssuerMismatchError);
	});

	it("keeps the granted scope when the server asks for more", async () => {
		const server = await startOAuthMcpServer();
		try {
			const store = new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()).forServer("test", server.url);
			const opened: URL[] = [];
			const signInWith = (challenge: OAuthChallenge) =>
				signInMcpServer({
					serverUrl: server.url,
					store,
					settings: {},
					challenge,
					prompt: {
						showAuthorizationUrl: (url) => {
							opened.push(url);
							void fetch(url);
						},
						promptForRedirectUrl: (signal) =>
							new Promise((resolve) =>
								signal.addEventListener("abort", () => resolve(undefined), { once: true }),
							),
					},
				});

			await signInWith({ scope: "issues:read" });
			expect((await store.load())?.tokens?.scope).toBe("issues:read");
			await signInWith({ error: "insufficient_scope", scope: "issues:write" });
			expect(opened.map((url) => url.searchParams.get("scope"))).toEqual([
				"issues:read",
				"issues:read issues:write",
			]);
			expect((await store.load())?.tokens?.scope).toBe("issues:read issues:write");
		} finally {
			await server.close();
		}
	});

	it("uses the configured authorization server metadata URL", async () => {
		const settings = (serverUrl: string) => ({ authServerMetadataUrl: new URL("/missing", serverUrl) });
		await expect(signIn({}, settings)).rejects.toThrow("HTTP 404 loading authorization server metadata");
	});
});

describe("MCP OAuth client registration", () => {
	const cleanups: (() => Promise<void>)[] = [];

	afterEach(async () => {
		while (cleanups.length > 0) await cleanups.pop()?.();
	});

	async function startServer(options: { issParameter?: boolean; redirectPath?: string } = {}) {
		const server = await startOAuthMcpServer(options);
		cleanups.push(server.close);
		const store = new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()).forServer("test", server.url);
		const browser: McpSignInPrompt = {
			showAuthorizationUrl: (url) => void fetch(url),
			promptForRedirectUrl: (signal) =>
				new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true })),
		};
		const signIn = (settings: McpOAuthSettings, prompt = browser) =>
			signInMcpServer({ serverUrl: server.url, store, settings, prompt });
		return { server, store, signIn };
	}

	it("registers dynamically with openabcode client_name by default, never using pi.dev CIMD", async () => {
		const { server, store, signIn } = await startServer({ issParameter: true });
		await signIn({});
		expect(server.registrations).toMatchObject([{ client_name: "openabcode" }]);
		expect(server.authorizations[0].get("client_id")).toBe("client-1");
		expect((await store.load())?.clientInformation?.client_id).toBe("client-1");

		// Signing in again refreshes the registered client's tokens.
		await signIn({});
		expect(server.authorizations).toHaveLength(1);
		expect(server.tokenRequests[1].get("grant_type")).toBe("refresh_token");
		expect(server.tokenRequests[1].get("client_id")).toBe("client-1");
	});

	it("registers dynamically with a configured client name", async () => {
		const { server, signIn } = await startServer({ issParameter: true });
		await signIn({ clientName: "Claude Code" });
		expect(server.registrations).toMatchObject([{ client_name: "Claude Code" }]);
	});

	it("accepts a pasted redirect URL only when it matches the redirect URI and state", async () => {
		const { signIn: signInByPaste } = await startServer();
		let shown: URL | undefined;
		const paste: McpSignInPrompt = {
			showAuthorizationUrl: (url) => {
				shown = url;
			},
			promptForRedirectUrl: async () => {
				const redirect = new URL(shown?.searchParams.get("redirect_uri") ?? "");
				redirect.pathname = "/wrong-callback";
				redirect.search = `?code=code-1&state=${shown?.searchParams.get("state")}`;
				return redirect.href;
			},
		};
		await expect(signInByPaste({}, paste)).rejects.toThrow("does not match this sign-in's redirect URI");
	});
});
