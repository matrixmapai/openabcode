/**
 * OpenABCode task router.
 *
 * Classifies each coding task with a cheap LLM call (Gemini Flash) and picks the
 * best available model for the chosen provider. Ported from the opencode-based
 * OpenABCode core (packages/core/src/router.ts) onto the openabcode runtime.
 */

import type { Api, Model } from "@openabcode/ai";
import { OPENABCODE_HOSTED_UPSTREAM, OPENABCODE_PROVIDER } from "./openabcode-provider.ts";

export type ProviderChoice = "google" | "anthropic" | "openai";

export interface RouteSignal {
	text: string;
	fileNames?: string[];
	projectFiles?: string[];
}

export interface RoutingDecision {
	provider: ProviderChoice;
	source: "classifier" | "preferred";
	model: { provider: string; id: string };
	previousModel?: { provider: string; id: string };
	timestamp: number;
}

/** Session entry customType used to persist routing decisions for audit. */
export const ROUTING_ENTRY_TYPE = "openabcode-routing";

// --- LLM Classifier ---

const CLASSIFIER_MODEL = "gemini-3-flash-preview";
const CLASSIFIER_TIMEOUT_MS = 3_000;
const CLASSIFIER_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export function classifierApiKey(): string | undefined {
	return (
		process.env.GEMINI_API_KEY ??
		process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
		process.env.GEMINI_AISTUDIO_API_KEY ??
		process.env.GOOGLE_AI_STUDIO_API_KEY
	);
}

function classifierPrompt(text: string, fileNames: string[], projectFiles: string[]): string {
	return `You are a coding task router. Given the project context and user request, choose which AI model provider should handle this task.

Routing rules:
- "google": Google ecosystem tasks — Android, Flutter, GCP, Firebase, Chrome extensions, Kotlin, Gradle, Google APIs
- "anthropic": Engineering systems — refactoring, debugging, architecture, UI, complex coding tasks, long context, migrations, iOS/macOS apps, code quality
- "openai": Logic and automation — algorithms, code review, testing, type systems, concurrency, multimodal/vision, data analysis, scripting, DevOps

Default to "anthropic" if the task does not clearly fit "google" or "openai".

${projectFiles.length > 0 ? `Project root files: ${projectFiles.join(", ")}\n` : ""}${fileNames.length > 0 ? `Files involved: ${fileNames.join(", ")}\n` : ""}Task: "${text}"

Return ONLY one of: "google", "anthropic", "openai"`;
}

/**
 * Use Gemini Flash to directly choose the best provider for this task.
 * Falls back to "anthropic" (default) on any failure or timeout.
 */
export async function classifyProvider(input: RouteSignal, apiKey = classifierApiKey()): Promise<ProviderChoice> {
	if (!apiKey) return "anthropic";

	const fileNames = (input.fileNames ?? []).filter(Boolean);
	const projectFiles = input.projectFiles ?? [];

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);

		const response = await fetch(`${CLASSIFIER_URL}/${CLASSIFIER_MODEL}:generateContent?key=${apiKey}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			signal: controller.signal,
			body: JSON.stringify({
				contents: [{ parts: [{ text: classifierPrompt(input.text, fileNames, projectFiles) }] }],
				generationConfig: {
					temperature: 0,
					maxOutputTokens: 16,
				},
			}),
		});
		clearTimeout(timeout);

		if (!response.ok) return "anthropic";

		const data = (await response.json()) as {
			candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
		};
		const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase().replace(/"/g, "");
		if (raw === "google" || raw === "anthropic" || raw === "openai") return raw;
		return "anthropic";
	} catch {
		return "anthropic";
	}
}

// --- Model selection ---

/** Map a model to the provider choice it can serve, or undefined if not routable. */
export function routeProviderOf(model: Model<Api>): ProviderChoice | undefined {
	if (model.provider === OPENABCODE_PROVIDER) {
		return OPENABCODE_HOSTED_UPSTREAM[model.id];
	}
	if (model.provider === "openrouter") {
		if (model.id.startsWith("anthropic/")) return "anthropic";
		if (model.id.startsWith("openai/")) return "openai";
		if (model.id.startsWith("google/")) return "google";
		return undefined;
	}
	if (model.provider === "anthropic") return "anthropic";
	if (model.provider === "openai") return "openai";
	if (model.provider === "google") return "google";
	return undefined;
}

/**
 * Pick the best available model for a provider choice.
 *
 * Only the explicit model selected through /model for this family is eligible.
 */
export function pickRouteModel(
	choice: ProviderChoice,
	models: Model<Api>[],
	hasAuth: (model: Model<Api>) => boolean,
	preferred?: Partial<Record<ProviderChoice, string>>,
): { model: Model<Api>; source: "classifier" | "preferred" } | undefined {
	const preferredRef = preferred?.[choice];
	if (preferredRef) {
		const [providerName, ...idParts] = preferredRef.split("/");
		const id = idParts.join("/");
		const match = models.find(
			(m) => m.provider === providerName && m.id === id && routeProviderOf(m) === choice && hasAuth(m),
		);
		if (match) return { model: match, source: "preferred" };
	}

	return undefined;
}
