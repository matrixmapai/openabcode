import type { InlineExtension } from "../core/extensions/types.ts";
import mcpExtension from "./mcp/index.ts";
import toolSearchExtension from "./tool-search/index.ts";

export function getBuiltInExtensions(options: { noMcp?: boolean } = {}): InlineExtension[] {
	return [
		{ name: "tool-search", factory: toolSearchExtension, hidden: true, replaceable: true },
		...(options.noMcp ? [] : [{ name: "mcp", factory: mcpExtension, hidden: true, replaceable: true }]),
	];
}
