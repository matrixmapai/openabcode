import type { Api, Model } from "@openabcode/ai";
import { afterEach, describe, expect, it } from "vitest";
import { OPENABCODE_HOSTED_UPSTREAM, OPENABCODE_PROVIDER } from "../../src/core/openabcode-provider.ts";
import { classifyProvider, pickRouteModel, routeProviderOf } from "../../src/core/router.ts";

const CLASSIFIER_ENV_VARS = [
	"GEMINI_API_KEY",
	"GOOGLE_GENERATIVE_AI_API_KEY",
	"GEMINI_AISTUDIO_API_KEY",
	"GOOGLE_AI_STUDIO_API_KEY",
];

function model(provider: string, id: string): Model<Api> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider,
		baseUrl: "https://example.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 16_384,
		headers: undefined,
		compat: undefined,
	} as Model<Api>;
}

describe("OpenABCode router", () => {
	const savedEnv = new Map<string, string | undefined>();

	afterEach(() => {
		for (const [name, value] of savedEnv) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		savedEnv.clear();
	});

	function clearClassifierEnv(): void {
		for (const name of CLASSIFIER_ENV_VARS) {
			savedEnv.set(name, process.env[name]);
			delete process.env[name];
		}
	}

	it("classifyProvider falls back to anthropic without an API key", async () => {
		clearClassifierEnv();
		const choice = await classifyProvider({ text: "refactor this module" });
		expect(choice).toBe("anthropic");
	});

	it("routeProviderOf maps direct providers", () => {
		expect(routeProviderOf(model("anthropic", "claude-opus-4-8"))).toBe("anthropic");
		expect(routeProviderOf(model("openai", "gpt-5.5"))).toBe("openai");
		expect(routeProviderOf(model("google", "gemini-3.1-pro-preview"))).toBe("google");
		expect(routeProviderOf(model("mistral", "devstral-medium-latest"))).toBeUndefined();
	});

	it("routeProviderOf maps hosted models to their upstream provider", () => {
		for (const [id, upstream] of Object.entries(OPENABCODE_HOSTED_UPSTREAM)) {
			expect(routeProviderOf(model(OPENABCODE_PROVIDER, id))).toBe(upstream);
		}
	});

	it("OpenABCode hosted model list mirrors the LiteLLM gateway catalog", () => {
		expect(Object.keys(OPENABCODE_HOSTED_UPSTREAM)).toHaveLength(31);
		expect(OPENABCODE_HOSTED_UPSTREAM["claude-opus-4-8"]).toBe("anthropic");
		expect(OPENABCODE_HOSTED_UPSTREAM["gemini-3.1-pro-preview"]).toBe("google");
		expect(OPENABCODE_HOSTED_UPSTREAM["gpt-5.6-luna"]).toBe("openai");
		expect(OPENABCODE_HOSTED_UPSTREAM["gpt-image-2"]).toBe("openai");
	});

	it("routeProviderOf maps OpenRouter model namespaces", () => {
		expect(routeProviderOf(model("openrouter", "anthropic/claude-opus-4.8"))).toBe("anthropic");
		expect(routeProviderOf(model("openrouter", "openai/gpt-5.5"))).toBe("openai");
		expect(routeProviderOf(model("openrouter", "google/gemini-3.1-pro"))).toBe("google");
		expect(routeProviderOf(model("openrouter", "mistralai/devstral"))).toBeUndefined();
	});

	it("pickRouteModel requires an explicit model selection", () => {
		const models = [model("openai", "gpt-5.5"), model(OPENABCODE_PROVIDER, "gpt-5.4")];
		expect(pickRouteModel("openai", models, () => true)).toBeUndefined();
	});

	it("pickRouteModel honors the preferred model from settings", () => {
		const models = [model("openai", "gpt-5.5"), model("openai", "gpt-5.4")];
		const picked = pickRouteModel("openai", models, () => true, { openai: "openai/gpt-5.4" });
		expect(picked?.model.id).toBe("gpt-5.4");
		expect(picked?.source).toBe("preferred");
	});

	it("pickRouteModel rejects a configured model from the wrong family", () => {
		const models = [model("openai", "gpt-5.5")];
		expect(pickRouteModel("anthropic", models, () => true, { anthropic: "openai/gpt-5.5" })).toBeUndefined();
	});

	it("pickRouteModel returns undefined when nothing is eligible", () => {
		const models = [model("anthropic", "claude-opus-4-8")];
		expect(pickRouteModel("google", models, () => true)).toBeUndefined();
		expect(
			pickRouteModel("anthropic", models, () => false, { anthropic: "anthropic/claude-opus-4-8" }),
		).toBeUndefined();
	});
});
