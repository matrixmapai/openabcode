import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import path from "node:path";

const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const aiSrcCompat = fileURLToPath(new URL("../ai/src/compat.ts", import.meta.url));
const aiSrcOAuth = fileURLToPath(new URL("../ai/src/oauth.ts", import.meta.url));
const aiSrcDir = fileURLToPath(new URL("../ai/src", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));
const tuiSrcIndex = fileURLToPath(new URL("../tui/src/index.ts", import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
		silent: "passed-only",
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
	},
	resolve: {
		alias: [
			{ find: /^@openabcode\/ai$/, replacement: aiSrcIndex },
			{ find: /^@openabcode\/ai\/compat$/, replacement: aiSrcCompat },
			{ find: /^@openabcode\/ai\/oauth$/, replacement: aiSrcOAuth },
			{ find: /^@openabcode\/ai\/(.+)$/, replacement: path.join(aiSrcDir, "$1.ts") },
			{ find: /^@openabcode\/agent-core$/, replacement: agentSrcIndex },
			{ find: /^@openabcode\/tui$/, replacement: tuiSrcIndex },
		],
	},
});
