import type { Api, Model } from "@openabcode/ai";
import { fauxAssistantMessage, registerFauxProvider } from "@openabcode/ai/compat";
import {
	OPENABCODE_HOSTED_UPSTREAM,
	OPENABCODE_PROVIDER_ID as OPENABCODE_PROVIDER,
} from "@openabcode/ai/providers/openabcode";
import { describe, expect, it } from "vitest";
import { classifyProvider, classifyProviderHeuristic, pickRouteModel, routeProviderOf } from "../../src/core/router.ts";
import { BUILTIN_SLASH_COMMANDS } from "../../src/core/slash-commands.ts";

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
	it("classifyProvider uses the configured model", async () => {
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("openai")]);

		try {
			const choice = await classifyProvider(
				faux.getModel(),
				{ text: "review this concurrency code" },
				{ apiKey: "faux-key" },
			);
			expect(choice).toBe("openai");
			expect(faux.getPendingResponseCount()).toBe(0);
		} finally {
			faux.unregister();
		}
	});

	it("registers the route-model command", () => {
		expect(BUILTIN_SLASH_COMMANDS.find((command) => command.name === "route-model")?.description).toContain(
			"classify",
		);
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

	it("OpenABCode gateway model list mirrors the LiteLLM gateway catalog", () => {
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

describe("OpenABCode heuristic router", () => {
	it("returns undefined when no signal matches", () => {
		expect(classifyProviderHeuristic({ text: "please help me with this task" })).toBeUndefined();
	});

	it("classifies with high confidence when multiple signals agree", () => {
		const result = classifyProviderHeuristic({
			text: "add a Flutter screen to the Android app",
			projectFiles: ["pubspec.yaml", "README.md"],
		});
		expect(result?.choice).toBe("google");
		expect(result?.confidence).toBe("high");
		expect(result?.matched).toContain("keyword:flutter");
		expect(result?.matched).toContain("project:pubspec.yaml");
	});

	it("returns undefined for default-provider signals (defers to classifier)", () => {
		// "refactor" matches anthropic, but anthropic is now the default — not distinctive
		const result = classifyProviderHeuristic({ text: "refactor the auth module" });
		expect(result).toBeUndefined();
	});

	it("does not match Chinese text against ASCII-only keywords", () => {
		// Chinese text falls through to the LLM classifier when no Chinese keywords are configured
		expect(classifyProviderHeuristic({ text: "帮我重构这个模块的架构" })).toBeUndefined();
	});

	it("uses word boundaries for ASCII keywords", () => {
		// "kiosk" must not match "ios"
		expect(classifyProviderHeuristic({ text: "render the kiosk view" })).toBeUndefined();
	});

	it("scores file extensions and project bundle markers", () => {
		const result = classifyProviderHeuristic({
			text: "update the screen",
			fileNames: ["lib/main.dart"],
			projectFiles: ["pubspec.yaml", "README.md"],
		});
		expect(result?.choice).toBe("google");
		expect(result?.confidence).toBe("high");
	});

	it("returns undefined on a tie between providers", () => {
		const result = classifyProviderHeuristic({ text: "debug the flutter app" });
		// "debug" (anthropic) vs "flutter" (google) — one signal each
		expect(result).toBeUndefined();
	});

	it("replaces the built-in keyword table when config.keywords is set", () => {
		// "refactor" is a built-in anthropic keyword but anthropic is default so heuristic ignores it
		const withBuiltin = classifyProviderHeuristic({ text: "refactor the auth module" });
		expect(withBuiltin).toBeUndefined();

		// Moving "refactor" to google (non-default) makes it a distinctive signal
		const result = classifyProviderHeuristic(
			{ text: "refactor the auth module" },
			{ keywords: { google: ["refactor"], anthropic: [], openai: [] } },
		);
		expect(result?.choice).toBe("google");
	});

	it("replaces the built-in file extension table when config.fileExtensions is set", () => {
		// .dart is normally google (non-default); custom table maps only .rs to google
		const withBuiltin = classifyProviderHeuristic({
			text: "update the screen",
			fileNames: ["main.dart"],
		});
		expect(withBuiltin?.choice).toBe("google");

		const result = classifyProviderHeuristic(
			{ text: "update the screen", fileNames: ["main.dart"] },
			{ fileExtensions: { ".rs": "google" } },
		);
		// .dart no longer matches anything in the custom table
		expect(result).toBeUndefined();
	});

	it("replaces the built-in project markers table when config.projectMarkers is set", () => {
		// pubspec.yaml is normally google (non-default)
		const withBuiltin = classifyProviderHeuristic({
			text: "update the config",
			projectFiles: ["pubspec.yaml"],
		});
		expect(withBuiltin?.choice).toBe("google");

		const result = classifyProviderHeuristic(
			{ text: "update the config", projectFiles: ["pubspec.yaml"] },
			{ projectMarkers: { "go.mod": "openai" } },
		);
		expect(result).toBeUndefined();
	});

	it("returns undefined for default-provider-only signals (defers to classifier)", () => {
		// anthropic is now the default; its signals should not short-circuit
		const result = classifyProviderHeuristic({ text: "debug the module" });
		expect(result).toBeUndefined();
	});

	it("allows default-provider signals when defaultProvider is overridden", () => {
		// When defaultProvider is changed to google, anthropic signals become distinctive
		const result = classifyProviderHeuristic({ text: "debug the handler" }, { defaultProvider: "google" });
		expect(result?.choice).toBe("anthropic");
		expect(result?.confidence).toBe("low");
	});
});
