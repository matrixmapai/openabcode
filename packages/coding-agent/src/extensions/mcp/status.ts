import type { McpServerStatus } from "../../core/mcp-servers.ts";
import { getMcpToolExposure, type McpServerEntry } from "./config.ts";
import { redactMcpDiagnostic } from "./log.ts";
import type { McpServerConnection } from "./runtime.ts";

/** One credential-free snapshot, used by shell commands and the session manager alike. */
export function createMcpServerStatus(
	entry: McpServerEntry,
	connection?: McpServerConnection,
	message?: string,
): McpServerStatus {
	const enabled = entry.config.enabled !== false;
	const exposure = entry.config.exposure ?? "deferred";
	const transport =
		"url" in entry.config ? entry.config.url : [entry.config.command, ...(entry.config.args ?? [])].join(" ");
	const redact = (text: string) => connection?.redactDiagnostic(text) ?? redactMcpDiagnostic(text);
	const overrides = (connection?.tools ?? []).flatMap((tool) => {
		const value = getMcpToolExposure(entry.config, tool.name);
		return value === exposure ? [] : [[tool.name, value] as const];
	});
	const error = message ?? connection?.error;
	return {
		name: entry.name,
		scope: entry.scope ?? "global",
		source: entry.source,
		...(entry.override ? { override: entry.override } : {}),
		enabled,
		exposure,
		transport: redact(transport),
		state: enabled ? (connection?.state ?? "starting") : "disabled",
		tools: connection?.tools.map((tool) => tool.name) ?? [],
		...(overrides.length > 0 ? { toolExposure: Object.fromEntries(overrides) } : {}),
		...(connection?.hasResources ? { resources: true as const } : {}),
		...(error ? { error: redact(error) } : {}),
		...(connection?.challenge?.error === "insufficient_scope" && connection.challenge.scope
			? { requiredScope: connection.challenge.scope }
			: {}),
	};
}
