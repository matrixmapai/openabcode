/**
 * OpenABCode task router.
 *
 * Classifies each coding task with the configured Route model and picks the best
 * available model for the chosen provider. Ported from the opencode-based
 * OpenABCode core (packages/core/src/router.ts) onto the openabcode runtime.
 */

import type { Api, Model, SimpleStreamOptions } from "@openabcode/ai";
import { completeSimple } from "@openabcode/ai/compat";
import { OPENABCODE_HOSTED_UPSTREAM, OPENABCODE_PROVIDER } from "./openabcode-provider.ts";

export const ROUTE_PROVIDER_CHOICES = ["openai", "google", "anthropic"] as const;
export type ProviderChoice = (typeof ROUTE_PROVIDER_CHOICES)[number];

const DEFAULT_PROVIDER_CHOICE: ProviderChoice = "openai";
const OPENROUTER_PROVIDER = "openrouter";
const CLASSIFIER_SYSTEM_PROMPT = "Classify the coding task into exactly one model provider.";
const ROUTING_RULES: Record<ProviderChoice, string> = {
	openai:
		"Logic and automation — algorithms, code review, testing, type systems, concurrency, multimodal/vision, data analysis, scripting, DevOps",
	google: "Google ecosystem tasks — Android, Flutter, GCP, Firebase, Chrome extensions, Kotlin, Gradle, Google APIs",
	anthropic:
		"Engineering systems — refactoring, debugging, architecture, UI, complex coding tasks, long context, migrations, iOS/macOS apps, code quality",
};

export interface RouteSignal {
	text: string;
	fileNames?: string[];
	projectFiles?: string[];
}

export interface RoutingDecision {
	id: string;
	provider: ProviderChoice;
	source: "classifier" | "preferred";
	classifierModel: { provider: string; id: string };
	model: { provider: string; id: string };
	previousModel?: { provider: string; id: string };
	timestamp: number;
}

/** Session entry customType used to persist routing decisions for audit. */
export const ROUTING_ENTRY_TYPE = "openabcode-routing";

// --- LLM Classifier ---

const CLASSIFIER_TIMEOUT_MS = 60_000;

function isProviderChoice(value: string): value is ProviderChoice {
	return ROUTE_PROVIDER_CHOICES.some((provider) => provider === value);
}

function classifierPrompt(text: string, fileNames: string[], projectFiles: string[]): string {
	return `You are a coding task router. Given the project context and user request, choose which AI model provider should handle this task.

Routing rules:
${ROUTE_PROVIDER_CHOICES.map((provider) => `- "${provider}": ${ROUTING_RULES[provider]}`).join("\n")}

Default to "${DEFAULT_PROVIDER_CHOICE}" if the task does not clearly fit another provider.

${projectFiles.length > 0 ? `Project root files: ${projectFiles.join(", ")}\n` : ""}${fileNames.length > 0 ? `Files involved: ${fileNames.join(", ")}\n` : ""}Task: "${text}"

Return ONLY one of: ${ROUTE_PROVIDER_CHOICES.map((provider) => `"${provider}"`).join(", ")}`;
}

/**
 * Use the configured classifier model to choose the best provider for this task.
 * Falls back to "openai" (default) on any failure or timeout.
 */
export async function classifyProvider(
	model: Model<Api>,
	input: RouteSignal,
	options: SimpleStreamOptions,
): Promise<ProviderChoice> {
	const fileNames = (input.fileNames ?? []).filter(Boolean);
	const projectFiles = input.projectFiles ?? [];
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);

	try {
		const response = await completeSimple(
			model,
			{
				systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: classifierPrompt(input.text, fileNames, projectFiles) }],
						timestamp: Date.now(),
					},
				],
			},
			{ ...options, signal: controller.signal, temperature: 0, maxTokens: 16 },
		);

		if (response.stopReason === "error" || response.stopReason === "aborted") return DEFAULT_PROVIDER_CHOICE;
		const raw = response.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("")
			.trim()
			.toLowerCase()
			.replace(/"/g, "");
		if (isProviderChoice(raw)) return raw;
		return DEFAULT_PROVIDER_CHOICE;
	} catch {
		return DEFAULT_PROVIDER_CHOICE;
	} finally {
		clearTimeout(timeout);
	}
}

// --- Model selection ---

/** Map a model to the provider choice it can serve, or undefined if not routable. */
export function routeProviderOf(model: Model<Api>): ProviderChoice | undefined {
	if (model.provider === OPENABCODE_PROVIDER) {
		return OPENABCODE_HOSTED_UPSTREAM[model.id];
	}
	if (model.provider === OPENROUTER_PROVIDER) {
		return ROUTE_PROVIDER_CHOICES.find((provider) => model.id.startsWith(`${provider}/`));
	}
	if (isProviderChoice(model.provider)) return model.provider;
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
