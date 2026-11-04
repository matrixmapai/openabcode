import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectTrustStore } from "../src/core/trust-manager.ts";
import { runMcpCommand } from "../src/extensions/mcp/cli.ts";

const FIXTURE = resolve(import.meta.dirname, "./fixtures/mcp-stdio-server.mjs");

describe("openabcode mcp", () => {
	const dirs: string[] = [];

	afterEach(() => {
		while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
	});

	async function run(args: string[], servers: Record<string, unknown> | undefined, dir?: string) {
		const agentDir = dir ?? mkdtempSync(join(tmpdir(), "openabcode-mcp-command-"));
		if (!dir) dirs.push(agentDir);
		if (servers) writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: servers }));
		const output: string[] = [];
		const exitCode = await runMcpCommand(args, {
			cwd: agentDir,
			agentDir,
			log: (line) => output.push(line),
			error: (line) => output.push(line),
		});
		return { exitCode, output: output.join("\n"), agentDir };
	}

	const readConfig = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

	const servers = {
		fixture: { command: process.execPath, args: [FIXTURE] },
		broken: { command: "openabcode-test-missing-mcp-server" },
		parked: { command: process.execPath, args: [FIXTURE], enabled: false },
		bad: { args: ["no command"] },
	};

	it("lists servers with their state, tools, and errors, and fails while anything is wrong", async () => {
		const { exitCode, output } = await run(["list"], servers);
		expect(exitCode).toBe(1);
		expect(output).toContain("fixture: connected, 1 tool (deferred, global)\n");
		expect(output).toContain("  tools: echo");
		expect(output).toContain(
			"broken: failed (deferred, global)\n  openabcode-test-missing-mcp-server\n  spawn openabcode-test-missing-mcp-server ENOENT",
		);
		expect(output).toContain("parked: disabled (deferred, global)");
		expect(output).toContain("config error: ");
		expect(output).toContain('server "bad" needs either "command"');

		const ok = await run(["list"], { fixture: servers.fixture });
		expect(ok.exitCode).toBe(0);
	});

	it("prints JSON for scripts", async () => {
		const { exitCode, output } = await run(["list", "--json"], { fixture: servers.fixture, parked: servers.parked });
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(output) as { servers: { name: string; state: string; tools: string[] }[] };
		expect(parsed.servers.map(({ name, state, tools }) => ({ name, state, tools }))).toEqual([
			{ name: "fixture", state: "connected", tools: ["echo"] },
			{ name: "parked", state: "disabled", tools: [] },
		]);
	});

	it("rejects unknown servers and servers without OAuth for login and logout", async () => {
		expect(await run(["login", "nope"], servers)).toMatchObject({
			exitCode: 1,
			output: 'No MCP server named "nope". Configured: fixture, broken, parked.',
		});
		expect(await run(["logout", "fixture"], servers)).toMatchObject({
			exitCode: 1,
			output: 'MCP server "fixture" does not use OAuth. Only HTTP servers without an Authorization header do.',
		});
		expect((await run(["frobnicate"], servers)).exitCode).toBe(1);
	});

	it("suggests a configured server for a mistyped name", async () => {
		expect((await run(["login", "fixtures"], servers)).output).toBe(
			'No MCP server named "fixtures". Did you mean "fixture"? Configured: fixture, broken, parked.',
		);
	});

	it("reports options as typed", async () => {
		expect((await run(["list", "-l"], servers)).output).toContain("Unknown option -l.");
	});

	it("restricts login and logout to project servers with --local", async () => {
		const { agentDir } = await run(["add", "-l", "local", "--", "node", "server.js"], servers);
		new ProjectTrustStore(agentDir).set(agentDir, true);

		expect(await run(["logout", "-l", "local"], undefined, agentDir)).toMatchObject({
			exitCode: 1,
			output: 'MCP server "local" does not use OAuth. Only HTTP servers without an Authorization header do.',
		});
		expect(await run(["login", "-l", "fixture"], undefined, agentDir)).toMatchObject({
			exitCode: 1,
			output: `MCP server "fixture" is defined in ${join(agentDir, "mcp.json")}, not in the project; omit --local.`,
		});
	});

	it("adds stdio servers and passes options after the command through", async () => {
		const added = await run(
			["add", "--env", "A=1", "--env", "B=x=y", "files", "--", "npx", "-y", "server", "--root", "."],
			undefined,
		);
		expect(added.exitCode).toBe(0);
		expect(added.output).toContain('Added global MCP server "files"');
		expect(readConfig(join(added.agentDir, "mcp.json"))).toEqual({
			mcpServers: {
				files: { command: "npx", args: ["-y", "server", "--root", "."], env: { A: "1", B: "x=y" } },
			},
		});

		// Without `--`, options after the command belong to the command too.
		const replaced = await run(["add", "files", "node", "server.js", "--port", "1"], undefined, added.agentDir);
		expect(replaced.output).toContain('Replaced global MCP server "files"');
		expect(readConfig(join(added.agentDir, "mcp.json"))).toEqual({
			mcpServers: { files: { command: "node", args: ["server.js", "--port", "1"] } },
		});
	});

	it("adds HTTP servers and keeps other content of the file", async () => {
		const { exitCode, output, agentDir } = await run(
			[
				"add",
				"docs",
				"--url",
				"https://example.com/mcp",
				"--bearer-token-env-var",
				"DOCS_TOKEN",
				"--header",
				"X-Team=core",
				"--exposure",
				"direct",
				"--description",
				"Product docs",
			],
			{ fixture: servers.fixture },
		);
		expect(exitCode).toBe(0);
		expect(output).not.toContain("mcp login");
		expect(readConfig(join(agentDir, "mcp.json"))).toEqual({
			mcpServers: {
				fixture: servers.fixture,
				docs: {
					url: "https://example.com/mcp",
					// biome-ignore lint/suspicious/noTemplateCurlyInString: literal config value reference
					headers: { "X-Team": "core", Authorization: "Bearer ${DOCS_TOKEN}" },
					exposure: "direct",
					description: "Product docs",
				},
			},
		});

		const oauth = await run(
			[
				"add",
				"sentry",
				"--url",
				"https://mcp.sentry.dev/mcp",
				"--oauth-client-id",
				"openabcode",
				"--oauth-client-name",
				"Claude Code",
			],
			undefined,
			agentDir,
		);
		expect(oauth.output).toContain("If it requires sign-in: openabcode mcp login sentry");
		expect(readConfig(join(agentDir, "mcp.json")).mcpServers).toMatchObject({
			sentry: { url: "https://mcp.sentry.dev/mcp", oauth: { clientId: "openabcode", clientName: "Claude Code" } },
		});

		await run(
			["add", "linear", "--url", "https://mcp.linear.app/mcp", "--oauth-client-registration", "dcr"],
			undefined,
			agentDir,
		);
		expect(readConfig(join(agentDir, "mcp.json")).mcpServers).toMatchObject({
			linear: { url: "https://mcp.linear.app/mcp", oauth: { clientRegistration: "dcr" } },
		});
	});

	it("rejects invalid add invocations without writing", async () => {
		const cases = [
			["add", "x"],
			["add", "x", "--url", "https://example.com", "--", "cmd"],
			["add", "bad name", "--", "cmd"],
			["add", "x", "--url", "ftp://example.com"],
			["add", "x", "--env", "A=1", "--url", "https://example.com"],
			["add", "x", "--header", "A=1", "--", "cmd"],
			["add", "x", "--env", "NOVALUE", "--", "cmd"],
			["add", "x", "--exposure", "loud", "--", "cmd"],
			["add", "x", "--exposure", "codemode", "--", "cmd"],
			["add", "x", "--url", "https://example.com", "--oauth-client-registration", "maybe"],
		];
		for (const args of cases) {
			const result = await run(args, undefined);
			expect(result.exitCode, args.join(" ")).toBe(1);
			expect(existsSync(join(result.agentDir, "mcp.json"))).toBe(false);
		}
	});

	it("adds and removes project servers", async () => {
		const added = await run(["add", "-l", "local", "--", "node", "server.js"], undefined);
		expect(added.output).toContain("The project is not trusted");
		const projectConfig = join(added.agentDir, ".openabcode", "mcp.json");
		expect(readConfig(projectConfig)).toEqual({ mcpServers: { local: { command: "node", args: ["server.js"] } } });

		const wrongScope = await run(["remove", "local"], undefined, added.agentDir);
		expect(wrongScope.exitCode).toBe(1);
		expect(wrongScope.output).not.toContain(projectConfig);
		new ProjectTrustStore(added.agentDir).set(added.agentDir, true);
		const trustedScope = await run(["remove", "local"], undefined, added.agentDir);
		expect(trustedScope.output).toContain(`It is defined in ${projectConfig}; use --local.`);

		const removed = await run(["remove", "local", "--local"], undefined, added.agentDir);
		expect(removed.exitCode).toBe(0);
		expect(removed.output).toContain('Removed project MCP server "local"');
		expect(readConfig(projectConfig)).toEqual({ mcpServers: {} });
	});

	it.each(["ask", "always", "never"])("uses the same %s trust policy as sessions", async (policy) => {
		const { agentDir } = await run(["help"], undefined);
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: policy }));
		mkdirSync(join(agentDir, ".openabcode"));
		writeFileSync(
			join(agentDir, ".openabcode", "mcp.json"),
			JSON.stringify({ mcpServers: { local: servers.fixture } }),
		);
		const result = await run(["list", "--json"], undefined, agentDir);
		expect(JSON.parse(result.output).servers).toHaveLength(policy === "always" ? 1 : 0);
		const approved = await run(["list", "--json", "--approve"], undefined, agentDir);
		expect(JSON.parse(approved.output).servers).toHaveLength(1);
		expect(new ProjectTrustStore(agentDir).get(agentDir)).toBe(null);
		new ProjectTrustStore(agentDir).set(agentDir, false);
		expect(JSON.parse((await run(["list", "--json"], undefined, agentDir)).output).servers).toHaveLength(0);
	});

	it("does not read untrusted configuration for removal suggestions", async () => {
		const { agentDir } = await run(["help"], undefined);
		mkdirSync(join(agentDir, ".openabcode"));
		writeFileSync(join(agentDir, ".openabcode", "mcp.json"), "not valid JSON");
		const result = await run(["remove", "missing"], undefined, agentDir);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain('No global MCP server named "missing"');
		expect(result.output).not.toContain("JSON");
	});

	it("redacts stderr in JSON diagnostics", async () => {
		const result = await run(["list", "--json"], {
			broken: {
				command: process.execPath,
				args: ["-e", 'console.error("Authorization: Bearer synthetic-stderr-token"); process.exit(1)'],
			},
		});
		expect(result.exitCode).toBe(1);
		expect(result.output).not.toContain("synthetic-stderr-token");
		expect(JSON.parse(result.output).servers[0].error).toContain("[REDACTED]");
	});

	it("preserves trust and help flags after the stdio separator", async () => {
		const result = await run(["add", "-l", "wrapper", "--", "node", "--approve", "--help"], undefined);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("The project is not trusted");
		expect(readConfig(join(result.agentDir, ".openabcode", "mcp.json"))).toEqual({
			mcpServers: { wrapper: { command: "node", args: ["--approve", "--help"] } },
		});
	});

	it("removes global servers", async () => {
		const { exitCode, agentDir } = await run(["remove", "broken"], servers);
		expect(exitCode).toBe(0);
		expect(Object.keys(readConfig(join(agentDir, "mcp.json")).mcpServers as object)).toEqual([
			"fixture",
			"parked",
			"bad",
		]);
		const missing = await run(["remove", "broken"], undefined, agentDir);
		expect(missing).toMatchObject({ exitCode: 1 });
		expect(missing.output).toContain('No global MCP server named "broken"');
	});
});
