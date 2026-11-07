import { describe, expect, it } from "vitest";
import { getModel, streamSimple } from "../src/compat.ts";
import type { Model } from "../src/types.ts";

async function capturePayload(model: Model<"openai-completions">): Promise<unknown> {
	let payload: unknown;
	const response = await streamSimple(
		model,
		{ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
		{
			apiKey: "test-key",
			onPayload: (params) => {
				payload = params;
				// Abort before the SDK sends any request; this is a payload-only regression.
				throw new Error("Payload captured without network access");
			},
		},
	).result();
	expect(response.errorMessage).toContain("Payload captured without network access");
	return payload;
}

describe("OpenABCode Chat Completions store compatibility", () => {
	it.each(["gemini-3.1-flash-lite", "gpt-5.5", "claude-sonnet-4.6"])("omits store for hosted %s", async (id) => {
		const model = getModel("openabcode", id)!;
		expect(await capturePayload(model)).not.toHaveProperty("store");
	});

	it("also handles synced/custom hosted models with no explicit compatibility flags", async () => {
		const model = getModel("openabcode", "gemini-3.1-flash-lite")!;
		expect(
			await capturePayload({
				...model,
				id: "gemini-synced",
				baseUrl: "https://gateway.example.invalid/v1",
				compat: undefined,
			}),
		).not.toHaveProperty("store");
	});

	it("retains store:false for standard OpenAI Chat Completions", async () => {
		const model = getModel("openai", "gpt-4o-mini")!;
		expect(await capturePayload({ ...model, api: "openai-completions", compat: undefined })).toHaveProperty(
			"store",
			false,
		);
	});

	it("allows an explicit compatibility override for custom hosted endpoints", async () => {
		const model = getModel("openabcode", "gemini-3.1-flash-lite")!;
		expect(await capturePayload({ ...model, compat: { supportsStore: true } })).toHaveProperty("store", false);
	});
});
