import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalPiExperimental = process.env.OPENABCODE_EXPERIMENTAL;

	afterEach(() => {
		if (originalPiExperimental === undefined) {
			delete process.env.OPENABCODE_EXPERIMENTAL;
		} else {
			process.env.OPENABCODE_EXPERIMENTAL = originalPiExperimental;
		}
	});

	it("returns false when OPENABCODE_EXPERIMENTAL is unset", () => {
		delete process.env.OPENABCODE_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when OPENABCODE_EXPERIMENTAL is empty", () => {
		process.env.OPENABCODE_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when OPENABCODE_EXPERIMENTAL is set to 1", () => {
		process.env.OPENABCODE_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when OPENABCODE_EXPERIMENTAL is set to 0", () => {
		process.env.OPENABCODE_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when OPENABCODE_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.OPENABCODE_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
