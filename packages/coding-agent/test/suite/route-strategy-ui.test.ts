import type { Component } from "@openabcode/tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { RouterStrategy } from "../../src/core/router.ts";
import { ChoiceSelectorComponent } from "../../src/modes/interactive/components/choice-selector.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { createHarness, type Harness } from "./harness.ts";

type RouteUiPrototype = {
	handleRouteCommand(this: unknown, arg: string | undefined): Promise<void>;
	applyRouteStrategy(this: unknown, strategy: RouterStrategy): void;
	showRouteStrategySelector(this: unknown, onDone?: () => void): void;
	showRouteSelector(this: unknown, title?: string, selectedValue?: string): Promise<void>;
	showRouteStatusSummary(this: unknown): Promise<void>;
};
const prototype = InteractiveMode.prototype as unknown as RouteUiPrototype;
const harnesses: Harness[] = [];

beforeAll(() => initTheme("dark"));

afterEach(async () => {
	for (const harness of harnesses.splice(0)) {
		await harness.session.dispose();
		harness.cleanup();
	}
});

async function createContext(strategy?: RouterStrategy) {
	const harness = await createHarness({ settings: { router: { strategy } } });
	harnesses.push(harness);
	let selector: ChoiceSelectorComponent | undefined;
	const done = vi.fn();
	return {
		session: harness.session,
		settingsManager: harness.settingsManager,
		footer: { invalidate: vi.fn() },
		ui: { requestRender: vi.fn() },
		showStatus: vi.fn(),
		showError: vi.fn(),
		showSelector: (create: (done: () => void) => { component: Component; focus: Component }) => {
			const result = create(done);
			expect(result.component).toBeInstanceOf(ChoiceSelectorComponent);
			selector = result.component as ChoiceSelectorComponent;
		},
		getSelector: () => {
			if (!selector) throw new Error("No selector opened");
			return selector;
		},
		done,
		applyRouteStrategy: prototype.applyRouteStrategy,
		showRouteStrategySelector: prototype.showRouteStrategySelector,
		showRouteSelector: vi.fn(async (_title?: string, _selectedValue?: string) => {}),
		showRouteStatusSummary: vi.fn(async () => {}),
		enableRouteIfConfigured: vi.fn(async () => {}),
		ensureSmartRouteDefaults: async () => ({
			candidates: harness.models,
			classifier: harness.getModel(),
			families: {},
			configuredSlots: [],
			missingSlots: ["openai", "google", "anthropic"],
			selectableMissingSlots: [],
		}),
	};
}

describe("InteractiveMode Route strategy", () => {
	it.each(["hybrid", "classifier-only"] as const)("sets %s directly without toggling Route", async (strategy) => {
		const context = await createContext();
		await prototype.handleRouteCommand.call(context, `strategy ${strategy}`);
		expect(context.session.routeStrategy).toBe(strategy);
		expect(context.session.routeMode).toBe("manual");
		expect(context.settingsManager.getRouterEnabled()).toBe(false);
		expect(context.footer.invalidate).toHaveBeenCalledOnce();
		expect(context.showStatus).toHaveBeenCalledWith(expect.stringContaining(`Route strategy: ${strategy}`));
		expect(context.showError).not.toHaveBeenCalled();
	});

	it("normalizes command casing and whitespace", async () => {
		const context = await createContext();
		await prototype.handleRouteCommand.call(context, "  STRATEGY   CLASSIFIER-ONLY  ");
		expect(context.session.routeStrategy).toBe("classifier-only");
	});

	it.each(["strategy unknown", "strategy classifier-only extra", "strategies hybrid"])("rejects %s", async (arg) => {
		const context = await createContext();
		await prototype.handleRouteCommand.call(context, arg);
		expect(context.session.routeStrategy).toBe("hybrid");
		expect(context.showError).toHaveBeenCalledWith(expect.stringContaining("Usage: /route"));
		expect(context.showStatus).not.toHaveBeenCalled();
	});

	it("opens the selector with the effective strategy selected and saves the chosen strategy", async () => {
		const context = await createContext("classifier-only");
		await prototype.handleRouteCommand.call(context, "strategy");
		const list = context.getSelector().getSelectList();
		expect(list.getSelectedItem()?.value).toBe("classifier-only");
		expect(context.getSelector().render(80).join("\n")).toContain("latency and cost");
		list.onSelect?.({ value: "hybrid", label: "Hybrid" });
		expect(context.session.routeStrategy).toBe("hybrid");
		expect(context.done).toHaveBeenCalledOnce();
	});

	it("cancels without changing settings", async () => {
		const context = await createContext();
		await prototype.handleRouteCommand.call(context, "strategy");
		context.getSelector().getSelectList().onCancel?.();
		expect(context.settingsManager.getGlobalSettings().router?.strategy).toBeUndefined();
		expect(context.showStatus).not.toHaveBeenCalled();
		expect(context.done).toHaveBeenCalledOnce();
		expect(context.ui.requestRender).toHaveBeenCalledOnce();
	});

	it("exposes strategy in the Route dashboard and returns there after selection", async () => {
		const context = await createContext("classifier-only");
		await prototype.showRouteSelector.call(context);
		expect(context.getSelector().render(120).join("\n")).toContain("Strategy: Classifier only");
		context.getSelector().getSelectList().onSelect?.({ value: "strategy", label: "Strategy" });
		expect(context.getSelector().getSelectList().getSelectedItem()?.value).toBe("classifier-only");
		context.getSelector().getSelectList().onSelect?.({ value: "hybrid", label: "Hybrid" });
		expect(context.session.routeStrategy).toBe("hybrid");
		expect(context.showRouteSelector).toHaveBeenCalledWith("Route", "strategy");
	});

	it("shows the effective strategy and inactive reason in status", async () => {
		const context = await createContext("classifier-only");
		context.session.setRouteMode("auto");
		await prototype.showRouteStatusSummary.call(context);
		expect(context.showStatus).toHaveBeenCalledWith(expect.stringContaining("Strategy: classifier-only"));
		expect(context.showStatus).toHaveBeenCalledWith(expect.stringContaining("Inactive: no-classifier"));
	});
});
