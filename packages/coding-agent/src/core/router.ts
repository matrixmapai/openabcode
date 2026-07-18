/**
 * OpenABCode task router.
 *
 * Classifies each coding task with the configured Route model and picks the best
 * available model for the chosen provider. Ported from the opencode-based
 * OpenABCode core (packages/core/src/router.ts) onto the openabcode runtime.
 */

import type { Api, Model, SimpleStreamOptions } from "@openabcode/ai";
import { completeSimple } from "@openabcode/ai/compat";
import {
	OPENABCODE_HOSTED_UPSTREAM,
	OPENABCODE_PROVIDER_ID as OPENABCODE_PROVIDER,
} from "@openabcode/ai/providers/openabcode";

export const ROUTE_PROVIDER_CHOICES = ["openai", "google", "anthropic"] as const;
export type ProviderChoice = (typeof ROUTE_PROVIDER_CHOICES)[number];

const DEFAULT_PROVIDER_CHOICE: ProviderChoice = "anthropic";
const OPENROUTER_PROVIDER = "openrouter";
const CLASSIFIER_SYSTEM_PROMPT = "Classify the coding task into exactly one model provider.";
const ROUTING_RULES: Record<ProviderChoice, string> = {
	openai:
		"Test and automation — choose for algorithms, code review, testing, data analysis, scripting, and CI/CD pipeline work",
	google:
		"Google ecosystem — choose when the task specifically depends on Android, Flutter, Firebase, Google Cloud, Chrome extensions, Gradle, Kotlin, or Google APIs",
	anthropic:
		"General development — choose for all code writing, editing, debugging, architecture, refactoring, migrations, UI implementation, and any development task that does not specifically fit google or openai",
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

/**
 * All configurable router overrides, loaded from settings.json.
 * When a field is set it fully replaces the corresponding built-in default.
 */
export interface RouterConfig {
	/** LLM classifier descriptions per provider. Replaces ROUTING_RULES. */
	rules?: Partial<Record<ProviderChoice, string>>;
	/** Per-provider keyword lists. Replaces HEURISTIC_KEYWORDS. */
	keywords?: RouterHeuristicKeywords;
	/** File extension → provider mappings. Replaces HEURISTIC_FILE_EXTENSIONS. */
	fileExtensions?: Record<string, ProviderChoice>;
	/** Project marker → provider mappings. Replaces HEURISTIC_PROJECT_MARKERS. */
	projectMarkers?: Record<string, ProviderChoice>;
	/** Default fallback provider. Replaces DEFAULT_PROVIDER_CHOICE. */
	defaultProvider?: ProviderChoice;
}

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
	],
	openai: [
		"algorithm",
		"code review",
		"unit test",
		"benchmark",
		"data analysis",
		"test coverage",
		"ci/cd",
		"pipeline",
		"multimodal",
	],
	anthropic: [
		"refactor",
		"debug",
		"architecture",
		"migration",
		"implement",
		"build",
		"create",
		"fix",
		"feature",
		"component",
		"module",
	],
};

const HEURISTIC_FILE_EXTENSIONS: Record<string, ProviderChoice> = {
	// Google ecosystem
	".kt": "google",
	".kts": "google",
	".dart": "google",
	".gradle": "google",
	// Anthropic / primary coding (all non-Google languages)
	".swift": "anthropic",
	".storyboard": "anthropic",
	".xcodeproj": "anthropic",
	".xcworkspace": "anthropic",
	".rs": "anthropic",
	".c": "anthropic",
	".h": "anthropic",
	".cpp": "anthropic",
	".cc": "anthropic",
	".cxx": "anthropic",
	".hpp": "anthropic",
	".hxx": "anthropic",
	".zig": "anthropic",
	".scala": "anthropic",
	".sc": "anthropic",
	".ex": "anthropic",
	".exs": "anthropic",
	".erl": "anthropic",
	".hrl": "anthropic",
	".hs": "anthropic",
	".ml": "anthropic",
	".mli": "anthropic",
	".clj": "anthropic",
	".cljs": "anthropic",
	".py": "anthropic",
	".js": "anthropic",
	".mjs": "anthropic",
	".cjs": "anthropic",
	".ts": "anthropic",
	".mts": "anthropic",
	".jsx": "anthropic",
	".tsx": "anthropic",
	".java": "anthropic",
	".go": "anthropic",
	".rb": "anthropic",
	".php": "anthropic",
	".cs": "anthropic",
	".lua": "anthropic",
	".r": "anthropic",
	".jl": "anthropic",
	".vue": "anthropic",
	".svelte": "anthropic",
	".proto": "anthropic",
	".css": "anthropic",
	".scss": "anthropic",
	".less": "anthropic",
	".html": "anthropic",
	// OpenAI / test, automation, scripting, data
	".sh": "openai",
	".bash": "openai",
	".ps1": "openai",
	".sql": "openai",
	".tf": "openai",
	".graphql": "openai",
	".gql": "openai",
};

const HEURISTIC_PROJECT_MARKERS: Record<string, ProviderChoice> = {
	// Google ecosystem
	"pubspec.yaml": "google",
	"build.gradle": "google",
	"build.gradle.kts": "google",
	"settings.gradle": "google",
	"settings.gradle.kts": "google",
	"androidmanifest.xml": "google",
	"firebase.json": "google",
	// Anthropic / primary coding (all non-Google project types)
	"package.swift": "anthropic",
	podfile: "anthropic",
	"cargo.toml": "anthropic",
	"cmakelists.txt": "anthropic",
	makefile: "anthropic",
	"build.zig": "anthropic",
	"build.sbt": "anthropic",
	"mix.exs": "anthropic",
	"rebar.config": "anthropic",
	"stack.yaml": "anthropic",
	"cabal.project": "anthropic",
	"dune-project": "anthropic",
	"project.clj": "anthropic",
	"deps.edn": "anthropic",
	"package.json": "anthropic",
	"tsconfig.json": "anthropic",
	"pyproject.toml": "anthropic",
	"setup.py": "anthropic",
	"requirements.txt": "anthropic",
	pipfile: "anthropic",
	"go.mod": "anthropic",
	"pom.xml": "anthropic",
	gemfile: "anthropic",
	"composer.json": "anthropic",
	"nuget.config": "anthropic",
	// OpenAI / test, automation, infrastructure
	"main.tf": "openai",
	dockerfile: "openai",
	"docker-compose.yml": "openai",
	"docker-compose.yaml": "openai",
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
 *
 * When a config table is provided it fully replaces the corresponding built-in
 * default; when absent the built-in table is used.
 */
export function classifyProviderHeuristic(input: RouteSignal, config?: RouterConfig): HeuristicRouteResult | undefined {
	const text = input.text.toLowerCase();
	const fileNames = (input.fileNames ?? []).map((name) => name.toLowerCase());
	const projectFiles = (input.projectFiles ?? []).map((name) => name.toLowerCase());

	const matched: Record<ProviderChoice, Set<string>> = { openai: new Set(), google: new Set(), anthropic: new Set() };

	const effectiveKeywords: Record<ProviderChoice, string[]> = config?.keywords
		? { openai: [], google: [], anthropic: [], ...config.keywords }
		: HEURISTIC_KEYWORDS;
	for (const provider of ROUTE_PROVIDER_CHOICES) {
		for (const keyword of effectiveKeywords[provider]) {
			const normalized = keyword.toLowerCase();
			if (normalized && keywordMatches(normalized, text)) {
				matched[provider].add(`keyword:${normalized}`);
			}
		}
	}

	const effectiveFileExtensions = config?.fileExtensions ?? HEURISTIC_FILE_EXTENSIONS;
	for (const fileName of fileNames) {
		for (const [extension, provider] of Object.entries(effectiveFileExtensions)) {
			if (fileName.endsWith(extension)) {
				matched[provider].add(`ext:${extension}`);
			}
		}
	}

	const effectiveProjectMarkers = config?.projectMarkers ?? HEURISTIC_PROJECT_MARKERS;
	for (const projectFile of projectFiles) {
		const provider = effectiveProjectMarkers[projectFile];
		if (provider) {
			matched[provider].add(`project:${projectFile}`);
		}
		// Bundle directories like MyApp.xcodeproj appear as project entries too.
		for (const [extension, extProvider] of Object.entries(effectiveFileExtensions)) {
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

	// Project and file signals pointing to the default provider merely confirm
	// the ambient ecosystem, so let the classifier evaluate task complexity.
	// Explicit task keywords remain distinctive and may override sticky routing.
	const effectiveDefault = config?.defaultProvider ?? DEFAULT_PROVIDER_CHOICE;
	const hasTaskKeyword = [...matched[top.provider]].some((signal) => signal.startsWith("keyword:"));
	if (top.provider === effectiveDefault && !hasTaskKeyword) return undefined;

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

function classifierPrompt(
	text: string,
	fileNames: string[],
	projectFiles: string[],
	recentContext: string[],
	config?: RouterConfig,
): string {
	const rules = config?.rules ?? ROUTING_RULES;
	const defaultProvider = config?.defaultProvider ?? DEFAULT_PROVIDER_CHOICE;
	return `You are a coding task router. Given the project context and user request, choose which AI model provider should handle this task.

Routing rules:
${ROUTE_PROVIDER_CHOICES.map((provider) => `- "${provider}": ${rules[provider] ?? "(no rule)"}`).join("\n")}

Default to "${defaultProvider}" if the task does not clearly fit another provider.

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
	config?: RouterConfig,
): Promise<ProviderChoice> {
	const defaultProvider = config?.defaultProvider ?? DEFAULT_PROVIDER_CHOICE;
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
							{
								type: "text",
								text: classifierPrompt(input.text, fileNames, projectFiles, recentContext, config),
							},
						],
						timestamp: Date.now(),
					},
				],
			},
			{ ...options, signal: controller.signal, temperature: 0, maxTokens: 16 },
		);

		if (response.stopReason === "error" || response.stopReason === "aborted") return defaultProvider;
		const raw = response.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("")
			.trim()
			.toLowerCase()
			.replace(/"/g, "");
		if (isProviderChoice(raw)) return raw;
		return defaultProvider;
	} catch {
		return defaultProvider;
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
