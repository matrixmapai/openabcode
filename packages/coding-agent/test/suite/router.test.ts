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

	it("pickRouteModel prefers the BYOK routing default", () => {
		const models = [
			model("anthropic", "claude-haiku-4-5"),
			model("anthropic", "claude-opus-4-8"),
			model(OPENABCODE_PROVIDER, "claude-haiku-4-5"),
		];
		const picked = pickRouteModel("anthropic", models, () => true);
		expect(picked?.model.provider).toBe("anthropic");
		expect(picked?.model.id).toBe("claude-opus-4-8");
		expect(picked?.source).toBe("classifier");
	});

	it("pickRouteModel falls back to hosted models when no BYOK auth exists", () => {
		const models = [model("openai", "gpt-5.5"), model(OPENABCODE_PROVIDER, "gpt-5.4")];
		const picked = pickRouteModel("openai", models, (m) => m.provider === OPENABCODE_PROVIDER);
		expect(picked?.model.provider).toBe(OPENABCODE_PROVIDER);
		expect(picked?.model.id).toBe("gpt-5.4");
	});

	it("pickRouteModel honors the preferred model from settings", () => {
		const models = [model("openai", "gpt-5.5"), model("openai", "gpt-5.4")];
		const picked = pickRouteModel("openai", models, () => true, { openai: "openai/gpt-5.4" });
		expect(picked?.model.id).toBe("gpt-5.4");
		expect(picked?.source).toBe("preferred");
	});

	it("pickRouteModel returns undefined when nothing is eligible", () => {
		const models = [model("anthropic", "claude-opus-4-8")];
		expect(pickRouteModel("google", models, () => true)).toBeUndefined();
		expect(pickRouteModel("anthropic", models, () => false)).toBeUndefined();
	});
});
