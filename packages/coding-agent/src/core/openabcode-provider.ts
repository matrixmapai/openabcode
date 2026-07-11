/**
 * OpenABCode hosted gateway provider.
 *
 * Registers the "openabcode" provider backed by the OpenABCode hosted gateway
 * (LiteLLM proxy, OpenAI-compatible). Auth is a bearer token issued by the
 * OpenABCode web API, resolved from $OPENABCODE_API_KEY or auth.json
 * (via `/login openabcode`). Each hosted model carries the
 * x-openabcode-upstream-provider header expected by the gateway.
 */

import type { ModelRegistry } from "./model-registry.ts";

export const OPENABCODE_PROVIDER = "openabcode";

const DEFAULT_BASE_URL = "https://gateway.openabcode.com/v1";

/** Hosted model id -> upstream provider routed by the gateway. */
export const OPENABCODE_HOSTED_UPSTREAM: Record<string, "openai" | "anthropic" | "google"> = {
	"gpt-5.4": "openai",
	"claude-haiku-4-5": "anthropic",
	"gemini-3.5-flash": "google",
};

export function openabcodeGatewayBaseUrl(): string {
	const fromEnv = process.env.OPENABCODE_BASE_URL ?? process.env.OPENABCODE_API_BASE_URL;
	return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_BASE_URL;
}

export function registerOpenABCodeProvider(registry: ModelRegistry): void {
	registry.registerProvider(OPENABCODE_PROVIDER, {
		name: "OpenABCode Hosted",
		baseUrl: openabcodeGatewayBaseUrl(),
		apiKey: "$OPENABCODE_API_KEY",
		api: "openai-completions",
		models: Object.entries(OPENABCODE_HOSTED_UPSTREAM).map(([id, upstream]) => ({
			id,
			name: `${id} (hosted)`,
			reasoning: false,
			input: ["text", "image"] as ("text" | "image")[],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200_000,
			maxTokens: 16_384,
			headers: {
				"x-openabcode-upstream-provider": upstream,
				"x-openabcode-billing-mode": "openabcode-managed",
			},
		})),
	});
}
