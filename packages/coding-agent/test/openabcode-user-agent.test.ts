import { describe, expect, it } from "vitest";
import { getOpenABCodeUserAgent } from "../src/utils/openabcode-user-agent.ts";

describe("getOpenABCodeUserAgent", () => {
	it("formats the user agent string", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getOpenABCodeUserAgent("1.2.3");

		expect(userAgent).toBe(`openabcode/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^openabcode\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
