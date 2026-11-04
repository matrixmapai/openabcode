import { readFileSync, rmSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";
import { createMcpResourceToolDefinitions, type McpResourceServer } from "../src/extensions/mcp/resources.ts";

function server(): McpResourceServer {
	return {
		name: "docs",
		timeoutMs: 1000,
		resourcesPage: async (cursor) => ({
			resources: [{ uri: `docs://${cursor ?? "first"}`, name: cursor ?? "first" }],
			...(cursor ? {} : { nextCursor: "second" }),
		}),
		resourceTemplatesPage: async (cursor) => ({
			resourceTemplates: [{ uriTemplate: `docs://${cursor ?? "first"}/{id}`, name: "template" }],
			...(cursor ? {} : { nextCursor: "second" }),
		}),
		allResources: async () => [
			{ uri: "docs://all", name: "all" },
			{ uri: "ui://view", name: "app" },
		],
		allResourceTemplates: async () => [],
		readResource: async (uri) => ({
			contents:
				uri === "docs://blob"
					? [{ uri, mimeType: "application/octet-stream", blob: Buffer.from("binary fixture").toString("base64") }]
					: [{ uri, mimeType: "text/plain", text: "x".repeat(30000) }],
		}),
	};
}

function tools(servers: () => McpResourceServer[]) {
	return Object.fromEntries(
		createMcpResourceToolDefinitions({ exposure: "direct", servers }).map((definition) => [
			definition.name,
			wrapToolDefinition(definition),
		]),
	);
}

describe("MCP resources", () => {
	it("preserves resource and template pagination cursors", async () => {
		const definitions = tools(() => [server()]);
		for (const name of ["list_mcp_resources", "list_mcp_resource_templates"]) {
			const first = await definitions[name].execute("first", { server: "docs" }, undefined);
			expect(first.structuredContent).toMatchObject({ server: "docs", nextCursor: "second" });
			const second = await definitions[name].execute("second", { server: "docs", cursor: "second" }, undefined);
			expect(second.structuredContent).not.toHaveProperty("nextCursor");
			expect(second.content).toEqual([{ type: "text", text: expect.stringContaining("docs://second") }]);
		}
	});

	it("filters MCP Apps and rejects servers withdrawn from the resource scope", async () => {
		let available = [server()];
		const definitions = tools(() => available);
		const result = await definitions.list_mcp_resources.execute("list", {}, undefined);
		expect(result.structuredContent).toEqual({ resources: [{ server: "docs", uri: "docs://all", name: "all" }] });
		available = [];
		await expect(
			definitions.read_mcp_resource.execute("read", { server: "docs", uri: "docs://all" }, undefined),
		).rejects.toThrow("has no resources");
	});

	it("truncates long resource text and saves binary output with restricted permissions", async () => {
		const definitions = tools(() => [server()]);
		const long = await definitions.read_mcp_resource.execute(
			"long",
			{ server: "docs", uri: "docs://long" },
			undefined,
		);
		const fullOutput = (long.details as { fullOutputPath: string }).fullOutputPath;
		try {
			expect(readFileSync(fullOutput, "utf8")).toHaveLength(30000);
			expect(JSON.stringify(long.content).length).toBeLessThan(25000);
			if (process.platform !== "win32") expect(statSync(fullOutput).mode & 0o777).toBe(0o600);
		} finally {
			rmSync(fullOutput);
		}
		const binary = await definitions.read_mcp_resource.execute(
			"binary",
			{ server: "docs", uri: "docs://blob" },
			undefined,
		);
		const text = binary.content.find((block) => block.type === "text");
		const path = text?.type === "text" ? /saved to (.+)\]$/.exec(text.text)?.[1] : undefined;
		expect(path).toBeDefined();
		if (path) {
			try {
				expect(readFileSync(path, "utf8")).toBe("binary fixture");
				if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
			} finally {
				rmSync(path);
			}
		}
	});
});
