import { describe, expect, it } from "vitest";
import { getModel, getModels } from "../src/compat.ts";

describe("Xiaomi MiMo models", () => {
	it.each(["mimo-v2.5-pro-ultraspeed", "mimo-v2.6-pro-ultraspeed"] as const)(
		"keeps %s on the API billing provider",
		(modelId) => {
			expect(getModel("xiaomi", modelId)).toBeDefined();
		},
	);

	it.each(["xiaomi-token-plan-cn", "xiaomi-token-plan-ams", "xiaomi-token-plan-sgp"] as const)(
		"omits API-billing-only models from %s",
		(provider) => {
			const modelIds = getModels(provider).map((model) => model.id);
			expect(modelIds).not.toContain("mimo-v2.5-pro-ultraspeed");
			expect(modelIds).not.toContain("mimo-v2.6-pro-ultraspeed");
		},
	);
});
