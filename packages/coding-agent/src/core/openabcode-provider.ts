/**
 * OpenABCode gateway provider.
 *
 * Registers the "openabcode" provider backed by the OpenABCode gateway
 * (LiteLLM proxy, OpenAI-compatible). Auth is a bearer token issued by the
 * OpenABCode web API, resolved from $OPENABCODE_API_KEY or auth.json
 * (via `/login openabcode`). Each hosted model carries the
 * x-openabcode-upstream-provider header expected by the gateway.
 */

import type { ModelRegistry } from "./model-registry.ts";

export const OPENABCODE_PROVIDER = "openabcode";

const DEFAULT_BASE_URL = "https://gateway.openabcode.com/v1";

/** Hosted model id -> upstream provider routed by the gateway. Mirrors LiteLLM model_name entries. */
export const OPENABCODE_HOSTED_UPSTREAM: Record<string, "openai" | "anthropic" | "google"> = {
	"claude-opus-4-8": "anthropic",
	"claude-opus-4.8": "anthropic",
	"claude-opus-4-7": "anthropic",
	"claude-opus-4.7": "anthropic",
	"claude-sonnet-5": "anthropic",
	"claude-fable-5": "anthropic",
	"claude-opus-4-6": "anthropic",
	"claude-opus-4.6": "anthropic",
	"claude-opus-4.5": "anthropic",
	"claude-sonnet-4.6": "anthropic",
	"claude-sonnet-4.5": "anthropic",
	"claude-haiku-4.5": "anthropic",
	"gemini-3.1-pro-preview": "google",
	"gemini-3-flash-preview": "google",
	"gemini-3.5-flash": "google",
	"gemini-3.1-flash-lite": "google",
	"gemini-3-pro-image-preview": "google",
	"gemini-3.1-flash-image-preview": "google",
	"gpt-4o": "openai",
	"gpt-5": "openai",
	"gpt-5.1": "openai",
	"gpt-5.2": "openai",
	"gpt-5.3-codex": "openai",
	"gpt-5.4": "openai",
	"gpt-5.4-long": "openai",
	"gpt-5.5": "openai",
	"gpt-5.5-pro": "openai",
	"gpt-5.6-sol": "openai",
	"gpt-5.6-terra": "openai",
	"gpt-5.6-luna": "openai",
	"gpt-image-2": "openai",
};

export function openabcodeGatewayBaseUrl(): string {
	const fromEnv = process.env.OPENABCODE_BASE_URL ?? process.env.OPENABCODE_API_BASE_URL;
	return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_BASE_URL;
}

export function registerOpenABCodeProvider(registry: ModelRegistry): void {
	registry.registerProvider(OPENABCODE_PROVIDER, {
		name: "OpenABCode Gateway",
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
