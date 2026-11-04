/**
 * Log messages MCP servers send with `notifications/message`, appended to `mcp.log` in the agent
 * directory. Several openabcode processes may write to the same file, so every message is one
 * synchronous append. The file is rotated to `mcp.log.1` once it grows past `MAX_LOG_BYTES`.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const REDACTED_KEYS = new Set([
	"access_token",
	"refresh_token",
	"client_secret",
	"authorization",
	"api_key",
	"apikey",
	"token",
	"password",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shared redaction for logs, transport failures, and management diagnostics. Never resolves commands. */
export function redactMcpDiagnostic(text: string, secrets: readonly string[] = []): string {
	let redacted = text;
	for (const secret of [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length)) {
		redacted = redacted.replaceAll(secret, "[REDACTED]");
	}
	return redacted
		.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
		.replace(
			/((?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|authorization|token|password)["']?\s*[:=]\s*["']?)[^\s,"'&}]+/gi,
			"$1[REDACTED]",
		)
		.replace(
			/(--(?:bearer-token|access-token|refresh-token|client-secret|api-key|password)\s+)[^\s]+/gi,
			"$1[REDACTED]",
		)
		.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

function redactValue(value: unknown): unknown {
	if (typeof value === "string") {
		return redactMcpDiagnostic(value);
	}
	if (Array.isArray(value)) return value.map(redactValue);
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				REDACTED_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redactValue(entry),
			]),
		);
	}
	return value;
}

function formatData(data: unknown): string {
	const sanitized = redactValue(data);
	if (typeof sanitized === "string") return sanitized;
	try {
		return JSON.stringify(sanitized) ?? String(sanitized);
	} catch {
		return String(sanitized);
	}
}

/** Format one `notifications/message` from `server` as a log line; continuation lines are indented. */
export function formatMcpLogMessage(server: string, params: unknown, now: Date = new Date()): string {
	const message = isRecord(params) ? params : { data: params };
	const level = typeof message.level === "string" ? message.level : "info";
	const logger = typeof message.logger === "string" && message.logger ? ` ${message.logger}:` : "";
	const text = formatData(message.data).replace(/\r?\n/g, "\n    ");
	return redactMcpDiagnostic(`${now.toISOString()} [${server}] ${level}${logger} ${text}\n`);
}

/** Appends server log messages to one file. Write errors are ignored: logging must not break tools. */
export class McpServerLog {
	readonly path: string;
	private size: number | undefined;

	constructor(path: string) {
		this.path = path;
	}

	write(server: string, params: unknown, redact: (text: string) => string = redactMcpDiagnostic): void {
		const line = redact(formatMcpLogMessage(server, params));
		try {
			if (this.size === undefined) {
				mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
				this.size = this.currentSize();
			}
			if (this.size > MAX_LOG_BYTES) {
				// Another process may have rotated it already; check before renaming.
				if (this.currentSize() > MAX_LOG_BYTES) renameSync(this.path, `${this.path}.1`);
				this.size = this.currentSize();
			}
			appendFileSync(this.path, line, { mode: 0o600 });
			this.size += Buffer.byteLength(line);
		} catch {
			// Ignore: the log is best effort.
		}
	}

	private currentSize(): number {
		try {
			return statSync(this.path).size;
		} catch {
			return 0;
		}
	}
}
