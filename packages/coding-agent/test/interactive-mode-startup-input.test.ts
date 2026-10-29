import type { AgentMessage } from "@openabcode/agent-core";
import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type SubmitContext = {
	defaultEditor: { onSubmit?: (text: string) => void };
	editor: {
		addToHistory?: (text: string) => void;
		setText: (text: string) => void;
	};
	session: {
		isCompacting: boolean;
		isStreaming: boolean;
		isBashRunning: boolean;
		prompt: (text: string, options?: unknown) => Promise<void>;
	};
	flushPendingBashComponents: () => void;
	onInputCallback?: (text: string) => void;
	pendingUserInputs: string[];
};

type InputContext = {
	onInputCallback?: (text: string) => void;
	pendingUserInputs: string[];
};

type InteractiveModePrivate = {
	setupEditorSubmitHandler(this: SubmitContext): void;
	getUserInput(this: InputContext): Promise<string>;
	renderSubmittedPrompt(this: SubmittedPromptContext, message: AgentMessage): void;
};

type SubmittedPromptContext = {
	optimisticallyRenderedUserMessages: WeakSet<AgentMessage>;
	addMessageToChat: (message: AgentMessage) => void;
	editor: { setText: (text: string) => void };
	showWorkingStatus: () => void;
	ui: { requestRender: () => void };
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrivate;

function createSubmitContext(): SubmitContext {
	return {
		defaultEditor: {},
		editor: {
			addToHistory: vi.fn(),
			setText: vi.fn(),
		},
		session: {
			isCompacting: false,
			isStreaming: false,
			isBashRunning: false,
			prompt: vi.fn(async () => {}),
		},
		flushPendingBashComponents: vi.fn(),
		pendingUserInputs: [],
	};
}

describe("InteractiveMode startup input", () => {
	it("queues a normal prompt submitted before the input callback is installed", async () => {
		const context = createSubmitContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.(" early prompt ");

		expect(context.pendingUserInputs).toEqual(["early prompt"]);
		expect(context.flushPendingBashComponents).toHaveBeenCalledTimes(1);
		expect(context.editor.addToHistory).toHaveBeenCalledWith("early prompt");
	});

	it("returns queued startup input before installing a new input callback", async () => {
		const context: InputContext = {
			pendingUserInputs: ["queued prompt"],
		};

		await expect(interactiveModePrototype.getUserInput.call(context)).resolves.toBe("queued prompt");
		expect(context.onInputCallback).toBeUndefined();
		expect(context.pendingUserInputs).toEqual([]);
	});

	it("renders and clears a submitted prompt immediately", () => {
		const message: AgentMessage = {
			role: "user",
			content: [{ type: "text", text: "route this" }],
			timestamp: Date.now(),
		};
		const context: SubmittedPromptContext = {
			optimisticallyRenderedUserMessages: new WeakSet(),
			addMessageToChat: vi.fn(),
			editor: { setText: vi.fn() },
			showWorkingStatus: vi.fn(),
			ui: { requestRender: vi.fn() },
		};

		interactiveModePrototype.renderSubmittedPrompt.call(context, message);

		expect(context.optimisticallyRenderedUserMessages.has(message)).toBe(true);
		expect(context.addMessageToChat).toHaveBeenCalledWith(message);
		expect(context.editor.setText).toHaveBeenCalledWith("");
		expect(context.showWorkingStatus).toHaveBeenCalledTimes(1);
		expect(context.ui.requestRender).toHaveBeenCalledTimes(1);
	});
});

describe("InteractiveMode /route configuration flow", () => {
	function createRouteContext(models: Array<{ provider: string; id: string }>) {
		const routerModels: Record<string, string> = {};
		let classifierModel: string | undefined;
		let enabled = false;
		let routeMode: "auto" | "manual" = "manual";

		const context: Record<string, unknown> = {
			getModelCandidates: vi.fn(async () => models),
			resolveRouteCandidate: (InteractiveMode.prototype as unknown as Record<string, unknown>).resolveRouteCandidate,
			ensureSmartRouteDefaults: (InteractiveMode.prototype as unknown as Record<string, unknown>)
				.ensureSmartRouteDefaults,
			enableRouteIfConfigured: (InteractiveMode.prototype as unknown as Record<string, unknown>)
				.enableRouteIfConfigured,
			showRouteStatusSummary: (InteractiveMode.prototype as unknown as Record<string, unknown>)
				.showRouteStatusSummary,
			handleRouteCommand: (InteractiveMode.prototype as unknown as Record<string, unknown>).handleRouteCommand,
			showRouteSelector: vi.fn(async () => {}),
			showFixedModelFlow: vi.fn(async () => {}),
			showRouteClassifierSelector: vi.fn(async () => {}),
			showRouteFamilyModelSelector: vi.fn(async () => {}),
			handleLoginCommand: vi.fn(async () => {}),
			showStatus: vi.fn(),
			showWarning: vi.fn(),
			showError: vi.fn(),
			footer: { invalidate: vi.fn() },
			session: {
				get routeMode() {
					return routeMode;
				},
				model: models[0],
				setRouteMode: vi.fn((mode: "auto" | "manual") => {
					routeMode = mode;
				}),
				setFixedModelAndDisableRouter: vi.fn(async () => {
					routeMode = "manual";
					enabled = false;
				}),
				modelRegistry: {
					hasConfiguredAuth: vi.fn(() => true),
				},
			},
			settingsManager: {
				getRouterClassifierModel: vi.fn(() => classifierModel),
				setRouterClassifierModel: vi.fn((provider: string, id: string) => {
					classifierModel = `${provider}/${id}`;
				}),
				getRouterModels: vi.fn(() => ({ ...routerModels })),
				setRouterModel: vi.fn((family: string, ref: string) => {
					routerModels[family] = ref;
				}),
				setRouterEnabledAndSetupCompleted: vi.fn((next: boolean) => {
					enabled = next;
				}),
			},
		};

		return {
			context,
			getState: () => ({ routerModels: { ...routerModels }, classifierModel, enabled, routeMode }),
		};
	}

	it("auto-populates smart defaults and enables Route in one step via /route on", async () => {
		const { context, getState } = createRouteContext([
			{ provider: "openabcode", id: "claude-opus-4-8" },
			{ provider: "openabcode", id: "gpt-5.5" },
			{ provider: "openabcode", id: "gemini-3.1-pro-preview" },
			{ provider: "openabcode", id: "gemini-3.1-flash-lite" },
		]);

		await (context.handleRouteCommand as (arg?: string) => Promise<void>).call(context, "on");

		const state = getState();
		expect(state.classifierModel).toBe("openabcode/gemini-3.1-flash-lite");
		expect(state.routerModels).toEqual({
			anthropic: "openabcode/claude-opus-4-8",
			openai: "openabcode/gpt-5.5",
			google: "openabcode/gemini-3.1-pro-preview",
		});
		expect(state.enabled).toBe(true);
		expect(state.routeMode).toBe("auto");
		expect(context.showStatus).toHaveBeenCalledWith("Route on");
	});

	it("supports /route off and /route status subcommands directly", async () => {
		const { context, getState } = createRouteContext([
			{ provider: "anthropic", id: "claude-sonnet-4-6" },
			{ provider: "openai", id: "gpt-5.4" },
		]);

		await (context.handleRouteCommand as (arg?: string) => Promise<void>).call(context, "on");
		expect(getState().routeMode).toBe("auto");
		expect(context.showStatus).toHaveBeenLastCalledWith("Route on (degraded)");

		await (context.handleRouteCommand as (arg?: string) => Promise<void>).call(context, "status");
		expect(context.showStatus).toHaveBeenLastCalledWith(
			expect.stringContaining("Route ON (degraded) · Claude: claude-sonnet-4-6 [anthropic]"),
		);

		await (context.handleRouteCommand as (arg?: string) => Promise<void>).call(context, "off");
		expect(getState().routeMode).toBe("manual");
		expect(context.showStatus).toHaveBeenLastCalledWith("Route off · claude-sonnet-4-6 [anthropic]");
	});
});
