import type { AgentTool, ThinkingLevel } from "@openabcode/agent-core";
import { fauxAssistantMessage, fauxToolCall, type Model } from "@openabcode/ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildSystemPromptOptions, ExtensionAPI } from "../../src/index.ts";
import { createHarness, getAssistantTexts, type Harness } from "./harness.ts";

describe("AgentSession model and extension characterization", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("setModel saves the model and emits model_select", async () => {
		const modelEvents: string[] = [];
		const harness = await createHarness({
			models: [
				{ id: "faux-1", name: "One", reasoning: true },
				{ id: "faux-2", name: "Two", reasoning: true },
			],
			extensionFactories: [
				(pi) => {
					pi.on("model_select", async (event) => {
						modelEvents.push(`${event.previousModel?.id ?? "none"}->${event.model.id}:${event.source}`);
					});
				},
			],
		});
		harnesses.push(harness);
		const nextModel = harness.getModel("faux-2")!;

		await harness.session.setModel(nextModel);

		expect(harness.session.model?.id).toBe("faux-2");
		expect(modelEvents).toEqual(["faux-1->faux-2:set"]);
		expect(
			harness.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "model_change")
				.map((entry) => `${entry.provider}/${entry.modelId}`),
		).toEqual([`${nextModel.provider}/${nextModel.id}`]);
	});

	it("setModel preserves automatic routing when requested", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", name: "One", reasoning: true },
				{ id: "faux-2", name: "Two", reasoning: true },
			],
		});
		harnesses.push(harness);
		harness.session.setRouteMode("auto");

		await harness.session.setModel(harness.getModel("faux-2")!, { preserveRouteMode: true });

		expect(harness.session.routeMode).toBe("auto");
		expect(harness.session.model?.id).toBe("faux-2");
	});

	it("setModel remains a manual override by default", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", name: "One", reasoning: true },
				{ id: "faux-2", name: "Two", reasoning: true },
			],
		});
		harnesses.push(harness);
		harness.session.setRouteMode("auto");

		await harness.session.setModel(harness.getModel("faux-2")!);

		expect(harness.session.routeMode).toBe("manual");
	});

	it("starts with Route off when an enabled setting has no classifier model", async () => {
		const harness = await createHarness({ settings: { router: { enabled: true } } });
		harnesses.push(harness);

		expect(harness.session.routeMode).toBe("manual");
	});

	it("audits every completed classification and only switches models when needed", async () => {
		const harness = await createHarness({ models: [{ id: "classifier", name: "Classifier" }] });
		harnesses.push(harness);
		const classifier = harness.getModel("classifier")!;

		for (const [provider, id] of [
			["openai", "gpt-route"],
			["google", "gemini-route"],
			["anthropic", "claude-route"],
		] as const) {
			harness.authStorage.setRuntimeApiKey(provider, `${provider}-key`);
			harness.session.modelRegistry.registerProvider(provider, {
				baseUrl: classifier.baseUrl,
				apiKey: `${provider}-key`,
				api: classifier.api,
				models: [
					{
						id,
						name: id,
						reasoning: false,
						input: ["text"],
						cost: classifier.cost,
						contextWindow: classifier.contextWindow,
						maxTokens: classifier.maxTokens,
					},
				],
			});
			harness.settingsManager.setRouterModel(provider, `${provider}/${id}`);
		}
		harness.settingsManager.setRouterClassifierModel(classifier.provider, classifier.id);
		harness.session.setRouteMode("auto");
		harness.setResponses([fauxAssistantMessage("anthropic"), fauxAssistantMessage("anthropic")]);

		const maybeRoute = (
			harness.session as unknown as { _maybeRouteModel(text: string): Promise<void> }
		)._maybeRouteModel.bind(harness.session);
		await maybeRoute("refactor this service");
		await maybeRoute("debug the same service");

		expect(harness.session.model?.id).toBe("claude-route");
		const routingEntries = harness.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom" && entry.customType === "openabcode-routing");
		expect(routingEntries).toHaveLength(2);
		expect(routingEntries[0]?.data).toMatchObject({
			provider: "anthropic",
			classifierModel: { provider: classifier.provider, id: classifier.id },
			model: { provider: "anthropic", id: "claude-route" },
		});
		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "model_change")).toHaveLength(1);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("cycles through scoped models and preserves the scoped thinking preference", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", name: "One", reasoning: true },
				{ id: "faux-2", name: "Two", reasoning: false },
			],
		});
		harnesses.push(harness);
		const modelOne = harness.getModel("faux-1")!;
		const modelTwo = harness.getModel("faux-2")!;
		harness.session.setScopedModels([{ model: modelOne, thinkingLevel: "high" }, { model: modelTwo }] as Array<{
			model: Model<string>;
			thinkingLevel?: ThinkingLevel;
		}>);
		harness.session.setThinkingLevel("high");

		await harness.session.cycleModel();
		expect(harness.session.model?.id).toBe("faux-2");
		expect(harness.session.thinkingLevel).toBe("off");

		await harness.session.cycleModel();
		expect(harness.session.model?.id).toBe("faux-1");
		expect(harness.session.thinkingLevel).toBe("high");
	});

	it("clamps thinking levels to model capabilities and cycles available levels", async () => {
		const harness = await createHarness({ models: [{ id: "faux-1", reasoning: false }] });
		harnesses.push(harness);

		harness.session.setThinkingLevel("high");
		expect(harness.session.thinkingLevel).toBe("off");
		expect(harness.session.cycleThinkingLevel()).toBeUndefined();
	});

	it("cycles xhigh before max when both are supported", async () => {
		const harness = await createHarness({ models: [{ id: "faux-1", reasoning: true }] });
		harnesses.push(harness);
		harness.getModel().thinkingLevelMap = { xhigh: "xhigh", max: "max" };

		expect(harness.session.getAvailableThinkingLevels()).toEqual([
			"off",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
		harness.session.setThinkingLevel("high");
		expect(harness.session.cycleThinkingLevel()).toBe("xhigh");
		expect(harness.session.cycleThinkingLevel()).toBe("max");
		expect(harness.session.cycleThinkingLevel()).toBe("off");
	});

	it("throws when setModel is called without configured auth", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", name: "One", reasoning: true },
				{ id: "faux-2", name: "Two", reasoning: true },
			],
			withConfiguredAuth: false,
		});
		harnesses.push(harness);

		await expect(harness.session.setModel(harness.getModel("faux-2")!)).rejects.toThrow(
			`No API key for ${harness.getModel().provider}/faux-2`,
		);
	});

	it("allows extension tool_call handlers to block tool execution", async () => {
		const echoTool: AgentTool = {
			name: "echo",
			label: "Echo",
			description: "Echo text back",
			parameters: Type.Object({ text: Type.String() }),
			execute: async () => {
				throw new Error("tool should have been blocked");
			},
		};
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", async () => ({ block: true, reason: "Blocked by test" }));
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			(context) => {
				const toolResult = context.messages.find((message) => message.role === "toolResult");
				const errorText =
					toolResult?.role === "toolResult"
						? toolResult.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n")
						: "";
				return fauxAssistantMessage(errorText);
			},
		]);

		await harness.session.prompt("hi");

		expect(getAssistantTexts(harness)).toContain("Blocked by test");
		expect(
			harness.session.messages.find((message) => message.role === "toolResult" && message.isError),
		).toBeDefined();
	});

	it("allows extension tool_result handlers to modify tool results", async () => {
		const echoTool: AgentTool = {
			name: "echo",
			label: "Echo",
			description: "Echo text back",
			parameters: Type.Object({ text: Type.String() }),
			execute: async (_toolCallId, params) => {
				const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
				return { content: [{ type: "text", text }], details: { text } };
			},
		};
		const harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [
				(pi) => {
					pi.on("tool_result", async () => ({
						content: [{ type: "text", text: "patched result" }],
						details: { patched: true },
					}));
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
			(context) => {
				const toolResult = context.messages.find((message) => message.role === "toolResult");
				const text =
					toolResult?.role === "toolResult"
						? toolResult.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n")
						: "";
				return fauxAssistantMessage(text);
			},
		]);

		await harness.session.prompt("hi");

		expect(getAssistantTexts(harness)).toContain("patched result");
		expect(
			harness.session.messages.find((message) => message.role === "toolResult" && message.details?.patched === true),
		).toBeDefined();
	});

	it("allows extension context handlers to modify messages before the LLM call", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("context", async (event) => ({
						messages: event.messages.map((message) =>
							message.role === "user"
								? { ...message, content: [{ type: "text", text: "rewritten" }], timestamp: message.timestamp }
								: message,
						),
					}));
				},
			],
		});
		harnesses.push(harness);
		let providerUserText = "";
		harness.setResponses([
			(context) => {
				const user = context.messages.find((message) => message.role === "user");
				providerUserText =
					user && typeof user.content !== "string"
						? user.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n")
						: "";
				return fauxAssistantMessage("done");
			},
		]);

		await harness.session.prompt("original");

		expect(providerUserText).toBe("rewritten");
		const storedUserMessage = harness.session.messages.find((message) => message.role === "user");
		expect(storedUserMessage?.role).toBe("user");
		if (storedUserMessage?.role === "user") {
			expect(storedUserMessage.content).toEqual([{ type: "text", text: "original" }]);
		}
	});

	it("allows extension input handlers to transform or handle input", async () => {
		let extensionApi: ExtensionAPI | undefined;
		const transformedHarness = await createHarness({
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
					pi.on("input", async (event) => {
						if (event.text === "ping") {
							return { action: "handled" };
						}
						return { action: "transform", text: `transformed:${event.text}` };
					});
				},
			],
		});
		harnesses.push(transformedHarness);
		let providerUserText = "";
		transformedHarness.setResponses([
			(context) => {
				const user = context.messages.find((message) => message.role === "user");
				providerUserText =
					user && typeof user.content !== "string"
						? user.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n")
						: "";
				return fauxAssistantMessage("done");
			},
		]);

		await transformedHarness.session.prompt("hello");
		await transformedHarness.session.prompt("ping");

		expect(providerUserText).toBe("transformed:hello");
		expect(transformedHarness.session.messages.filter((message) => message.role === "user")).toHaveLength(1);
		expect(extensionApi).toBeDefined();
	});

	it("allows extension commands to inspect live system prompt options", async () => {
		const seenOptions: BuildSystemPromptOptions[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.registerCommand("inspect-options", {
						description: "Inspect system prompt options",
						handler: async (_args, ctx) => {
							const options = ctx.getSystemPromptOptions();
							seenOptions.push(options);
							options.selectedTools?.push("mutated_tool");
						},
					});
				},
			],
		});
		harnesses.push(harness);

		await harness.session.prompt("/inspect-options");
		await harness.session.prompt("/inspect-options");

		expect(seenOptions).toHaveLength(2);
		expect(seenOptions[0]).toBe(seenOptions[1]);
		expect(seenOptions[0]?.cwd).toBe(harness.tempDir);
		expect(seenOptions[0]?.selectedTools).toContain("read");
		expect(seenOptions[1]?.selectedTools).toContain("mutated_tool");
	});

	it("allows before_agent_start handlers to inject custom messages and modify the system prompt", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", async (event) => ({
						message: {
							customType: "before-start",
							content: "injected",
							display: true,
							details: { injected: true },
						},
						systemPrompt: `${event.systemPrompt}\n\nextra instructions`,
					}));
				},
			],
		});
		harnesses.push(harness);
		let providerSystemPrompt = "";
		let sawInjectedUserMessage = false;
		harness.setResponses([
			(context) => {
				providerSystemPrompt = context.systemPrompt ?? "";
				sawInjectedUserMessage = context.messages.some(
					(message) =>
						message.role === "user" &&
						typeof message.content !== "string" &&
						message.content.some((part) => part.type === "text" && part.text === "injected"),
				);
				return fauxAssistantMessage("done");
			},
		]);

		await harness.session.prompt("hello");

		expect(providerSystemPrompt).toContain("extra instructions");
		expect(sawInjectedUserMessage).toBe(true);
		expect(
			harness.session.messages.some((message) => message.role === "custom" && message.customType === "before-start"),
		).toBe(true);
	});

	it("bindExtensions emits session_start and reload emits session_shutdown then session_start", async () => {
		const lifecycleEvents: string[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_start", async (event) => {
						lifecycleEvents.push(`start:${event.reason}`);
					});
					pi.on("session_shutdown", async (event) => {
						lifecycleEvents.push(`shutdown:${event.reason}`);
					});
				},
			],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		await harness.session.reload();

		expect(lifecycleEvents).toEqual(["start:startup", "shutdown:reload", "start:reload"]);
	});
});
