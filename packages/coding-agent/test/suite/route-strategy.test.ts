import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@openabcode/agent-core";
import { type AssistantMessage, fauxAssistantMessage, fauxToolCall } from "@openabcode/ai/compat";
import { OPENABCODE_ROUTING_DECISION_HEADER } from "@openabcode/ai/providers/openabcode";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderChoice, RouterStrategy, RoutingDecision } from "../../src/core/router.ts";
import * as router from "../../src/core/router.ts";
import type { CustomEntry } from "../../src/core/session-manager.ts";
import { InMemorySettingsStorage, SettingsManager } from "../../src/core/settings-manager.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	for (const harness of harnesses.splice(0)) {
		await harness.session.dispose();
		harness.cleanup();
	}
});

async function createRouteHarness(
	options: { strategy?: RouterStrategy; families?: readonly ProviderChoice[]; tools?: AgentTool[] } = {},
): Promise<Harness> {
	const harness = await createHarness({
		models: [{ id: "classifier", name: "Classifier" }],
		settings: { router: { strategy: options.strategy } },
		tools: options.tools,
	});
	harnesses.push(harness);
	const classifier = harness.getModel();
	for (const family of options.families ?? ["openai", "google", "anthropic"]) {
		harness.authStorage.setRuntimeApiKey(family, "faux-key");
		harness.session.modelRegistry.registerProvider(family, {
			baseUrl: classifier.baseUrl,
			apiKey: "faux-key",
			api: classifier.api,
			models: [{ ...classifier, id: `${family}-execution`, name: family }],
		});
		harness.settingsManager.setRouterModel(family, `${family}/${family}-execution`);
	}
	harness.settingsManager.setRouterClassifierModel(classifier.provider, classifier.id);
	harness.session.setRouteMode("auto");
	return harness;
}

function routeTask(harness: Harness, text: string): Promise<void> {
	return (harness.session as unknown as { _maybeRouteModel(text: string): Promise<void> })._maybeRouteModel(text);
}

function decisions(harness: Harness): RoutingDecision[] {
	return harness.sessionManager
		.getEntries()
		.filter((entry): entry is CustomEntry => entry.type === "custom" && entry.customType === "openabcode-routing")
		.map((entry) => entry.data as RoutingDecision);
}

describe("Route strategy settings", () => {
	it("defaults to hybrid and persists a strategy without replacing other router settings", async () => {
		const manager = SettingsManager.inMemory({
			router: {
				enabled: true,
				classifierModel: "faux/classifier",
				models: { google: "google/execution" },
			},
		});
		expect(manager.getRouterStrategy()).toBe("hybrid");
		manager.setRouterStrategy("classifier-only");
		await manager.flush();
		await manager.reload();
		expect(manager.getRouterStrategy()).toBe("classifier-only");
		expect(manager.getGlobalSettings().router).toEqual({
			enabled: true,
			strategy: "classifier-only",
			classifierModel: "faux/classifier",
			models: { google: "google/execution" },
		});
		manager.setRouterStrategy("hybrid");
		await manager.flush();
		await manager.reload();
		expect(manager.getRouterStrategy()).toBe("hybrid");
	});

	it("honors trusted project overrides and ignores untrusted project strategy", () => {
		const storage = new InMemorySettingsStorage();
		storage.withLock("global", () => JSON.stringify({ router: { strategy: "hybrid" } }));
		storage.withLock("project", () => JSON.stringify({ router: { strategy: "classifier-only" } }));
		expect(SettingsManager.fromStorage(storage).getRouterStrategy()).toBe("classifier-only");
		expect(SettingsManager.fromStorage(storage, { projectTrusted: false }).getRouterStrategy()).toBe("hybrid");
	});

	it("rejects an invalid strategy instead of silently using hybrid", () => {
		const storage = new InMemorySettingsStorage();
		storage.withLock("global", () => JSON.stringify({ router: { strategy: "classifer-only" } }));
		expect(() => SettingsManager.fromStorage(storage).getRouterStrategy()).toThrow("Invalid router.strategy");
	});
});

describe("AgentSession Route strategies", () => {
	it("skips heuristics and sticky reuse even for repeated high-confidence tasks", async () => {
		const harness = await createRouteHarness({ strategy: "classifier-only" });
		const heuristic = vi.spyOn(router, "classifyProviderHeuristic");
		writeFileSync(join(harness.tempDir, "pubspec.yaml"), "name: faux_app\n");
		harness.session.agent.state.messages.push({ role: "user", content: "Earlier request", timestamp: Date.now() });
		harness.setResponses([
			(context, options) => {
				const prompt = getMessageText(context.messages[0]);
				expect(prompt).toContain("pubspec.yaml");
				expect(prompt).toContain("Earlier request");
				expect(options).toMatchObject({ temperature: 0, maxTokens: 16 });
				return fauxAssistantMessage("anthropic");
			},
			fauxAssistantMessage("openai"),
			fauxAssistantMessage("anthropic"),
		]);
		for (const family of ["anthropic", "openai", "anthropic"]) {
			await routeTask(harness, "add a Flutter screen to the Android app");
			expect(harness.session.model?.provider).toBe(family);
		}
		expect(heuristic).not.toHaveBeenCalled();
		expect(harness.faux.state.callCount).toBe(3);
		expect(decisions(harness)).toHaveLength(3);
		for (const decision of decisions(harness)) {
			expect(decision).toMatchObject({
				strategy: "classifier-only",
				method: "classifier",
				classifierModel: {
					provider: harness.getModel().provider,
					id: "classifier",
				},
			});
			expect(decision.matchedSignals).toBeUndefined();
		}
	});

	it("audits repeated classifier results without redundant model switches", async () => {
		const harness = await createRouteHarness({ strategy: "classifier-only" });
		harness.setResponses([fauxAssistantMessage("anthropic"), fauxAssistantMessage("anthropic")]);
		await routeTask(harness, "continue with this task");
		await routeTask(harness, "continue with this task");
		expect(harness.faux.state.callCount).toBe(2);
		expect(decisions(harness)).toHaveLength(2);
		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "model_change")).toHaveLength(1);
	});

	it("forwards the same hosted decision ID to classification and execution", async () => {
		const harness = await createRouteHarness({ strategy: "classifier-only" });
		const model = harness.getModel();
		harness.authStorage.setRuntimeApiKey("openabcode", "faux-key");
		harness.session.modelRegistry.registerProvider("openabcode", {
			baseUrl: model.baseUrl,
			apiKey: "faux-key",
			api: model.api,
			headers: { "x-faux-auth": "preserved" },
			models: [
				{ ...model, id: "gemini-classifier", name: "Hosted classifier" },
				{ ...model, id: "gpt-execution", name: "Hosted executor" },
			],
		});
		harness.settingsManager.setRouterClassifierModel("openabcode", "gemini-classifier");
		harness.settingsManager.setRouterModel("openai", "openabcode/gpt-execution");
		let classifierDecisionId: string | null | undefined;
		harness.setResponses([
			(_context, options) => {
				classifierDecisionId = options?.headers?.[OPENABCODE_ROUTING_DECISION_HEADER];
				expect(options?.headers?.["x-faux-auth"]).toBe("preserved");
				return fauxAssistantMessage("openai");
			},
		]);
		await routeTask(harness, "Flutter Android screen");
		const decision = decisions(harness)[0]!;
		expect(classifierDecisionId).toBe(decision.id);
		expect(harness.session.agent.requestHeaders).toEqual({ [OPENABCODE_ROUTING_DECISION_HEADER]: decision.id });
		expect(decision).toMatchObject({
			strategy: "classifier-only",
			method: "classifier",
			classifierModel: { provider: "openabcode", id: "gemini-classifier" },
			model: { provider: "openabcode", id: "gpt-execution" },
		});
	});

	it("retains the existing heuristic and sticky pipeline by default", async () => {
		const harness = await createRouteHarness();
		await routeTask(harness, "Flutter Android screen");
		await routeTask(harness, "continue with this task");
		expect(harness.session.routeStrategy).toBe("hybrid");
		expect(harness.faux.state.callCount).toBe(0);
		expect(decisions(harness).map((decision) => decision.method)).toEqual(["heuristic", "sticky"]);
		expect(decisions(harness).every((decision) => decision.strategy === "hybrid")).toBe(true);
	});

	it("clears sticky state when switching strategies and does not warm it in classifier-only", async () => {
		const harness = await createRouteHarness();
		await routeTask(harness, "Flutter Android screen");
		await routeTask(harness, "optimize the algorithm");
		harness.session.setRouteStrategy("classifier-only");
		harness.setResponses([fauxAssistantMessage("anthropic"), fauxAssistantMessage("openai")]);
		await routeTask(harness, "continue with this task");
		harness.session.setRouteStrategy("hybrid");
		await routeTask(harness, "continue with this task");
		expect(harness.session.model?.provider).toBe("openai");
		expect(decisions(harness).map((decision) => decision.method)).toEqual([
			"heuristic",
			"sticky",
			"classifier",
			"classifier",
		]);
		expect(harness.faux.state.callCount).toBe(2);
	});

	it("notices settings overrides before the next task and clears stale veto state", async () => {
		const harness = await createRouteHarness();
		await routeTask(harness, "Flutter Android screen");
		const model = harness.session.modelRegistry.find("anthropic", "anthropic-execution")!;
		await harness.session.setFixedModelAndDisableRouter(model);
		harness.settingsManager.applyOverrides({ router: { strategy: "classifier-only" } });
		harness.session.setRouteMode("auto");
		harness.setResponses([fauxAssistantMessage("openai")]);
		await routeTask(harness, "continue with this task");
		expect(harness.session.model?.provider).toBe("openai");
		expect(harness.session.getRouteStatus()).toMatchObject({ strategy: "classifier-only", active: true });
		expect(decisions(harness).at(-1)?.method).toBe("classifier");
	});

	it("does not reuse a manual veto when classifier-only is re-enabled", async () => {
		const harness = await createRouteHarness({ strategy: "classifier-only" });
		harness.setResponses([fauxAssistantMessage("google"), fauxAssistantMessage("openai")]);
		await routeTask(harness, "continue with this task");
		await harness.session.setFixedModelAndDisableRouter(
			harness.session.modelRegistry.find("anthropic", "anthropic-execution")!,
		);
		harness.session.setRouteMode("auto");
		await routeTask(harness, "continue with this task");
		expect(harness.session.model?.provider).toBe("openai");
		expect(harness.faux.state.callCount).toBe(2);
	});

	it("does not restore sticky state from a classifier that finishes after strategy changes", async () => {
		const harness = await createRouteHarness();
		let finish!: (response: AssistantMessage) => void;
		let started!: () => void;
		const classifierStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		harness.setResponses([
			() => {
				started();
				return new Promise<AssistantMessage>((resolve) => {
					finish = resolve;
				});
			},
			fauxAssistantMessage("anthropic"),
		]);
		const task = routeTask(harness, "continue with this task");
		await classifierStarted;
		harness.session.setRouteStrategy("classifier-only");
		harness.session.setRouteStrategy("hybrid");
		finish(fauxAssistantMessage("google"));
		await task;
		expect(harness.session.model?.provider).toBe("google");
		await routeTask(harness, "continue with this task");
		expect(harness.session.model?.provider).toBe("anthropic");
		expect(harness.faux.state.callCount).toBe(2);
	});

	it.each(["invalid", "error", "aborted", "throw"])(
		"uses default-family fallback on %s, never heuristics or sticky",
		async (failure) => {
			const harness = await createRouteHarness({ strategy: "classifier-only" });
			const heuristic = vi.spyOn(router, "classifyProviderHeuristic");
			harness.setResponses([
				fauxAssistantMessage("openai"),
				() => {
					if (failure === "throw") throw new Error("Faux classifier failure");
					if (failure === "invalid") return fauxAssistantMessage("not-a-family");
					return fauxAssistantMessage("", { stopReason: failure === "error" ? "error" : "aborted" });
				},
			]);
			await routeTask(harness, "continue with this task");
			await routeTask(harness, "Flutter Android screen");
			expect(harness.session.model?.provider).toBe("anthropic");
			expect(harness.faux.state.callCount).toBe(2);
			expect(heuristic).not.toHaveBeenCalled();
			expect(decisions(harness).at(-1)?.method).toBe("classifier");
		},
	);

	it("times out after 60 seconds and uses the configured default", async () => {
		const harness = await createRouteHarness({ strategy: "classifier-only" });
		harness.settingsManager.applyOverrides({ router: { defaultProvider: "openai" } });
		vi.useFakeTimers();
		let started!: () => void;
		const classifierStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		harness.setResponses([
			(_context, options) => {
				started();
				return new Promise<AssistantMessage>((resolve) => {
					options?.signal?.addEventListener(
						"abort",
						() => resolve(fauxAssistantMessage("", { stopReason: "aborted" })),
						{ once: true },
					);
				});
			},
		]);
		const task = routeTask(harness, "Flutter Android screen");
		await classifierStarted;
		await vi.advanceTimersByTimeAsync(60_000);
		await task;
		expect(harness.session.model?.provider).toBe("openai");
		expect(decisions(harness).at(-1)).toMatchObject({ strategy: "classifier-only", method: "classifier" });
	});

	it("classifies only among available families and falls back when the default is unavailable", async () => {
		const harness = await createRouteHarness({ strategy: "classifier-only", families: ["openai", "google"] });
		harness.setResponses([
			(context) => {
				expect(getMessageText(context.messages[0])).toContain('Return ONLY one of: "openai", "google"');
				return fauxAssistantMessage("anthropic");
			},
		]);
		await routeTask(harness, "Flutter Android screen");
		expect(harness.session.model?.provider).toBe("openai");
		expect(harness.session.getRouteStatus()).toMatchObject({ active: true, missingChoices: ["anthropic"] });
	});

	it.each(["manual", "empty", "no-classifier", "no-auth", "one-family", "auth-failed"])(
		"skips routing for %s without changing strategy",
		async (reason) => {
			const harness = await createRouteHarness({
				strategy: "classifier-only",
				families: reason === "one-family" ? ["openai"] : undefined,
			});
			if (reason === "manual") harness.session.setRouteMode("manual");
			if (reason === "no-classifier") harness.settingsManager.setRouterClassifierModel("faux", "missing");
			if (reason === "no-auth") vi.spyOn(harness.session.modelRegistry, "hasConfiguredAuth").mockReturnValue(false);
			if (reason === "auth-failed")
				vi.spyOn(harness.session.modelRegistry, "getApiKeyAndHeaders").mockResolvedValue({
					ok: false,
					error: "Faux authentication failed",
				});
			await routeTask(harness, reason === "empty" ? "   " : "Flutter Android screen");
			expect(harness.session.model?.id).toBe("classifier");
			expect(harness.session.routeStrategy).toBe("classifier-only");
			expect(harness.faux.state.callCount).toBe(0);
			expect(decisions(harness)).toEqual([]);
		},
	);

	it("does not independently classify queued steering or follow-up messages", async () => {
		const harness = await createRouteHarness({ strategy: "classifier-only" });
		harness.setResponses([
			fauxAssistantMessage("anthropic"),
			async () => {
				await harness.session.prompt("unit test pipeline", { streamingBehavior: "steer" });
				await harness.session.prompt("Flutter Android screen", { streamingBehavior: "followUp" });
				return fauxAssistantMessage("first response");
			},
			fauxAssistantMessage("steered response"),
			fauxAssistantMessage("follow-up response"),
		]);
		await harness.session.prompt("initial task");
		expect(harness.faux.state.callCount).toBe(4);
		expect(decisions(harness)).toHaveLength(1);
		expect(harness.session.model?.provider).toBe("anthropic");
		expect(harness.session.pendingMessageCount).toBe(0);
	});

	it("classifies each new prompt but not tool continuations", async () => {
		const echo: AgentTool = {
			name: "echo",
			label: "Echo",
			description: "Echo",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "echo" }], details: {} }),
		};
		const harness = await createRouteHarness({ strategy: "classifier-only", tools: [echo] });
		harness.setResponses([
			fauxAssistantMessage("anthropic"),
			fauxAssistantMessage([fauxToolCall("echo", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
			fauxAssistantMessage("openai"),
			fauxAssistantMessage("done again"),
		]);
		await harness.session.prompt("Flutter Android screen");
		await harness.session.prompt("Flutter Android screen");
		expect(harness.faux.state.callCount).toBe(5);
		expect(decisions(harness).map((decision) => decision.provider)).toEqual(["anthropic", "openai"]);
		expect(harness.session.model?.provider).toBe("openai");
	});
});
