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
		"Test and automation — algorithms, code review, testing, type systems, multimodal/vision, data analysis, scripting",
	google:
		"Google ecosystem — Android, Flutter, Google cloud platform, Firebase, Chrome extensions, Kotlin, Gradle, Google APIs",
	anthropic:
		"Engineering systems — refactoring, debugging, architecture, UI, complex coding tasks, long context, migrations, iOS/macOS apps, DevOps, code quality",
};

export interface RouteSignal {
	text: string;
	fileNames?: string[];
	projectFiles?: string[];
	/** Recent conversation snippets used as extra classifier context (best-effort). */
	recentContext?: string[];
}

/** How a routing decision was made: zero-cost heuristic, sticky reuse, or LLM classifier. */
export type RoutingMethod = "heuristic" | "sticky" | "classifier";

export interface RoutingDecision {
	id: string;
	provider: ProviderChoice;
	source: "classifier" | "preferred";
	/** How the provider choice was made. Pre-existing entries without this field were classifier-based. */
	method?: RoutingMethod;
	/** Heuristic signals that matched, for audit. Only present when method is "heuristic". */
	matchedSignals?: string[];
	/** The model used for LLM classification. Absent for heuristic and sticky decisions. */
	classifierModel?: { provider: string; id: string };
	model: { provider: string; id: string };
	previousModel?: { provider: string; id: string };
	timestamp: number;
}

/** Session entry customType used to persist routing decisions for audit. */
export const ROUTING_ENTRY_TYPE = "openabcode-routing";

// --- Heuristic classifier (zero-cost fast path) ---

/** Per-provider keyword lists that extend the built-in heuristic tables. */
export type RouterHeuristicKeywords = Partial<Record<ProviderChoice, string[]>>;

export interface HeuristicRouteResult {
	choice: ProviderChoice;
	/** "high": multiple independent signals agree; "low": a single weak signal. */
	confidence: "high" | "low";
	/** The signals that matched, for audit and sticky-invalidation comparison. */
	matched: string[];
}

const HEURISTIC_KEYWORDS: Record<ProviderChoice, string[]> = {
	google: [
		"android",
		"flutter",
		"dart",
		"kotlin",
		"gradle",
		"gcp",
		"google cloud",
		"firebase",
		"firestore",
		"chrome extension",
		"play store",
		"安卓",
		"chrome 插件",
	],
	anthropic: [
		"refactor",
		"debug",
		"architecture",
		"migration",
		"swift",
		"ios",
		"macos",
		"xcode",
		"重构",
		"调试",
		"架构",
		"迁移",
	],
	openai: [
		"algorithm",
		"code review",
		"unit test",
		"benchmark",
		"data analysis",
		"devops",
		"pipeline",
		"算法",
		"单元测试",
		"代码审查",
		"数据分析",
	],
};

const HEURISTIC_FILE_EXTENSIONS: Record<string, ProviderChoice> = {
	".kt": "google",
	".kts": "google",
	".dart": "google",
	".gradle": "google",
	".swift": "anthropic",
	".storyboard": "anthropic",
	".xcodeproj": "anthropic",
	".xcworkspace": "anthropic",
};

const HEURISTIC_PROJECT_MARKERS: Record<string, ProviderChoice> = {
	"pubspec.yaml": "google",
	"build.gradle": "google",
	"build.gradle.kts": "google",
	"settings.gradle": "google",
	"settings.gradle.kts": "google",
	"androidmanifest.xml": "google",
	"firebase.json": "google",
	"package.swift": "anthropic",
	podfile: "anthropic",
};

function keywordMatches(keyword: string, text: string): boolean {
	// ASCII-only keywords match on word boundaries to avoid substring noise
	// ("ios" in "kiosk"). CJK and multi-word keywords use plain substring match.
	if (/^[a-z0-9]+$/.test(keyword)) {
		return new RegExp(`\\b${keyword}\\b`).test(text);
	}
	return text.includes(keyword);
}

/**
 * Zero-cost heuristic provider classification from prompt keywords, file
 * extensions, and project marker files. Returns undefined when no signal
 * matches or the top providers tie.
 */
export function classifyProviderHeuristic(
	input: RouteSignal,
	customKeywords?: RouterHeuristicKeywords,
): HeuristicRouteResult | undefined {
	const text = input.text.toLowerCase();
	const fileNames = (input.fileNames ?? []).map((name) => name.toLowerCase());
	const projectFiles = (input.projectFiles ?? []).map((name) => name.toLowerCase());

	const matched: Record<ProviderChoice, Set<string>> = { openai: new Set(), google: new Set(), anthropic: new Set() };

	for (const provider of ROUTE_PROVIDER_CHOICES) {
		const keywords = [...HEURISTIC_KEYWORDS[provider], ...(customKeywords?.[provider] ?? [])];
		for (const keyword of keywords) {
			const normalized = keyword.toLowerCase();
			if (normalized && keywordMatches(normalized, text)) {
				matched[provider].add(`keyword:${normalized}`);
			}
		}
	}

	for (const fileName of fileNames) {
		for (const [extension, provider] of Object.entries(HEURISTIC_FILE_EXTENSIONS)) {
			if (fileName.endsWith(extension)) {
				matched[provider].add(`ext:${extension}`);
			}
		}
	}

	for (const projectFile of projectFiles) {
		const provider = HEURISTIC_PROJECT_MARKERS[projectFile];
		if (provider) {
			matched[provider].add(`project:${projectFile}`);
		}
		// Bundle directories like MyApp.xcodeproj appear as project entries too.
		for (const [extension, extProvider] of Object.entries(HEURISTIC_FILE_EXTENSIONS)) {
			if (projectFile.endsWith(extension)) {
				matched[extProvider].add(`project:${extension}`);
			}
		}
	}

	const scores = ROUTE_PROVIDER_CHOICES.map((provider) => ({ provider, score: matched[provider].size })).sort(
		(a, b) => b.score - a.score,
	);
	const [top, runnerUp] = scores;
	if (top.score === 0 || top.score === runnerUp.score) return undefined;

	return {
		choice: top.provider,
		confidence: top.score >= 2 ? "high" : "low",
		matched: [...matched[top.provider]].sort(),
	};
}

// --- LLM Classifier ---

const CLASSIFIER_TIMEOUT_MS = 60_000;

function isProviderChoice(value: string): value is ProviderChoice {
	return ROUTE_PROVIDER_CHOICES.some((provider) => provider === value);
}

function classifierPrompt(text: string, fileNames: string[], projectFiles: string[], recentContext: string[]): string {
	return `You are a coding task router. Given the project context and user request, choose which AI model provider should handle this task.

Routing rules:
${ROUTE_PROVIDER_CHOICES.map((provider) => `- "${provider}": ${ROUTING_RULES[provider]}`).join("\n")}

Default to "${DEFAULT_PROVIDER_CHOICE}" if the task does not clearly fit another provider.

${projectFiles.length > 0 ? `Project root files: ${projectFiles.join(", ")}\n` : ""}${fileNames.length > 0 ? `Files involved: ${fileNames.join(", ")}\n` : ""}${recentContext.length > 0 ? `Recent conversation:\n${recentContext.map((snippet) => `- ${snippet}`).join("\n")}\n` : ""}Task: "${text}"

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
	const recentContext = (input.recentContext ?? []).filter(Boolean);
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
						content: [
							{ type: "text", text: classifierPrompt(input.text, fileNames, projectFiles, recentContext) },
						],
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
