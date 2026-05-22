import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { inferPromptProfileSmart } from "./prompt-understanding.ts";
import {
	applyBuiltInModelFilterPreset,
	applyModelFilters,
	getProviderFilterConfig,
	normalizeModelFilters,
	type RouterModelFilters,
} from "./model-filters-screen.ts";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type PromptLengthType = "medium" | "medium_coding" | "long" | "vision_single_image" | "100k";
export type RouteObjective = "balanced" | "quality" | "cheapest" | "fastest";
export type DataSourceMode = "api" | "page-scrape";
export type ProviderScopeMode = "configured-provider";

export type BenchmarkKey =
	| "intelligence_index"
	| "agentic_index"
	| "coding_index"
	| "gdpval_normalized"
	| "tau2"
	| "terminalbench_hard"
	| "scicode"
	| "livecodebench"
	| "ifbench"
	| "omniscience"
	| "gpqa"
	| "hle"
	| "critpt"
	| "lcr";

export interface RouterConfig {
	enabled: boolean;
	dataSource: {
		mode: DataSourceMode;
		baseUrl: string;
		apiPath: string;
		pageUrl: string;
		apiKeyEnv?: string;
		cacheTtlMinutes: number;
		requestTimeoutMs: number;
		parallelQueries: number;
		promptLength: PromptLengthType;
	};
	strategy: {
		objective: RouteObjective;
		qualityFloor: number;
		preferCurrentWithin: number;
		minAaMatch: number;
		minRouteConfidence: number;
		routingProvider?: string;
	};
	ui: {
		showAdvancedSettings: boolean;
		autoAcceptRouting: boolean;
	};
	filters: RouterModelFilters;
	modelOverrides: Record<string, string>;
}

export interface PromptSpeedProfile {
	promptLengthType: PromptLengthType;
	medianOutputSpeed?: number;
	medianTimeToFirstAnswerToken?: number;
	medianEndToEndResponseTime?: number;
}

export interface AaModel {
	sourceMode: DataSourceMode;
	slug: string;
	name: string;
	shortName: string;
	creatorName?: string;
	modelUrl?: string;
	hostLabel?: string;
	hostSlug?: string;
	hostApiId?: string;
	intelligenceIndex?: number;
	agenticIndex?: number;
	codingIndex?: number;
	gdpvalNormalized?: number;
	tau2?: number;
	terminalbenchHard?: number;
	scicode?: number;
	livecodebench?: number;
	ifbench?: number;
	omniscience?: number;
	gpqa?: number;
	hle?: number;
	critpt?: number;
	lcr?: number;
	contextWindowTokens?: number;
	priceInputPer1M?: number;
	priceOutputPer1M?: number;
	priceBlendedPer1M?: number;
	cacheHitPricePer1M?: number;
	reasoningModel: boolean;
	inputModalityImage: boolean;
	performanceByPromptLength: PromptSpeedProfile[];
	fallbackTimeToFirstAnswerToken?: number;
	fallbackEndToEndResponseTime?: number;
	tokenBurn?: number;
}

export interface MetricRange {
	min: number;
	max: number;
}

export interface DatasetStats {
	metrics: Record<string, MetricRange>;
}

export interface AaDataset {
	fetchedAt: number;
	sourceKey: string;
	sourceLabel: string;
	models: AaModel[];
}

export interface PromptProfile {
	summary: string;
	matchedSignals: string[];
	benchmarkWeights: Record<BenchmarkKey, number>;
	priorities: {
		costSensitivity: number;
		speedSensitivity: number;
		reasoningNeed: number;
		contextNeed: number;
		visionNeed: number;
		toolUseNeed: number;
		formatReliabilityNeed: number;
	};
	targetThinkingLevel: ThinkingLevel;
	promptLengthType: PromptLengthType;
	complexityScore?: number;
	routingTier?: string;
	analysisNotes?: string[];
	uncertain?: boolean;
	classifierSource?: string;
}

export interface CandidateScoreBreakdown {
	quality: number;
	cost: number;
	speed: number;
	latency: number;
	context: number;
	match: number;
}

export interface CandidateConfidence {
	match: number;
	constraints: number;
	cost: number;
	overall: number;
	notes: string[];
}

export interface Candidate {
	piModel: Model<Api>;
	candidateThinkingLevel: ThinkingLevel;
	requestedThinkingLevel: ThinkingLevel;
	aaModel: AaModel;
	aaMatchScore: number;
	aaVariantLevel: ThinkingLevel;
	benchmarkScore: number;
	price: number;
	tokenBurn?: number;
	speed?: number;
	latency?: number;
	contextWindow: number;
	economicScore: number;
	speedScore: number;
	latencyScore: number;
	contextScore: number;
	scoreBreakdown: CandidateScoreBreakdown;
	confidence?: CandidateConfidence;
	reasonBits: string[];
	composite: number;
}

export interface RouteCandidateSummary {
	rank: number;
	provider: string;
	modelId: string;
	modelName: string;
	thinkingLevel: ThinkingLevel;
	aaName: string;
	aaHost?: string;
	benchmarkScore: number;
	composite: number;
	economicScore: number;
	speedScore: number;
	latencyScore: number;
	contextScore: number;
	confidence?: CandidateConfidence;
	reasonBits: string[];
}

export interface RouteDecisionSummary {
	timestamp: number;
	changedModel: boolean;
	changedThinkingLevel: boolean;
	provider: string;
	providerScopeMode: ProviderScopeMode;
	providerScopeLabel: string;
	availableModelCount: number;
	availableRouteCount: number;
	dataSourceLabel: string;
	objectiveUsed: RouteObjective;
	modelId: string;
	modelName: string;
	requestedThinkingLevel: ThinkingLevel;
	thinkingLevel: ThinkingLevel;
	aaSlug: string;
	aaName: string;
	aaHost?: string;
	benchmarkSummary: string[];
	profileSummary: string;
	complexityScore?: number;
	routingTier?: string;
	classifierSource?: string;
	confidence?: CandidateConfidence;
	reasonLines: string[];
	shortSummary: string[];
	topCandidates: RouteCandidateSummary[];
}

export const DEFAULT_CONFIG: RouterConfig = {
	enabled: false,
	dataSource: {
		mode: "api",
		baseUrl: "https://artificialanalysis.ai",
		apiPath: "/api/data/website/host-models/performance",
		pageUrl: "https://artificialanalysis.ai/evaluations/terminalbench-hard",
		apiKeyEnv: "ARTIFICIAL_ANALYSIS_API_KEY",
		cacheTtlMinutes: 12 * 60,
		requestTimeoutMs: 20_000,
		parallelQueries: 1,
		promptLength: "medium",
	},
	strategy: {
		objective: "balanced",
		qualityFloor: 0.88,
		preferCurrentWithin: 0.04,
		minAaMatch: 0.52,
		minRouteConfidence: 0.42,
		routingProvider: undefined,
	},
	ui: {
		showAdvancedSettings: false,
		autoAcceptRouting: false,
	},
	filters: {
		providers: {
			openrouter: { preset: "benchmark-safe", disabledFamilies: [], disabledModels: [] },
			"vercel-ai-gateway": { preset: "benchmark-safe", disabledFamilies: [], disabledModels: [] },
		},
	},
	modelOverrides: {
		"github-copilot/claude-haiku-4.5": "claude-4-5-haiku",
		"github-copilot/claude-haiku-4.5@off": "claude-4-5-haiku",
		"openrouter/anthropic/claude-haiku-4.5": "claude-4-5-haiku",
		"openrouter/anthropic/claude-haiku-4.5@off": "claude-4-5-haiku",
		"openrouter/deepseek/deepseek-v4-flash@off": "deepseek-v4-flash-non-reasoning",
		"openrouter/deepseek/deepseek-v4-flash@minimal": "deepseek-v4-flash-non-reasoning",
		"openrouter/deepseek/deepseek-v4-flash@low": "deepseek-v4-flash-non-reasoning",
		"openrouter/deepseek/deepseek-v4-flash": "deepseek-v4-flash",
	},
};

export const BENCHMARK_LABELS: Record<BenchmarkKey, string> = {
	intelligence_index: "Intelligence",
	agentic_index: "Agentic",
	coding_index: "Coding",
	gdpval_normalized: "GDPval-AA",
	tau2: "τ²-Bench",
	terminalbench_hard: "Terminal-Bench Hard",
	scicode: "SciCode",
	livecodebench: "LiveCodeBench",
	ifbench: "IFBench",
	omniscience: "AA-Omniscience",
	gpqa: "GPQA",
	hle: "Humanity's Last Exam",
	critpt: "CritPt",
	lcr: "AA-LCR",
};

export const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
export const PROVIDER_HOST_ALIASES: Record<string, string[]> = {
	"amazon-bedrock": ["amazon-bedrock", "amazon bedrock", "bedrock", "aws"],
	anthropic: ["anthropic"],
	google: ["google", "vertex", "google vertex"],
	"google-vertex": ["google", "vertex", "google vertex"],
	openai: ["openai"],
	"azure-openai-responses": ["azure", "azure openai", "openai"],
	"openai-codex": ["openai", "codex"],
	deepseek: ["deepseek"],
	"github-copilot": ["github copilot", "copilot"],
	xai: ["xai", "x.ai", "grok"],
	groq: ["groq"],
	cerebras: ["cerebras"],
	openrouter: ["openrouter"],
	"vercel-ai-gateway": ["vercel", "vercel ai gateway"],
	zai: ["zai"],
	mistral: ["mistral"],
	minimax: ["minimax"],
	"minimax-cn": ["minimax"],
	moonshotai: ["moonshot", "kimi", "moonshotai"],
	"moonshotai-cn": ["moonshot", "kimi", "moonshotai"],
	huggingface: ["huggingface", "hugging face"],
	fireworks: ["fireworks", "fireworks ai"],
	opencode: ["opencode"],
	"opencode-go": ["opencode"],
	"kimi-coding": ["kimi", "moonshot"],
	"cloudflare-workers-ai": ["cloudflare", "workers ai"],
	"cloudflare-ai-gateway": ["cloudflare", "ai gateway"],
	xiaomi: ["xiaomi"],
	"xiaomi-token-plan-cn": ["xiaomi"],
	"xiaomi-token-plan-ams": ["xiaomi"],
	"xiaomi-token-plan-sgp": ["xiaomi"],
};

export const ROUTER_STATE_ENTRY = "aa-router-state";
export const ROUTER_DECISION_ENTRY = "aa-router-decision";
export const ROUTER_EXTENSION_DIR = join(getAgentDir(), "extensions", "star-router");
export const DEFAULT_TEST_SUITE_FILE = join(ROUTER_EXTENSION_DIR, "test", "prompts.txt");
export const DATA_CACHE_FILE = join(getAgentDir(), "cache", "star-router-public.json");
export const GLOBAL_CONFIG_FILE = join(getAgentDir(), "model-router.json");
export const GLOBAL_FILTER_PRESETS_DIR = join(getAgentDir(), "model-router-filter-presets");

export const FOLLOW_UP_PATTERNS = [
	/^\s*(continue|go ahead|proceed|retry|try again|do it|same|yes|ok|okay)\b/i,
];

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

export function normalizeKey(input: string): string {
	return input
		.toLowerCase()
		.replace(/\([^)]*\)/g, " ")
		.replace(/[./_\s]+/g, "-")
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

export function stripParenthetical(input: string): string {
	return input.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

export function tokenize(input: string): string[] {
	return normalizeKey(input)
		.split("-")
		.filter((part) => part.length > 0);
}

export function aliasSetForPiModel(model: Model<Api>): string[] {
	const aliases = new Set<string>();
	const rawId = model.id;
	const lastSegment = rawId.includes("/") ? rawId.split("/").at(-1) ?? rawId : rawId;
	for (const value of [rawId, lastSegment, model.name, stripParenthetical(model.name)]) {
		const normalized = normalizeKey(value);
		if (normalized) aliases.add(normalized);
	}
	return [...aliases];
}

export function aliasSetForAaModel(model: AaModel): string[] {
	const aliases = new Set<string>();
	for (const value of [model.slug, model.name, model.shortName, stripParenthetical(model.name), stripParenthetical(model.shortName)]) {
		const normalized = normalizeKey(value);
		if (normalized) aliases.add(normalized);
	}
	return [...aliases];
}

export function jaccardSimilarity(a: string, b: string): number {
	const aTokens = new Set(tokenize(a));
	const bTokens = new Set(tokenize(b));
	if (aTokens.size === 0 || bTokens.size === 0) return 0;
	let intersection = 0;
	for (const token of aTokens) {
		if (bTokens.has(token)) intersection += 1;
	}
	const union = aTokens.size + bTokens.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

export function aliasSimilarity(a: string, b: string): number {
	if (!a || !b) return 0;
	if (a === b) return 1;
	if (a.startsWith(b) || b.startsWith(a)) {
		const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
		return 0.86 + ratio * 0.12;
	}
	if (a.includes(b) || b.includes(a)) {
		const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
		return 0.72 + ratio * 0.16;
	}
	return jaccardSimilarity(a, b);
}

export function variantLevelFromAaModel(model: AaModel): ThinkingLevel {
	const text = `${model.slug} ${model.name}`.toLowerCase();
	if (text.includes("non-reasoning")) return "off";
	if (text.includes("minimal")) return "minimal";
	if (/(^|[-\s])low($|[-\s])/.test(text)) return "low";
	if (/(^|[-\s])medium($|[-\s])/.test(text)) return "medium";
	if (/(^|[-\s])high($|[-\s])/.test(text)) return "high";
	if (text.includes("xhigh") || text.includes("max effort") || text.includes("adaptive")) return "xhigh";
	return model.reasoningModel ? "xhigh" : "off";
}

export function thinkingDistance(a: ThinkingLevel, b: ThinkingLevel): number {
	const order: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
	return Math.abs(order.indexOf(a) - order.indexOf(b));
}

export function variantCompatibilityScore(target: ThinkingLevel, actual: ThinkingLevel): number {
	if (target === actual) return 0.28;
	const distance = thinkingDistance(target, actual);
	if (distance === 1) return 0.12;
	if (distance === 2) return 0.04;
	if ((target === "off" && actual !== "off") || (target !== "off" && actual === "off")) return -0.08;
	return -0.02 * distance;
}

export function buildBenchmarkSummary(weights: Record<BenchmarkKey, number>, limit = 3): string[] {
	return (Object.entries(weights) as Array<[BenchmarkKey, number]>)
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.filter(([, value]) => value > 0)
		.map(([key]) => BENCHMARK_LABELS[key]);
}

export function blendPiModelPrice(model: Model<Api>): number | undefined {
	const input = Number(model.cost?.input ?? 0);
	const output = Number(model.cost?.output ?? 0);
	const cacheRead = Number(model.cost?.cacheRead ?? 0);
	const cacheWrite = Number(model.cost?.cacheWrite ?? 0);
	if (![input, output, cacheRead, cacheWrite].every(Number.isFinite)) return undefined;
	if (input <= 0 && output <= 0 && cacheRead <= 0 && cacheWrite <= 0) return undefined;
	return input * 0.68 + output * 0.25 + cacheRead * 0.04 + cacheWrite * 0.03;
}

export function estimateCandidatePrice(model: Model<Api>, aaModel: AaModel, thinkingLevel: ThinkingLevel, profile: PromptProfile): number {
	const base = blendPiModelPrice(model) ?? aaModel.priceBlendedPer1M ?? Number.POSITIVE_INFINITY;
	if (!Number.isFinite(base)) return base;
	const thinkingMultiplier: Record<ThinkingLevel, number> = {
		off: 1,
		minimal: 1.03,
		low: 1.08,
		medium: 1.18,
		high: 1.35,
		xhigh: 1.55,
	};
	const toolMultiplier = 1 + profile.priorities.toolUseNeed * 0.06;
	const imageMultiplier = profile.priorities.visionNeed > 0 ? 1.08 : 1;
	const retryMultiplier = 1 + profile.priorities.reasoningNeed * 0.03 + profile.priorities.formatReliabilityNeed * 0.02;
	return base * thinkingMultiplier[thinkingLevel] * toolMultiplier * imageMultiplier * retryMultiplier;
}

export function getSupportedThinkingLevelsForModel(model: Model<Api>): ThinkingLevel[] {
	if (!model.reasoning) return ["off"];
	return ALL_THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if (level === "xhigh") return mapped !== undefined;
		return true;
	});
}

export function countAvailableRoutes(models: Model<Api>[]): number {
	return models.reduce((total, model) => total + getSupportedThinkingLevelsForModel(model).length, 0);
}

export function listAvailableProviders(models: Model<Api>[]): string[] {
	const seen = new Set<string>();
	const providers: string[] = [];
	for (const model of models) {
		const provider = String(model.provider);
		if (seen.has(provider)) continue;
		seen.add(provider);
		providers.push(provider);
	}
	return providers;
}

export function resolveRoutingProvider(models: Model<Api>[], config: RouterConfig): string | undefined {
	const providers = listAvailableProviders(models);
	if (providers.length === 0) return undefined;
	const configured = config.strategy.routingProvider?.trim();
	if (configured && providers.includes(configured)) return configured;
	return providers[0];
}

export function resolveSelectedRoutingProviderFromAll(models: Model<Api>[], config: RouterConfig): string | undefined {
	const providers = listAvailableProviders(models);
	if (providers.length === 0) return undefined;
	const configured = config.strategy.routingProvider?.trim();
	if (configured && providers.includes(configured)) return configured;
	return providers[0];
}

export function buildDataSourceLabel(config: RouterConfig): string {
	if (config.dataSource.mode === "api") {
		return `api ${config.dataSource.baseUrl.replace(/\/$/, "")}${config.dataSource.apiPath}`;
	}
	return `page ${config.dataSource.pageUrl}`;
}

export function buildDataSourceCacheKey(config: RouterConfig): string {
	return JSON.stringify({
		mode: config.dataSource.mode,
		baseUrl: config.dataSource.baseUrl,
		apiPath: config.dataSource.apiPath,
		pageUrl: config.dataSource.pageUrl,
		parallelQueries: config.dataSource.parallelQueries,
		promptLength: config.dataSource.promptLength,
	});
}

export function getProviderScopedModels(availableModels: Model<Api>[], _currentModel: Model<Api> | undefined, config: RouterConfig) {
	const base = [...availableModels];
	const resolvedProvider = resolveRoutingProvider(base, config);
	if (!resolvedProvider) {
		return {
			models: [] as Model<Api>[],
			providerScopeMode: "configured-provider" as ProviderScopeMode,
			providerScopeLabel: "routing provider unavailable",
			availableModelCount: 0,
			availableRouteCount: 0,
		};
	}
	const configuredProvider = config.strategy.routingProvider?.trim();
	const scoped = base.filter((model) => model.provider === resolvedProvider);
	const providerFilters = getProviderFilterConfig(config.filters, resolvedProvider);
	const shouldMaterializePreset = providerFilters.preset && providerFilters.preset !== "none" && providerFilters.disabledFamilies.length === 0 && providerFilters.disabledModels.length === 0;
	const effectiveFilters = shouldMaterializePreset ? applyBuiltInModelFilterPreset(config.filters, resolvedProvider, scoped, providerFilters.preset!) : config.filters;
	const filtered = applyModelFilters(scoped, effectiveFilters);
	const suffix = configuredProvider && configuredProvider !== resolvedProvider ? ` (fallback from ${configuredProvider})` : "";
	const filterSuffix = filtered.length === scoped.length ? "" : filtered.length === 0 ? ` · all ${scoped.length} models filtered off` : ` · filters ${filtered.length}/${scoped.length} on`;
	return {
		models: filtered,
		providerScopeMode: "configured-provider" as ProviderScopeMode,
		providerScopeLabel: `routing provider ${resolvedProvider}${suffix}${filterSuffix}`,
		availableModelCount: filtered.length,
		availableRouteCount: countAvailableRoutes(filtered),
	};
}

export function providerHostAliases(provider: string): string[] {
	const normalized = normalizeKey(provider);
	return [...new Set([normalized, ...(PROVIDER_HOST_ALIASES[provider] ?? []).map(normalizeKey)])].filter(Boolean);
}

export function hostAffinityBonus(provider: string, aaModel: AaModel): number {
	const aliases = providerHostAliases(provider);
	if (aliases.length === 0) return 0;
	const aaTargets = [aaModel.hostLabel, aaModel.hostSlug, aaModel.hostApiId, aaModel.creatorName]
		.filter((value): value is string => typeof value === "string" && value.length > 0)
		.map(normalizeKey);
	let best = 0;
	for (const alias of aliases) {
		for (const target of aaTargets) {
			best = Math.max(best, aliasSimilarity(alias, target));
		}
	}
	if (best >= 0.92) return 0.14;
	if (best >= 0.78) return 0.08;
	if (best >= 0.62) return 0.03;
	return 0;
}

export interface ModelIdentity {
	vendor?: string;
	family?: string;
	subfamily?: string;
	variant?: string;
	generation?: string;
	movingAlias?: boolean;
	normalizedText: string;
	tokens: string[];
}

const ROUTING_AGGREGATOR_VENDORS = new Set(["openrouter", "github-copilot", "vercel-ai-gateway", "opencode"]);

function hasToken(text: string, token: string): boolean {
	return new RegExp(`(^|-)${token}($|-)`).test(text);
}

function canonicalVendorFromText(normalized: string): string | undefined {
	if (/claude|anthropic/.test(normalized)) return "anthropic";
	if (/\bopenai\b|(^|-)gpt($|-)|(^|-)gpt-[0-9]|codex/.test(normalized)) return "openai";
	if (/google|gemini/.test(normalized)) return "google";
	if (/deepseek/.test(normalized)) return "deepseek";
	if (/qwen|alibaba/.test(normalized)) return "qwen";
	if (/x-ai|(^|-)xai($|-)|grok/.test(normalized)) return "xai";
	if (/moonshotai|moonshot|kimi/.test(normalized)) return "moonshot";
	if (/z-ai|(^|-)zai($|-)|(^|-)glm($|-)|(^|-)glm-[0-9]/.test(normalized)) return "zai";
	if (/mistral|mixtral|codestral|magistral/.test(normalized)) return "mistral";
	if (/nousresearch|nous-research|(^|-)nous($|-)|hermes/.test(normalized)) return "nous";
	if (/meta-llama|meta|llama/.test(normalized)) return "meta";
	if (/minimax/.test(normalized)) return "minimax";
	if (/cohere|command/.test(normalized)) return "cohere";
	if (/perplexity|sonar/.test(normalized)) return "perplexity";
	if (/ibm-granite|(^|-)ibm($|-)|granite/.test(normalized)) return "ibm";
	if (/kwaipilot|kwai|kat-coder|(^|-)kat($|-)/.test(normalized)) return "kwai";
	if (/bytedance-seed|bytedance|seed-|ui-tars|(^|-)tars($|-)/.test(normalized)) return "bytedance";
	if (/amazon|(^|-)nova($|-)|(^|-)nova-[0-9]/.test(normalized)) return "amazon";
	if (/inclusionai|inclusion-ai|ling-flash|(^|-)ling($|-)/.test(normalized)) return "inclusionai";
	if (/aion-labs|aionlabs|(^|-)aion($|-)/.test(normalized)) return "aion";
	if (/arcee-ai|arcee|trinity|maestro|virtuoso/.test(normalized)) return "arcee";
	if (/tencent|hunyuan|(^|-)hy3($|-)/.test(normalized)) return "tencent";
	if (/liquidai|(^|-)liquid($|-)|(^|-)lfm/.test(normalized)) return "liquid";
	if (/essentialai|essential-ai|(^|-)rnj($|-)/.test(normalized)) return "essentialai";
	if (/microsoft|(^|-)phi($|-)|(^|-)phi-[0-9]/.test(normalized)) return "microsoft";
	if (/prime-intellect|(^|-)intellect($|-)/.test(normalized)) return "prime-intellect";
	if (/deepcogito|deep-cogito|(^|-)cogito($|-)/.test(normalized)) return "deepcogito";
	if (/rekaai|reka-ai|(^|-)reka($|-)/.test(normalized)) return "reka";
	if (/xiaomi|(^|-)mimo($|-)/.test(normalized)) return "xiaomi";
	if (/sao10k/.test(normalized)) return "sao10k";
	if (/alfredpros/.test(normalized)) return "alfredpros";
	if (/nex-agi|nexagi/.test(normalized)) return "nex-agi";
	if (/openrouter/.test(normalized)) return "openrouter";
	return undefined;
}

function inferFamilyFromText(normalized: string): Pick<ModelIdentity, "family" | "subfamily" | "variant"> {
	if (/claude|anthropic/.test(normalized)) {
		const subfamily = hasToken(normalized, "haiku") ? "haiku" : hasToken(normalized, "sonnet") ? "sonnet" : hasToken(normalized, "opus") ? "opus" : undefined;
		return { family: "claude", subfamily };
	}
	if (/(^|-)gpt($|-)|(^|-)gpt-[0-9]|openai|codex/.test(normalized)) {
		const subfamily = hasToken(normalized, "codex")
			? "codex"
			: hasToken(normalized, "nano")
				? "nano"
				: hasToken(normalized, "mini")
					? "mini"
					: hasToken(normalized, "chat")
						? "chat"
						: undefined;
		return { family: "gpt", subfamily, variant: hasToken(normalized, "pro") ? "pro" : undefined };
	}
	if (/gemini|google/.test(normalized)) {
		const subfamily = normalized.includes("flash-lite")
			? "flash-lite"
			: hasToken(normalized, "flash")
				? "flash"
				: hasToken(normalized, "pro")
					? "pro"
					: undefined;
		return { family: "gemini", subfamily };
	}
	if (/deepseek/.test(normalized)) {
		const subfamily = normalized.includes("v4-flash") || normalized.includes("v4flash")
			? "v4-flash"
			: normalized.includes("v4-pro") || normalized.includes("v4pro")
				? "v4-pro"
				: hasToken(normalized, "coder")
					? "coder"
					: hasToken(normalized, "r1")
						? "r1"
						: undefined;
		return { family: "deepseek", subfamily };
	}
	if (/qwen|alibaba/.test(normalized)) return { family: "qwen", subfamily: hasToken(normalized, "coder") ? "coder" : undefined };
	if (/grok|x-ai|(^|-)xai($|-)/.test(normalized)) return { family: "grok", subfamily: hasToken(normalized, "code") ? "code" : undefined };
	if (/kimi|moonshot/.test(normalized)) return { family: "kimi", subfamily: hasToken(normalized, "k2") ? "k2" : undefined };
	if (/z-ai|(^|-)zai($|-)|(^|-)glm($|-)|(^|-)glm-[0-9]/.test(normalized)) return { family: "glm" };
	if (/hermes/.test(normalized)) return { family: "hermes" };
	if (/llama|meta/.test(normalized)) return { family: "llama" };
	if (/mistral|mixtral|codestral|magistral/.test(normalized)) return { family: "mistral", subfamily: hasToken(normalized, "codestral") ? "codestral" : undefined };
	if (/minimax/.test(normalized)) return { family: "minimax" };
	if (/command|cohere/.test(normalized)) return { family: "command" };
	if (/sonar|perplexity/.test(normalized)) return { family: "sonar" };
	if (/granite/.test(normalized)) return { family: "granite" };
	if (/kat-coder|(^|-)kat($|-)/.test(normalized)) return { family: "kat" };
	if (/seed-|(^|-)seed($|-)/.test(normalized)) return { family: "seed" };
	if (/ui-tars|(^|-)tars($|-)/.test(normalized)) return { family: "tars" };
	if (/(^|-)nova($|-)|(^|-)nova-[0-9]/.test(normalized)) return { family: "nova" };
	if (/ling-flash|(^|-)ling($|-)/.test(normalized)) return { family: "ling" };
	if (/aion/.test(normalized)) return { family: "aion" };
	if (/trinity|maestro|virtuoso|arcee/.test(normalized)) return { family: "arcee" };
	if (/hunyuan|(^|-)hy3($|-)/.test(normalized)) return { family: "hunyuan" };
	if (/(^|-)lfm/.test(normalized)) return { family: "lfm" };
	if (/(^|-)rnj($|-)/.test(normalized)) return { family: "rnj" };
	if (/(^|-)phi($|-)|(^|-)phi-[0-9]/.test(normalized)) return { family: "phi" };
	if (/intellect/.test(normalized)) return { family: "intellect" };
	if (/cogito/.test(normalized)) return { family: "cogito" };
	if (/reka/.test(normalized)) return { family: "reka" };
	if (/(^|-)mimo($|-)/.test(normalized)) return { family: "mimo" };
	return {};
}

function firstNumericGeneration(tokens: string[]): string | undefined {
	for (const token of tokens) {
		const match = token.match(/^v?(\d+)$/) ?? token.match(/^[a-z]+(\d+)$/);
		if (match?.[1]) return match[1];
	}
	return undefined;
}

function extractGenerationFromText(normalized: string, family: string | undefined): string | undefined {
	const tokens = tokenize(normalized);
	if (tokens.length === 0) return undefined;
	if (family === "qwen") {
		const qwenToken = tokens.find((token) => /^qwen\d+/.test(token));
		const qwenMatch = qwenToken?.match(/^qwen(\d+)/);
		if (qwenMatch?.[1]) return qwenMatch[1];
	}
	if (family === "deepseek") {
		const versionToken = tokens.find((token) => /^v\d+$/.test(token));
		const versionMatch = versionToken?.match(/^v(\d+)$/);
		if (versionMatch?.[1]) return versionMatch[1];
	}
	if (family === "kimi") {
		const kimiToken = tokens.find((token) => /^k\d+$/.test(token));
		const kimiMatch = kimiToken?.match(/^k(\d+)$/);
		if (kimiMatch?.[1]) return kimiMatch[1];
	}
	return firstNumericGeneration(tokens);
}

function hasMovingAliasToken(normalized: string): boolean {
	return /(^|-)(latest|auto|default|free)($|-)/.test(normalized);
}

function buildModelIdentity(parts: Array<string | undefined>): ModelIdentity {
	const normalizedText = normalizeKey(parts.filter(Boolean).join(" "));
	const familyParts = inferFamilyFromText(normalizedText);
	let vendor = canonicalVendorFromText(normalizedText);
	if (vendor && ROUTING_AGGREGATOR_VENDORS.has(vendor) && familyParts.family) {
		vendor = canonicalVendorFromText(familyParts.family) ?? vendor;
	}
	return {
		vendor,
		...familyParts,
		generation: extractGenerationFromText(normalizedText, familyParts.family),
		movingAlias: hasMovingAliasToken(normalizedText),
		normalizedText,
		tokens: tokenize(normalizedText),
	};
}

export function identityForPiModel(model: Model<Api>): ModelIdentity {
	const idSegments = model.id.split("/");
	const vendorHint = idSegments.length > 1 ? normalizeKey(idSegments[0] ?? "") : undefined;
	const identity = buildModelIdentity([vendorHint, model.id, model.name]);
	const canonicalHint = vendorHint ? canonicalVendorFromText(vendorHint) ?? vendorHint : undefined;
	if (canonicalHint && !ROUTING_AGGREGATOR_VENDORS.has(canonicalHint)) {
		identity.vendor = canonicalHint;
	}
	return identity;
}

export function identityForAaModel(model: AaModel): ModelIdentity {
	return buildModelIdentity([model.slug, model.name, model.shortName, model.creatorName]);
}

function requiresExactSubfamily(identity: ModelIdentity): boolean {
	if (!identity.family || !identity.subfamily) return false;
	if (identity.family === "claude") return ["haiku", "sonnet", "opus"].includes(identity.subfamily);
	if (identity.family === "gpt") return identity.subfamily === "codex";
	if (identity.family === "deepseek") return ["v4-flash", "v4-pro", "coder", "r1"].includes(identity.subfamily);
	if (identity.family === "gemini") return ["flash-lite", "flash", "pro"].includes(identity.subfamily);
	if (identity.family === "qwen") return identity.subfamily === "coder";
	if (identity.family === "grok") return identity.subfamily === "code";
	if (identity.family === "mistral") return identity.subfamily === "codestral";
	return false;
}

function requiresGenerationMatch(identity: ModelIdentity): boolean {
	return Boolean(identity.family && ["claude", "gpt", "gemini", "deepseek", "qwen", "kimi", "hermes", "mistral", "granite", "kat", "nova", "hunyuan", "phi"].includes(identity.family));
}

export function modelIdentityCompatibility(piIdentity: ModelIdentity, aaIdentity: ModelIdentity): { compatible: boolean; bonus: number; reason?: string } {
	if (piIdentity.movingAlias) {
		return { compatible: false, bonus: 0, reason: "moving alias requires explicit override" };
	}
	if (piIdentity.vendor && aaIdentity.vendor && piIdentity.vendor !== aaIdentity.vendor) {
		return { compatible: false, bonus: 0, reason: `vendor ${piIdentity.vendor}≠${aaIdentity.vendor}` };
	}
	if (piIdentity.family && !aaIdentity.family) {
		return { compatible: false, bonus: 0, reason: `family ${piIdentity.family}≠unknown` };
	}
	if (!piIdentity.family && aaIdentity.family) {
		return { compatible: false, bonus: 0, reason: `family unknown≠${aaIdentity.family}` };
	}
	if (piIdentity.family && aaIdentity.family && piIdentity.family !== aaIdentity.family) {
		return { compatible: false, bonus: 0, reason: `family ${piIdentity.family}≠${aaIdentity.family}` };
	}
	if (requiresGenerationMatch(piIdentity) && piIdentity.generation && aaIdentity.generation && piIdentity.generation !== aaIdentity.generation) {
		return { compatible: false, bonus: 0, reason: `generation ${piIdentity.generation}≠${aaIdentity.generation}` };
	}
	if (requiresExactSubfamily(piIdentity)) {
		if (!aaIdentity.subfamily || aaIdentity.subfamily !== piIdentity.subfamily) {
			return { compatible: false, bonus: 0, reason: `subfamily ${piIdentity.subfamily}≠${aaIdentity.subfamily ?? "unknown"}` };
		}
	}
	if (requiresExactSubfamily(aaIdentity) && piIdentity.family === aaIdentity.family) {
		if (!piIdentity.subfamily || aaIdentity.subfamily !== piIdentity.subfamily) {
			return { compatible: false, bonus: 0, reason: `aa subfamily ${aaIdentity.subfamily}≠${piIdentity.subfamily ?? "unknown"}` };
		}
	}
	let bonus = 0;
	if (piIdentity.vendor && aaIdentity.vendor && piIdentity.vendor === aaIdentity.vendor) bonus += 0.04;
	if (piIdentity.family && aaIdentity.family && piIdentity.family === aaIdentity.family) bonus += 0.08;
	if (piIdentity.subfamily && aaIdentity.subfamily && piIdentity.subfamily === aaIdentity.subfamily) bonus += 0.05;
	if (piIdentity.generation && aaIdentity.generation && piIdentity.generation === aaIdentity.generation) bonus += 0.03;
	return { compatible: true, bonus };
}

export function mergeDeep<T>(base: T, override: Partial<T> | undefined): T {
	if (!override) return base;
	if (Array.isArray(base) || Array.isArray(override)) return (override as T) ?? base;
	if (typeof base !== "object" || base === null) return (override as T) ?? base;
	const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
	for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
		const current = result[key];
		if (
			value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			current &&
			typeof current === "object" &&
			!Array.isArray(current)
		) {
			result[key] = mergeDeep(current as Record<string, unknown>, value as Record<string, unknown>);
		} else if (value !== undefined) {
			result[key] = value;
		}
	}
	return result as T;
}

export function readJsonIfExists(path: string): unknown | undefined {
	if (!existsSync(path)) return undefined;
	return JSON.parse(readFileSync(path, "utf8"));
}

export type RouterSettingsScope = "global" | "project";

export function getProjectConfigFile(cwd: string): string {
	return join(cwd, ".pi", "model-router.json");
}

export function getConfigFileForScope(scope: RouterSettingsScope, cwd: string): string {
	return scope === "global" ? GLOBAL_CONFIG_FILE : getProjectConfigFile(cwd);
}

export function getProjectFilterPresetDir(cwd: string): string {
	return join(cwd, ".pi", "model-router-filter-presets");
}

export function getFilterPresetDirForScope(scope: RouterSettingsScope, cwd: string): string {
	return scope === "global" ? GLOBAL_FILTER_PRESETS_DIR : getProjectFilterPresetDir(cwd);
}

export function normalizeRouterConfig(config: RouterConfig): RouterConfig {
	const legacyUrl = (config as any)?.dataSource?.url;
	if (typeof legacyUrl === "string" && legacyUrl.length > 0) {
		config.dataSource.pageUrl = legacyUrl;
	}

	/* Public V1 intentionally has no model-assisted classifier, policy profile,
	 * reliability cooldown, or debug block.  Old config files may still contain
	 * those keys, so normalization drops them instead of letting retired knobs
	 * silently influence routing. */
	delete (config as any).classifier;
	delete (config as any).policy;
	delete (config as any).reliability;
	delete (config as any).debug;
	delete (config.strategy as any).providerScope;

	config.strategy.minRouteConfidence = clamp(Number(config.strategy.minRouteConfidence ?? DEFAULT_CONFIG.strategy.minRouteConfidence), 0, 1);
	config.ui = {
		showAdvancedSettings: Boolean(config.ui?.showAdvancedSettings),
		autoAcceptRouting: Boolean(config.ui?.autoAcceptRouting),
	};
	config.filters = normalizeModelFilters(config.filters);
	if (typeof config.strategy.routingProvider !== "string" || config.strategy.routingProvider.trim().length === 0) {
		config.strategy.routingProvider = undefined;
	}
	return config;
}

export function loadConfig(cwd: string): RouterConfig {
	const projectConfigPath = getProjectConfigFile(cwd);
	let config = structuredClone(DEFAULT_CONFIG) as RouterConfig;
	try {
		config = mergeDeep(config, readJsonIfExists(GLOBAL_CONFIG_FILE) as Partial<RouterConfig> | undefined);
	} catch (error) {
		console.error(`[star-router] Failed to parse ${GLOBAL_CONFIG_FILE}:`, error);
	}
	try {
		config = mergeDeep(config, readJsonIfExists(projectConfigPath) as Partial<RouterConfig> | undefined);
	} catch (error) {
		console.error(`[star-router] Failed to parse ${projectConfigPath}:`, error);
	}
	return normalizeRouterConfig(config);
}

export function saveConfigForScope(scope: RouterSettingsScope, cwd: string, config: RouterConfig): string {
	const path = getConfigFileForScope(scope, cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	return path;
}

export function saveCache(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(data), "utf8");
}

export function safeJsonParse<T>(text: string): T | undefined {
	try {
		return JSON.parse(text) as T;
	} catch {
		return undefined;
	}
}

export function decodeNextFlightChunks(html: string): string[] {
	const chunks: string[] = [];
	const regex = /self\.__next_f\.push\(\[1,("(?:\\.|[^"])*")\]\)/gs;
	for (const match of html.matchAll(regex)) {
		try {
			chunks.push(JSON.parse(match[1]) as string);
		} catch {
			// Ignore malformed chunks.
		}
	}
	return chunks;
}

export function findJsonArray(text: string, marker: string): string | undefined {
	const markerIndex = text.indexOf(marker);
	if (markerIndex === -1) return undefined;
	const arrayStart = text.indexOf("[", markerIndex);
	if (arrayStart === -1) return undefined;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = arrayStart; i < text.length; i += 1) {
		const ch = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === "[") depth += 1;
		if (ch === "]") {
			depth -= 1;
			if (depth === 0) return text.slice(arrayStart, i + 1);
		}
	}
	return undefined;
}

export function parsePromptSpeedProfiles(rawEntries: unknown): PromptSpeedProfile[] {
	if (!Array.isArray(rawEntries)) return [];
	return rawEntries
		.map((entry: any): PromptSpeedProfile | undefined => {
			const promptLengthType = entry?.prompt_length_type as PromptLengthType | undefined;
			if (!promptLengthType || typeof promptLengthType !== "string") return undefined;
			return {
				promptLengthType,
				medianOutputSpeed: isFiniteNumber(entry?.median_output_speed) ? entry.median_output_speed : undefined,
				medianTimeToFirstAnswerToken: isFiniteNumber(entry?.median_time_to_first_answer_token)
					? entry.median_time_to_first_answer_token
					: isFiniteNumber(entry?.median_time_to_first_chunk)
						? entry.median_time_to_first_chunk
						: undefined,
				medianEndToEndResponseTime: isFiniteNumber(entry?.median_end_to_end_response_time)
					? entry.median_end_to_end_response_time
					: undefined,
			};
		})
		.filter((entry): entry is PromptSpeedProfile => Boolean(entry));
}

export function trimAaRecord(raw: any, core: any, sourceMode: DataSourceMode): AaModel | undefined {
	if (!raw || typeof raw !== "object" || !core || typeof core !== "object") return undefined;
	if (raw.deleted || core.deleted || raw.deprecated || core.deprecated) return undefined;
	if (typeof core.slug !== "string" || typeof core.name !== "string") return undefined;
	const performanceByPromptLength = parsePromptSpeedProfiles(raw.performanceByPromptLength ?? core.performanceByPromptLength);
	const tokenCounts = core.intelligence_index_token_counts ?? raw.intelligence_index_token_counts ?? {};
	const reasoningTokens = isFiniteNumber(tokenCounts.reasoning_tokens) ? tokenCounts.reasoning_tokens : 0;
	const answerTokens = isFiniteNumber(tokenCounts.answer_tokens) ? tokenCounts.answer_tokens : 0;
	const outputTokens = isFiniteNumber(tokenCounts.output_tokens) ? tokenCounts.output_tokens : 0;
	const tokenBurn = reasoningTokens + answerTokens + outputTokens;
	return {
		sourceMode,
		slug: core.slug,
		name: core.name,
		shortName: typeof core.short_name === "string" ? core.short_name : core.name,
		creatorName: core.model_creators?.name ?? raw.model_creators?.name,
		modelUrl: typeof core.model_url === "string" ? core.model_url : typeof raw.model_url === "string" ? raw.model_url : undefined,
		hostLabel: typeof raw.host_label === "string" ? raw.host_label : raw.host?.name,
		hostSlug: typeof raw.host?.slug === "string" ? raw.host.slug : typeof raw.slug === "string" ? raw.slug : undefined,
		hostApiId: typeof raw.host_api_id === "string" ? raw.host_api_id : undefined,
		intelligenceIndex: isFiniteNumber(core.intelligence_index) ? core.intelligence_index : undefined,
		agenticIndex: isFiniteNumber(core.agentic_index) ? core.agentic_index : undefined,
		codingIndex: isFiniteNumber(core.coding_index) ? core.coding_index : undefined,
		gdpvalNormalized: isFiniteNumber(core.gdpval_normalized) ? core.gdpval_normalized : undefined,
		tau2: isFiniteNumber(core.tau2) ? core.tau2 : undefined,
		terminalbenchHard: isFiniteNumber(core.terminalbench_hard) ? core.terminalbench_hard : undefined,
		scicode: isFiniteNumber(core.scicode) ? core.scicode : undefined,
		livecodebench: isFiniteNumber(core.livecodebench) ? core.livecodebench : undefined,
		ifbench: isFiniteNumber(core.ifbench) ? core.ifbench : undefined,
		omniscience: isFiniteNumber(core.omniscience) ? core.omniscience : undefined,
		gpqa: isFiniteNumber(core.gpqa) ? core.gpqa : undefined,
		hle: isFiniteNumber(core.hle) ? core.hle : undefined,
		critpt: isFiniteNumber(core.critpt) ? core.critpt : undefined,
		lcr: isFiniteNumber(core.lcr) ? core.lcr : undefined,
		contextWindowTokens: isFiniteNumber(raw.context_window_tokens)
			? raw.context_window_tokens
			: isFiniteNumber(raw.context_window_if_different_to_model)
				? raw.context_window_if_different_to_model
				: isFiniteNumber(core.context_window_tokens)
					? core.context_window_tokens
					: undefined,
		priceInputPer1M: isFiniteNumber(raw.price_1m_input_tokens)
			? raw.price_1m_input_tokens
			: isFiniteNumber(core.price_1m_input_tokens)
				? core.price_1m_input_tokens
				: undefined,
		priceOutputPer1M: isFiniteNumber(raw.price_1m_output_tokens)
			? raw.price_1m_output_tokens
			: isFiniteNumber(core.price_1m_output_tokens)
				? core.price_1m_output_tokens
				: undefined,
		priceBlendedPer1M: isFiniteNumber(raw.price_1m_blended_0_3_1)
			? raw.price_1m_blended_0_3_1
			: isFiniteNumber(core.price_1m_blended_0_3_1)
				? core.price_1m_blended_0_3_1
				: undefined,
		cacheHitPricePer1M: isFiniteNumber(raw.cache_hit_price)
			? raw.cache_hit_price
			: isFiniteNumber(core.cache_hit_price)
				? core.cache_hit_price
				: undefined,
		reasoningModel: Boolean(core.reasoning_model),
		inputModalityImage: Boolean(core.input_modality_image ?? raw.input_modality_image),
		performanceByPromptLength,
		fallbackTimeToFirstAnswerToken: isFiniteNumber(raw.time_to_first_answer_token_metrics?.total_time)
			? raw.time_to_first_answer_token_metrics.total_time
			: isFiniteNumber(core.time_to_first_answer_token_metrics?.total_time)
				? core.time_to_first_answer_token_metrics.total_time
				: undefined,
		fallbackEndToEndResponseTime: isFiniteNumber(raw.end_to_end_response_time_metrics?.total_time)
			? raw.end_to_end_response_time_metrics.total_time
			: isFiniteNumber(core.end_to_end_response_time_metrics?.total_time)
				? core.end_to_end_response_time_metrics.total_time
				: undefined,
		tokenBurn: tokenBurn > 0 ? tokenBurn : undefined,
	};
}

export function trimAaPageModel(raw: any): AaModel | undefined {
	return trimAaRecord(raw, raw, "page-scrape");
}

export function trimAaApiModel(raw: any): AaModel | undefined {
	const core = raw?.model && typeof raw.model === "object" ? raw.model : raw;
	return trimAaRecord(raw, core, "api");
}

export async function fetchAaModelsViaPage(config: RouterConfig, now: number): Promise<AaDataset> {
	const response = await fetch(config.dataSource.pageUrl, {
		headers: {
			"user-agent": "pi-star-router/1.0",
		},
		signal: AbortSignal.timeout(config.dataSource.requestTimeoutMs),
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} fetching ${config.dataSource.pageUrl}`);
	}
	const html = await response.text();
	const decoded = decodeNextFlightChunks(html).join("");
	const arrayText = findJsonArray(decoded, '"defaultData":[');
	if (!arrayText) {
		throw new Error("Could not find defaultData in Artificial Analysis page");
	}
	const rawModels = safeJsonParse<any[]>(arrayText);
	if (!Array.isArray(rawModels)) {
		throw new Error("defaultData was not a JSON array");
	}
	return {
		fetchedAt: now,
		sourceKey: buildDataSourceCacheKey({ ...config, dataSource: { ...config.dataSource, mode: "page-scrape" } }),
		sourceLabel: `page ${config.dataSource.pageUrl}`,
		models: rawModels.map(trimAaPageModel).filter((value): value is AaModel => Boolean(value)),
	};
}

export function buildAaApiUrl(config: RouterConfig): string {
	const base = config.dataSource.baseUrl.replace(/\/$/, "");
	const url = new URL(config.dataSource.apiPath, `${base}/`);
	url.searchParams.set("prompt_length", config.dataSource.promptLength);
	url.searchParams.set("parallel_queries", String(config.dataSource.parallelQueries));
	return url.toString();
}

export function buildAaRequestHeaders(config: RouterConfig): Record<string, string> {
	const headers: Record<string, string> = {
		accept: "application/json",
		"user-agent": "pi-star-router/1.0",
	};
	const apiKey = config.dataSource.apiKeyEnv ? process.env[config.dataSource.apiKeyEnv] : undefined;
	if (apiKey) {
		headers.authorization = `Bearer ${apiKey}`;
		headers["x-api-key"] = apiKey;
	}
	return headers;
}

export async function fetchAaModelsViaApi(config: RouterConfig, now: number): Promise<AaDataset> {
	const apiUrl = buildAaApiUrl(config);
	const response = await fetch(apiUrl, {
		headers: buildAaRequestHeaders(config),
		signal: AbortSignal.timeout(config.dataSource.requestTimeoutMs),
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} fetching ${apiUrl}`);
	}
	const payload = (await response.json()) as any;
	const rawModels = Array.isArray(payload?.hostModels)
		? payload.hostModels
		: Array.isArray(payload?.hostsModels)
			? payload.hostsModels
			: undefined;
	if (!Array.isArray(rawModels)) {
		throw new Error("Artificial Analysis API response did not include hostModels[]");
	}
	return {
		fetchedAt: now,
		sourceKey: buildDataSourceCacheKey(config),
		sourceLabel: buildDataSourceLabel(config),
		models: rawModels.map(trimAaApiModel).filter((value): value is AaModel => Boolean(value)),
	};
}

export async function fetchAaModels(config: RouterConfig): Promise<AaDataset> {
	const now = Date.now();
	const cached = safeJsonParse<AaDataset>(existsSync(DATA_CACHE_FILE) ? readFileSync(DATA_CACHE_FILE, "utf8") : "");
	const ttlMs = config.dataSource.cacheTtlMinutes * 60_000;
	const sourceKey = buildDataSourceCacheKey(config);
	if (cached && Array.isArray(cached.models) && cached.sourceKey === sourceKey && now - cached.fetchedAt < ttlMs) {
		return cached;
	}
	try {
		const dataset =
			config.dataSource.mode === "api"
				? await fetchAaModelsViaApi(config, now).catch(async (error) => {
					console.error("[star-router] API fetch failed, falling back to page scrape:", error);
					return fetchAaModelsViaPage(config, now);
				})
				: await fetchAaModelsViaPage(config, now);
		saveCache(DATA_CACHE_FILE, dataset);
		return dataset;
	} catch (error) {
		if (cached && Array.isArray(cached.models)) {
			console.error("[star-router] Using stale Artificial Analysis cache after fetch failure:", error);
			return cached;
		}
		throw error;
	}
}

function betterNumber(values: Array<number | undefined>, mode: "max" | "min" | "avg" = "max"): number | undefined {
	const finite = values.filter(isFiniteNumber);
	if (finite.length === 0) return undefined;
	if (mode === "min") return Math.min(...finite);
	if (mode === "avg") return finite.reduce((sum, value) => sum + value, 0) / finite.length;
	return Math.max(...finite);
}

function mergePromptSpeedProfiles(models: AaModel[]): PromptSpeedProfile[] {
	const byType = new Map<PromptLengthType, PromptSpeedProfile[]>();
	for (const model of models) {
		for (const profile of model.performanceByPromptLength) {
			const entries = byType.get(profile.promptLengthType) ?? [];
			entries.push(profile);
			byType.set(profile.promptLengthType, entries);
		}
	}
	return [...byType.entries()].map(([promptLengthType, entries]) => ({
		promptLengthType,
		medianOutputSpeed: betterNumber(entries.map((entry) => entry.medianOutputSpeed), "max"),
		medianTimeToFirstAnswerToken: betterNumber(entries.map((entry) => entry.medianTimeToFirstAnswerToken), "min"),
		medianEndToEndResponseTime: betterNumber(entries.map((entry) => entry.medianEndToEndResponseTime), "min"),
	}));
}

export function normalizeAaModelsForRouting(models: AaModel[]): AaModel[] {
	const bySlug = new Map<string, AaModel[]>();
	for (const model of models) {
		const entries = bySlug.get(model.slug) ?? [];
		entries.push(model);
		bySlug.set(model.slug, entries);
	}
	return [...bySlug.values()].map((entries) => {
		if (entries.length === 1) return entries[0]!;
		const first = entries[0]!;
		return {
			...first,
			hostLabel: `normalized ${entries.length} hosts`,
			hostSlug: undefined,
			hostApiId: undefined,
			intelligenceIndex: betterNumber(entries.map((model) => model.intelligenceIndex), "max"),
			agenticIndex: betterNumber(entries.map((model) => model.agenticIndex), "max"),
			codingIndex: betterNumber(entries.map((model) => model.codingIndex), "max"),
			gdpvalNormalized: betterNumber(entries.map((model) => model.gdpvalNormalized), "max"),
			tau2: betterNumber(entries.map((model) => model.tau2), "max"),
			terminalbenchHard: betterNumber(entries.map((model) => model.terminalbenchHard), "max"),
			scicode: betterNumber(entries.map((model) => model.scicode), "max"),
			livecodebench: betterNumber(entries.map((model) => model.livecodebench), "max"),
			ifbench: betterNumber(entries.map((model) => model.ifbench), "max"),
			omniscience: betterNumber(entries.map((model) => model.omniscience), "max"),
			gpqa: betterNumber(entries.map((model) => model.gpqa), "max"),
			hle: betterNumber(entries.map((model) => model.hle), "max"),
			critpt: betterNumber(entries.map((model) => model.critpt), "max"),
			lcr: betterNumber(entries.map((model) => model.lcr), "max"),
			contextWindowTokens: betterNumber(entries.map((model) => model.contextWindowTokens), "max"),
			priceInputPer1M: betterNumber(entries.map((model) => model.priceInputPer1M), "min"),
			priceOutputPer1M: betterNumber(entries.map((model) => model.priceOutputPer1M), "min"),
			priceBlendedPer1M: betterNumber(entries.map((model) => model.priceBlendedPer1M), "min"),
			cacheHitPricePer1M: betterNumber(entries.map((model) => model.cacheHitPricePer1M), "min"),
			performanceByPromptLength: mergePromptSpeedProfiles(entries),
			fallbackTimeToFirstAnswerToken: betterNumber(entries.map((model) => model.fallbackTimeToFirstAnswerToken), "min"),
			fallbackEndToEndResponseTime: betterNumber(entries.map((model) => model.fallbackEndToEndResponseTime), "min"),
			tokenBurn: betterNumber(entries.map((model) => model.tokenBurn), "avg"),
		};
	});
}

export function buildStats(models: AaModel[]): DatasetStats {
	const normalizedModels = normalizeAaModelsForRouting(models);
	const metricExtractors: Record<string, (model: AaModel) => number | undefined> = {
		intelligence_index: (model) => model.intelligenceIndex,
		agentic_index: (model) => model.agenticIndex,
		coding_index: (model) => model.codingIndex,
		gdpval_normalized: (model) => model.gdpvalNormalized,
		tau2: (model) => model.tau2,
		terminalbench_hard: (model) => model.terminalbenchHard,
		scicode: (model) => model.scicode,
		livecodebench: (model) => model.livecodebench,
		ifbench: (model) => model.ifbench,
		omniscience: (model) => model.omniscience,
		gpqa: (model) => model.gpqa,
		hle: (model) => model.hle,
		critpt: (model) => model.critpt,
		lcr: (model) => model.lcr,
		speed_medium: (model) => getAaPromptMetric(model, "medium", "speed"),
		speed_medium_coding: (model) => getAaPromptMetric(model, "medium_coding", "speed"),
		speed_long: (model) => getAaPromptMetric(model, "long", "speed"),
		speed_vision_single_image: (model) => getAaPromptMetric(model, "vision_single_image", "speed"),
		latency_medium: (model) => getAaPromptMetric(model, "medium", "latency"),
		latency_medium_coding: (model) => getAaPromptMetric(model, "medium_coding", "latency"),
		latency_long: (model) => getAaPromptMetric(model, "long", "latency"),
		latency_vision_single_image: (model) => getAaPromptMetric(model, "vision_single_image", "latency"),
	};
	const metrics: Record<string, MetricRange> = {};
	for (const [key, extractor] of Object.entries(metricExtractors)) {
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (const model of normalizedModels) {
			const value = extractor(model);
			if (!isFiniteNumber(value)) continue;
			min = Math.min(min, value);
			max = Math.max(max, value);
		}
		if (Number.isFinite(min) && Number.isFinite(max)) {
			metrics[key] = { min, max };
		}
	}
	return { metrics };
}

export function normalizeByRange(value: number | undefined, range: MetricRange | undefined, invert = false): number {
	if (!isFiniteNumber(value) || !range) return 0;
	if (range.max <= range.min) return 1;
	let normalized = (value - range.min) / (range.max - range.min);
	normalized = clamp(normalized, 0, 1);
	return invert ? 1 - normalized : normalized;
}

export function getAaMetric(model: AaModel, key: BenchmarkKey): number | undefined {
	switch (key) {
		case "intelligence_index":
			return model.intelligenceIndex;
		case "agentic_index":
			return model.agenticIndex;
		case "coding_index":
			return model.codingIndex;
		case "gdpval_normalized":
			return model.gdpvalNormalized;
		case "tau2":
			return model.tau2;
		case "terminalbench_hard":
			return model.terminalbenchHard;
		case "scicode":
			return model.scicode;
		case "livecodebench":
			return model.livecodebench;
		case "ifbench":
			return model.ifbench;
		case "omniscience":
			return model.omniscience;
		case "gpqa":
			return model.gpqa;
		case "hle":
			return model.hle;
		case "critpt":
			return model.critpt;
		case "lcr":
			return model.lcr;
	}
}

export function getAaPromptMetric(model: AaModel, promptLengthType: PromptLengthType, metric: "speed" | "latency"): number | undefined {
	const match = model.performanceByPromptLength.find((entry) => entry.promptLengthType === promptLengthType);
	if (metric === "speed") {
		return match?.medianOutputSpeed;
	}
	return match?.medianEndToEndResponseTime ?? model.fallbackEndToEndResponseTime;
}

export function getAaTtftMetric(model: AaModel, promptLengthType: PromptLengthType): number | undefined {
	const match = model.performanceByPromptLength.find((entry) => entry.promptLengthType === promptLengthType);
	return match?.medianTimeToFirstAnswerToken ?? model.fallbackTimeToFirstAnswerToken;
}

export async function inferPromptProfile(
	_config: RouterConfig,
	prompt: string,
	hasImages: boolean,
	_ctx?: unknown,
): Promise<PromptProfile> {
	/* Public V1 keeps prompt understanding deterministic.  The heuristic profiler
	 * is intentionally boring: no classifier model, no hidden provider call, and
	 * therefore no surprise latency or auth failure before the real agent turn. */
	return (await inferPromptProfileSmart({}, prompt, hasImages)) as PromptProfile;
}

export function currentModelKey(model: Model<Api> | undefined): string | undefined {
	if (!model) return undefined;
	return `${model.provider}/${model.id}`;
}

export function currentRouteKey(model: Model<Api> | undefined, thinkingLevel: ThinkingLevel | undefined): string | undefined {
	if (!model || !thinkingLevel) return undefined;
	return `${model.provider}/${model.id}@${thinkingLevel}`;
}

export function buildPiOverrideKey(model: Model<Api>, thinkingLevel?: ThinkingLevel): string[] {
	return [
		thinkingLevel ? `${model.provider}/${model.id}@${thinkingLevel}` : "",
		`${model.provider}/${model.id}`,
		thinkingLevel ? `${model.id}@${thinkingLevel}` : "",
		model.id,
		model.name,
	].filter(Boolean);
}

const aaMatchCache = new Map<string, { aaModel: AaModel; matchScore: number; variantLevel: ThinkingLevel } | undefined>();
const AA_MATCH_CACHE_MAX_ENTRIES = 25_000;

export function clearAaMatchCache(): void {
	aaMatchCache.clear();
}

function aaModelSetFingerprint(aaModels: AaModel[]): string {
	const first = aaModels[0]?.slug ?? "none";
	const last = aaModels.at(-1)?.slug ?? "none";
	return `${aaModels.length}:${first}:${last}`;
}

function aaMatchCacheKey(piModel: Model<Api>, aaModels: AaModel[], candidateThinkingLevel: ThinkingLevel, config: RouterConfig): string {
	const overrideFingerprint = buildPiOverrideKey(piModel, candidateThinkingLevel)
		.map((key) => config.modelOverrides[key])
		.filter(Boolean)
		.join("|");
	return [
		aaModelSetFingerprint(aaModels),
		config.strategy.minAaMatch,
		String(piModel.provider),
		piModel.id,
		piModel.name,
		candidateThinkingLevel,
		overrideFingerprint,
	].join("::");
}

export function pickAaMatchForPiModel(
	piModel: Model<Api>,
	aaModels: AaModel[],
	candidateThinkingLevel: ThinkingLevel,
	config: RouterConfig,
): { aaModel: AaModel; matchScore: number; variantLevel: ThinkingLevel } | undefined {
	const cacheKey = aaMatchCacheKey(piModel, aaModels, candidateThinkingLevel, config);
	if (aaMatchCache.has(cacheKey)) return aaMatchCache.get(cacheKey);

	const remember = (value: { aaModel: AaModel; matchScore: number; variantLevel: ThinkingLevel } | undefined) => {
		if (aaMatchCache.size >= AA_MATCH_CACHE_MAX_ENTRIES) aaMatchCache.clear();
		aaMatchCache.set(cacheKey, value);
		return value;
	};

	for (const key of buildPiOverrideKey(piModel, candidateThinkingLevel)) {
		const overrideSlug = config.modelOverrides[key];
		if (!overrideSlug) continue;
		const match = aaModels.find((model) => model.slug === overrideSlug || model.hostSlug === overrideSlug);
		if (match) {
			return remember({ aaModel: match, matchScore: 1.25, variantLevel: variantLevelFromAaModel(match) });
		}
	}

	const piAliases = aliasSetForPiModel(piModel);
	const provider = String(piModel.provider);
	const piIdentity = identityForPiModel(piModel);
	let best:
		| {
				aaModel: AaModel;
				matchScore: number;
				variantLevel: ThinkingLevel;
		  }
		| undefined;

	for (const aaModel of aaModels) {
		const aaIdentity = identityForAaModel(aaModel);
		const identityCompatibility = modelIdentityCompatibility(piIdentity, aaIdentity);
		if (!identityCompatibility.compatible) continue;
		const aaAliases = aliasSetForAaModel(aaModel);
		let baseScore = 0;
		for (const piAlias of piAliases) {
			for (const aaAlias of aaAliases) {
				baseScore = Math.max(baseScore, aliasSimilarity(piAlias, aaAlias));
			}
		}
		if (baseScore <= 0) continue;
		const variantLevel = variantLevelFromAaModel(aaModel);
		const hostApiSimilarity = aaModel.hostApiId
			? Math.max(...piAliases.map((piAlias) => aliasSimilarity(piAlias, normalizeKey(aaModel.hostApiId ?? ""))))
			: 0;
		const finalScore =
			baseScore +
			identityCompatibility.bonus +
			variantCompatibilityScore(candidateThinkingLevel, variantLevel) +
			hostAffinityBonus(provider, aaModel) +
			hostApiSimilarity * 0.06;
		if (!best || finalScore > best.matchScore) {
			best = { aaModel, matchScore: finalScore, variantLevel };
		}
	}

	if (best && best.matchScore >= config.strategy.minAaMatch) {
		return remember(best);
	}
	return remember(undefined);
}

export function normalizeCandidateMetric(values: number[], value: number | undefined, invert = false): number {
	if (!isFiniteNumber(value) || values.length === 0) return 0;
	const min = Math.min(...values);
	const max = Math.max(...values);
	if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
	if (max <= min) return 1;
	let normalized = (value - min) / (max - min);
	normalized = clamp(normalized, 0, 1);
	return invert ? 1 - normalized : normalized;
}

export function buildObjectiveWeights(profile: PromptProfile, objective: RouteObjective) {
	let qualityWeight = 0.58 + profile.priorities.reasoningNeed * 0.18;
	let costWeight = 0.14 + profile.priorities.costSensitivity * 0.28;
	let speedWeight = 0.1 + profile.priorities.speedSensitivity * 0.12;
	let latencyWeight = 0.06 + profile.priorities.speedSensitivity * 0.08;
	let contextWeight = 0.04 + profile.priorities.contextNeed * 0.18;

	switch (objective) {
		case "quality":
			qualityWeight += 0.18;
			costWeight -= 0.06;
			speedWeight -= 0.04;
			break;
		case "cheapest":
			costWeight += 0.2;
			qualityWeight -= 0.12;
			latencyWeight -= 0.02;
			break;
		case "fastest":
			speedWeight += 0.18;
			latencyWeight += 0.1;
			qualityWeight -= 0.08;
			break;
		case "balanced":
		default:
			break;
	}

	const total = qualityWeight + costWeight + speedWeight + latencyWeight + contextWeight;
	return {
		qualityWeight: qualityWeight / total,
		costWeight: costWeight / total,
		speedWeight: speedWeight / total,
		latencyWeight: latencyWeight / total,
		contextWeight: contextWeight / total,
	};
}

export function benchmarkScore(aaModel: AaModel, profile: PromptProfile, datasetStats: DatasetStats): number {
	let score = 0;
	let totalWeight = 0;
	for (const [key, weight] of Object.entries(profile.benchmarkWeights) as Array<[BenchmarkKey, number]>) {
		if (weight <= 0) continue;
		const value = getAaMetric(aaModel, key);
		const normalized = normalizeByRange(value, datasetStats.metrics[key], false);
		if (normalized <= 0 && !isFiniteNumber(value)) continue;
		score += normalized * weight;
		totalWeight += weight;
	}
	return totalWeight > 0 ? score / totalWeight : 0;
}

export function candidateEconomicScore(candidate: Candidate, allPrices: number[], _allTokenBurns: number[]): number {
	return normalizeCandidateMetric(allPrices, candidate.price, true);
}

export function candidateSpeedScore(candidate: Candidate, datasetStats: DatasetStats, promptLengthType: PromptLengthType): number {
	return normalizeByRange(candidate.speed, datasetStats.metrics[`speed_${promptLengthType}`], false);
}

export function candidateLatencyScore(candidate: Candidate, datasetStats: DatasetStats, promptLengthType: PromptLengthType): number {
	const endToEndScore = normalizeByRange(candidate.latency, datasetStats.metrics[`latency_${promptLengthType}`], true);
	return endToEndScore;
}

export function candidateContextScore(candidate: Candidate, allContexts: number[]): number {
	const logContexts = allContexts.map((value) => Math.log10(Math.max(value, 1)));
	const target = Math.log10(Math.max(candidate.contextWindow, 1));
	return normalizeCandidateMetric(logContexts, target, false);
}

function routeConfidenceFloor(config: RouterConfig): number {
	return config.strategy.minRouteConfidence;
}

export function buildCandidateReasonBits(candidate: Candidate, profile: PromptProfile): string[] {
	const bits: string[] = [];
	if (candidate.candidateThinkingLevel === profile.targetThinkingLevel) {
		bits.push(`thinking ${candidate.candidateThinkingLevel}`);
	} else {
		bits.push(`thinking ${candidate.candidateThinkingLevel}≠${profile.targetThinkingLevel}`);
	}
	if (profile.priorities.costSensitivity >= 0.45 && candidate.economicScore >= 0.7) bits.push("good cost");
	if (profile.priorities.speedSensitivity >= 0.45 && candidate.speedScore >= 0.7) bits.push("fast");
	if (profile.priorities.contextNeed >= 0.45 && candidate.contextScore >= 0.7) bits.push("long-context");
	if (profile.matchedSignals.includes("coding") && /(codex|code|coder|grok-code|kimi-coding|deepseek)/i.test(`${candidate.piModel.id} ${candidate.piModel.name}`)) {
		bits.push("coding-specialized");
	}
	if (candidate.aaModel.hostLabel && hostAffinityBonus(String(candidate.piModel.provider), candidate.aaModel) >= 0.08) {
		bits.push(`AA host ${candidate.aaModel.hostLabel}`);
	}
	return bits.slice(0, 4);
}

function hasAnySignal(profile: PromptProfile, signals: string[]): boolean {
	return signals.some((signal) => profile.matchedSignals.includes(signal));
}

function isSimpleEfficiencyTask(profile: PromptProfile): boolean {
	if (profile.routingTier !== "booster" && profile.routingTier !== "simple") return false;
	return !hasAnySignal(profile, ["debugging", "architecture", "security", "critical-system", "research", "long-context", "vision"]);
}

function isMechanicalOrSimpleOutputTask(profile: PromptProfile): boolean {
	return hasAnySignal(profile, ["mechanical-transform", "simple-output", "structured-output"])
		&& !hasAnySignal(profile, ["debugging", "architecture", "security", "critical-system", "research"]);
}

function isCodingSpecializedText(text: string): boolean {
	return /(codex|grok-code|code-fast|coder|qwen3?[-/]?coder|kimi-coding|codestral|deepseek)/.test(text);
}

function isFrontierGeneralText(text: string): boolean {
	return /(gpt-5\.5|gpt-5\.4|gpt-5$|opus|sonnet|gemini-3\.1-pro|pro-preview|grok-4)/.test(text) && !isCodingSpecializedText(text);
}

export function modelSpecializationBonus(model: Model<Api>, profile: PromptProfile): number {
	const text = `${model.id} ${model.name}`.toLowerCase();
	let bonus = 0;
	const codingOrDebugging = profile.matchedSignals.includes("coding") || profile.matchedSignals.includes("debugging");
	const simpleEfficiency = isSimpleEfficiencyTask(profile);
	if (codingOrDebugging) {
		if (isCodingSpecializedText(text)) bonus += profile.matchedSignals.includes("debugging") ? 0.14 : 0.1;
		else if (isFrontierGeneralText(text)) bonus -= profile.matchedSignals.includes("debugging") ? 0.045 : 0.025;
	}
	if (simpleEfficiency) {
		if (/deepseek[-/]?v4[-/]?flash|deepseek-v4-flash/.test(text)) bonus += 0.34;
		if (/gemini.*flash.*lite|flash-lite/.test(text)) bonus += 0.32;
		if (/claude[-/]?haiku|haiku/.test(text)) bonus += 0.28;
		if (/(flash|mini|nano|lite|small|deepseek-v4-flash|deepseek-chat|qwen|kimi|glm|gemma|mistral)/.test(text)) bonus += 0.09;
		if (/(deepseek|qwen|kimi|z-ai|glm|moonshot|alibaba|baidu|bytedance|xiaomi)/.test(text)) bonus += 0.045;
		if (isFrontierGeneralText(text) || /(codex|gpt-5\.5|gpt-5\.4|gpt-5$|opus|pro-preview|gemini-3\.1-pro|grok-4)/.test(text)) bonus -= 0.14;
	}
	if (profile.routingTier === "standard" && !profile.matchedSignals.includes("coding")) {
		if (/(deepseek|qwen|kimi|z-ai|glm|moonshot)/.test(text)) bonus += 0.025;
	}
	if (profile.matchedSignals.includes("long-context") && model.contextWindow >= 350_000) bonus += 0.025;
	if (profile.matchedSignals.includes("vision") && model.input.includes("image")) bonus += 0.015;
	return bonus;
}

function compareNumberDesc(a: number | undefined, b: number | undefined): number {
	return (Number.isFinite(b) ? Number(b) : Number.NEGATIVE_INFINITY) - (Number.isFinite(a) ? Number(a) : Number.NEGATIVE_INFINITY);
}

function compareNumberAsc(a: number | undefined, b: number | undefined): number {
	return (Number.isFinite(a) ? Number(a) : Number.POSITIVE_INFINITY) - (Number.isFinite(b) ? Number(b) : Number.POSITIVE_INFINITY);
}

function simpleTaskEfficiencyScore(candidate: Candidate, profile?: PromptProfile): number {
	const text = `${candidate.piModel.id} ${candidate.piModel.name}`.toLowerCase();
	let familyScore = 0;
	if (/deepseek[-/]?v4[-/]?flash|deepseek-v4-flash/.test(text)) familyScore += 0.95;
	if (/gemini.*flash.*lite|flash-lite/.test(text)) familyScore += 0.92;
	if (/claude[-/]?haiku|haiku/.test(text)) familyScore += 0.85;
	if (/(flash|mini|nano|lite|small|deepseek-v4-flash|deepseek-chat|qwen|kimi|glm|gemma|mistral)/.test(text)) familyScore += 0.18;
	if (/(deepseek|qwen|kimi|z-ai|glm|moonshot|alibaba|baidu|bytedance|xiaomi)/.test(text)) familyScore += 0.1;
	if (profile?.matchedSignals.includes("coding") && isCodingSpecializedText(text)) familyScore += 0.28;
	if (isFrontierGeneralText(text) || /(opus|gpt-5\.5|gpt-5\.4|gpt-5$|gemini-3\.1-pro|pro-preview|grok-4)/.test(text)) familyScore -= 0.22;
	const thinkingScore = ["off", "minimal", "low"].includes(candidate.candidateThinkingLevel) ? 0.08 : -0.08;
	return candidate.economicScore * 0.42 + candidate.latencyScore * 0.22 + candidate.speedScore * 0.12 + candidate.benchmarkScore * 0.16 + familyScore + thinkingScore;
}

export function rankCandidatesForObjective(candidates: Candidate[], objective: RouteObjective, profile?: PromptProfile): Candidate[] {
	const ranked = [...candidates];
	const simpleEfficiency = profile && isSimpleEfficiencyTask(profile);
	if (simpleEfficiency && objective !== "quality" && objective !== "cheapest") {
		ranked.sort((a, b) => compareNumberDesc(simpleTaskEfficiencyScore(a, profile), simpleTaskEfficiencyScore(b, profile)) || compareNumberDesc(a.economicScore, b.economicScore) || compareNumberDesc(a.benchmarkScore, b.benchmarkScore));
		return ranked;
	}
	switch (objective) {
		case "quality":
			ranked.sort((a, b) => compareNumberDesc(a.benchmarkScore, b.benchmarkScore) || compareNumberDesc(a.composite, b.composite) || compareNumberDesc(a.contextScore, b.contextScore));
			break;
		case "cheapest":
			ranked.sort((a, b) => compareNumberAsc(a.price, b.price) || compareNumberDesc(a.economicScore, b.economicScore) || compareNumberDesc(a.benchmarkScore, b.benchmarkScore) || compareNumberDesc(a.latencyScore, b.latencyScore));
			break;
		case "fastest":
			ranked.sort((a, b) => compareNumberDesc(a.latencyScore * 0.65 + a.speedScore * 0.35, b.latencyScore * 0.65 + b.speedScore * 0.35) || compareNumberDesc(a.benchmarkScore, b.benchmarkScore) || compareNumberDesc(a.economicScore, b.economicScore));
			break;
		case "balanced":
		default:
			ranked.sort((a, b) => compareNumberDesc(a.composite, b.composite) || compareNumberDesc(a.benchmarkScore, b.benchmarkScore));
			break;
	}
	return ranked;
}

function thinkingLevelIndex(level: ThinkingLevel): number {
	return ALL_THINKING_LEVELS.indexOf(level);
}

function thinkingAtLeast(actual: ThinkingLevel, minimum: ThinkingLevel): boolean {
	return thinkingLevelIndex(actual) >= thinkingLevelIndex(minimum);
}

function thinkingAtMost(actual: ThinkingLevel, maximum: ThinkingLevel): boolean {
	return thinkingLevelIndex(actual) <= thinkingLevelIndex(maximum);
}

function minimumThinkingForProfile(profile: PromptProfile, objective: RouteObjective): ThinkingLevel {
	const economyObjective = objective === "cheapest" || objective === "fastest";
	if (profile.routingTier === "frontier" || profile.matchedSignals.includes("critical-system") || profile.priorities.reasoningNeed >= 0.82) {
		return economyObjective ? "medium" : "high";
	}
	if (profile.matchedSignals.includes("architecture") || profile.matchedSignals.includes("security")) {
		return economyObjective ? "medium" : "high";
	}
	if (profile.matchedSignals.includes("research")) {
		return thinkingAtLeast(profile.targetThinkingLevel, "high") && !economyObjective ? "high" : "medium";
	}
	if (profile.matchedSignals.includes("debugging")) {
		return economyObjective ? "low" : "medium";
	}
	return "off";
}

function maximumThinkingForProfile(profile: PromptProfile, objective: RouteObjective): ThinkingLevel | undefined {
	if (isMechanicalOrSimpleOutputTask(profile)) {
		if (profile.targetThinkingLevel === "off") return "low";
		if (profile.matchedSignals.includes("coding")) return "medium";
		return objective === "quality" ? "medium" : "low";
	}
	if (isSimpleEfficiencyTask(profile) && !profile.matchedSignals.includes("coding")) {
		return objective === "quality" ? "medium" : "low";
	}
	return undefined;
}

function contextTokenRequirementForProfile(profile: PromptProfile): number | undefined {
	if (profile.priorities.contextNeed >= 0.7 || profile.matchedSignals.includes("long-context")) return 500_000;
	if (profile.priorities.contextNeed >= 0.5) return 200_000;
	return undefined;
}

function isEfficientModelText(text: string): boolean {
	return /(deepseek[-/]?v4[-/]?flash|claude[-/]?haiku|haiku|flash-lite|grok-code-fast|mini|nano|lite|small|qwen|kimi|glm|gemma|mistral)/.test(text)
		&& !isFrontierGeneralText(text);
}

function constrainCandidatesForProfile(candidates: Candidate[], profile: PromptProfile, objective: RouteObjective): Candidate[] {
	if (candidates.length === 0) return candidates;
	const minimumThinking = minimumThinkingForProfile(profile, objective);
	const maximumThinking = maximumThinkingForProfile(profile, objective);
	let constrained = candidates.filter((candidate) => {
		if (!thinkingAtLeast(candidate.candidateThinkingLevel, minimumThinking)) return false;
		if (maximumThinking && !thinkingAtMost(candidate.candidateThinkingLevel, maximumThinking)) return false;
		return true;
	});
	if (constrained.length === 0) constrained = candidates;

	const contextRequirement = contextTokenRequirementForProfile(profile);
	if (contextRequirement) {
		const contextCapable = constrained.filter((candidate) => candidate.contextWindow >= contextRequirement);
		if (contextCapable.length > 0) constrained = contextCapable;
	}

	if (profile.matchedSignals.includes("debugging") || (isSimpleEfficiencyTask(profile) && profile.matchedSignals.includes("coding"))) {
		const specialized = constrained.filter((candidate) => isCodingSpecializedText(`${candidate.piModel.id} ${candidate.piModel.name}`.toLowerCase()));
		if (specialized.length > 0) constrained = specialized;
	}

	if (isMechanicalOrSimpleOutputTask(profile)) {
		const efficient = constrained.filter((candidate) => isEfficientModelText(`${candidate.piModel.id} ${candidate.piModel.name}`.toLowerCase()));
		if (efficient.length > 0) constrained = efficient;
	}

	return constrained;
}

function dominatesCandidate(a: Candidate, b: Candidate): boolean {
	const aValues = [a.benchmarkScore, a.economicScore, a.latencyScore, a.contextScore];
	const bValues = [b.benchmarkScore, b.economicScore, b.latencyScore, b.contextScore];
	const noWorse = aValues.every((value, index) => value + 0.015 >= (bValues[index] ?? 0));
	const materiallyBetter = aValues.some((value, index) => value > (bValues[index] ?? 0) + 0.05);
	return noWorse && materiallyBetter;
}

export function paretoFrontierCandidates(candidates: Candidate[]): Candidate[] {
	return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && dominatesCandidate(other, candidate)));
}

function confidenceForCandidate(candidate: Candidate, profile: PromptProfile, config: RouterConfig): CandidateConfidence {
	const notes: string[] = [];
	const match = clamp((candidate.aaMatchScore - config.strategy.minAaMatch) / Math.max(0.01, 1.25 - config.strategy.minAaMatch), 0, 1);
	if (match < 0.5) notes.push("low-match-confidence");
	const thinkingGap = thinkingDistance(candidate.candidateThinkingLevel, profile.targetThinkingLevel);
	let constraints = clamp(1 - thinkingGap * 0.12, 0, 1);
	if (profile.priorities.contextNeed >= 0.5 && candidate.contextWindow < (contextTokenRequirementForProfile(profile) ?? 0)) {
		constraints -= 0.25;
		notes.push("context-near-floor");
	}
	if (profile.uncertain) {
		constraints -= 0.06;
		notes.push("prompt-uncertain");
	}
	constraints = clamp(constraints, 0, 1);
	const cost = Number.isFinite(candidate.price) ? 1 : 0.25;
	if (cost < 0.5) notes.push("unknown-price");
	const overall = clamp(match * 0.48 + constraints * 0.34 + cost * 0.18, 0, 1);
	if (overall < config.strategy.minRouteConfidence) notes.push("below-route-confidence-threshold");
	return { match, constraints, cost, overall, notes };
}

export function chooseRoute(
	availableModels: Model<Api>[],
	aaModels: AaModel[],
	datasetStats: DatasetStats,
	profile: PromptProfile,
	config: RouterConfig,
	currentModel: Model<Api> | undefined,
	currentThinkingLevel: ThinkingLevel | undefined,
	requireVision: boolean,
): { best: Candidate; topCandidates: Candidate[] } | undefined {
	const routingAaModels = normalizeAaModelsForRouting(aaModels);
	const candidates: Candidate[] = [];
	for (const piModel of availableModels) {
		if (requireVision && !piModel.input.includes("image")) continue;
		for (const candidateThinkingLevel of getSupportedThinkingLevelsForModel(piModel)) {
			const aaMatch = pickAaMatchForPiModel(piModel, routingAaModels, candidateThinkingLevel, config);
			if (!aaMatch) continue;
			const aaModel = aaMatch.aaModel;
			const benchmark = benchmarkScore(aaModel, profile, datasetStats);
			const actualPrice = estimateCandidatePrice(piModel, aaModel, candidateThinkingLevel, profile);
			const actualContext = Number(piModel.contextWindow || aaModel.contextWindowTokens || 0);
			const speed = getAaPromptMetric(aaModel, profile.promptLengthType, "speed");
			const latency = getAaPromptMetric(aaModel, profile.promptLengthType, "latency") ?? getAaTtftMetric(aaModel, profile.promptLengthType);
			candidates.push({
				piModel,
				candidateThinkingLevel,
				requestedThinkingLevel: profile.targetThinkingLevel,
				aaModel,
				aaMatchScore: aaMatch.matchScore,
				aaVariantLevel: aaMatch.variantLevel,
				benchmarkScore: benchmark,
				price: actualPrice,
				tokenBurn: aaModel.tokenBurn,
				speed,
				latency,
				contextWindow: actualContext,
				economicScore: 0,
				speedScore: 0,
				latencyScore: 0,
				contextScore: 0,
				scoreBreakdown: { quality: 0, cost: 0, speed: 0, latency: 0, context: 0, match: 0 },
				reasonBits: [],
				composite: 0,
			});
		}
	}
	if (candidates.length === 0) return undefined;

	const priceValues = candidates.map((candidate) => candidate.price).filter(isFiniteNumber);
	const tokenBurnValues = candidates.map((candidate) => candidate.tokenBurn ?? Number.NaN).filter(isFiniteNumber);
	const contextValues = candidates.map((candidate) => candidate.contextWindow).filter(isFiniteNumber);
	for (const candidate of candidates) {
		candidate.economicScore = candidateEconomicScore(candidate, priceValues, tokenBurnValues);
		candidate.speedScore = candidateSpeedScore(candidate, datasetStats, profile.promptLengthType);
		candidate.latencyScore = candidateLatencyScore(candidate, datasetStats, profile.promptLengthType);
		candidate.contextScore = candidateContextScore(candidate, contextValues);
	}

	const objectiveWeights = buildObjectiveWeights(profile, config.strategy.objective);
	for (const candidate of candidates) {
		const qualityContribution = candidate.benchmarkScore * objectiveWeights.qualityWeight;
		const costContribution = candidate.economicScore * objectiveWeights.costWeight;
		const speedContribution = candidate.speedScore * objectiveWeights.speedWeight;
		const latencyContribution = candidate.latencyScore * objectiveWeights.latencyWeight;
		const contextContribution = candidate.contextScore * objectiveWeights.contextWeight;
		let composite = qualityContribution + costContribution + speedContribution + latencyContribution + contextContribution;
		composite += Math.min(candidate.aaMatchScore - config.strategy.minAaMatch, 0.25) * 0.08;
		composite += modelSpecializationBonus(candidate.piModel, profile);
		const thinkingGap = thinkingDistance(profile.targetThinkingLevel, candidate.candidateThinkingLevel);
		if (candidate.candidateThinkingLevel === profile.targetThinkingLevel) {
			composite += 0.022;
		} else {
			composite -= thinkingGap * 0.028;
		}
		if (profile.priorities.reasoningNeed >= 0.45 && candidate.candidateThinkingLevel === "off") {
			composite -= 0.1;
		}
		if (profile.priorities.reasoningNeed >= 0.65 && ["off", "minimal", "low"].includes(candidate.candidateThinkingLevel)) {
			composite -= 0.08;
		}
		if (profile.priorities.reasoningNeed >= 0.82 && ["off", "minimal", "low", "medium"].includes(candidate.candidateThinkingLevel)) {
			composite -= 0.07;
		}
		if ((profile.routingTier === "booster" || profile.routingTier === "simple") && !["off", "minimal", "low"].includes(candidate.candidateThinkingLevel)) {
			composite -= 0.04;
		}
		if (profile.targetThinkingLevel === "off" && candidate.candidateThinkingLevel !== "off") {
			composite -= 0.03;
		}
		if (profile.priorities.contextNeed >= 0.5 && candidate.contextWindow < 200_000) {
			composite -= 0.04;
		}
		candidate.scoreBreakdown = {
			quality: qualityContribution,
			cost: costContribution,
			speed: speedContribution,
			latency: latencyContribution,
			context: contextContribution,
			match: Math.min(Math.max(candidate.aaMatchScore, 0), 1.4) / 1.4,
		};
		candidate.confidence = confidenceForCandidate(candidate, profile, config);
		candidate.composite = composite;
		candidate.reasonBits = buildCandidateReasonBits(candidate, profile);
		if (candidate.confidence.overall < 0.55) candidate.reasonBits.push(`conf ${(candidate.confidence.overall * 100).toFixed(0)}%`);
	}

	const constrainedCandidates = constrainCandidatesForProfile(candidates, profile, config.strategy.objective);
	if (constrainedCandidates.length === 0) return undefined;
	const bestBenchmark = Math.max(...constrainedCandidates.map((candidate) => candidate.benchmarkScore));
	const relativeFloor = profile.routingTier === "booster" || profile.routingTier === "simple"
		? config.strategy.objective === "quality"
			? clamp(config.strategy.qualityFloor - profile.priorities.costSensitivity * 0.22, 0.45, 0.78)
			: clamp(config.strategy.qualityFloor - profile.priorities.costSensitivity * 0.6 - profile.priorities.speedSensitivity * 0.18, 0.18, 0.58)
		: clamp(config.strategy.qualityFloor - profile.priorities.costSensitivity * 0.15, 0.62, 0.95);
	const floor = bestBenchmark * relativeFloor;
	const viable = constrainedCandidates.filter((candidate) => candidate.benchmarkScore >= floor);
	const frontier = paretoFrontierCandidates(viable.length > 0 ? viable : constrainedCandidates);
	const ranked = rankCandidatesForObjective(frontier.length > 0 ? frontier : viable.length > 0 ? viable : constrainedCandidates, config.strategy.objective, profile);
	let best = ranked[0];

	const currentKey = currentRouteKey(currentModel, currentThinkingLevel);
	if (currentKey) {
		const currentCandidate = constrainedCandidates.find(
			(candidate) => currentRouteKey(candidate.piModel, candidate.candidateThinkingLevel) === currentKey,
		);
		if (currentCandidate && best.composite - currentCandidate.composite <= config.strategy.preferCurrentWithin) {
			best = currentCandidate;
		}
		if (best.confidence && best.confidence.overall < routeConfidenceFloor(config) && currentCandidate) {
			best = currentCandidate;
		}
	}
	if (best.confidence && best.confidence.overall < routeConfidenceFloor(config) && !currentKey) {
		return undefined;
	}

	return {
		best,
		topCandidates: ranked.slice(0, 3),
	};
}

export function buildWinnerReasonLines(
	best: Candidate,
	profile: PromptProfile,
	providerScopeLabel: string,
	benchmarkSummary: string[],
): string[] {
	return [
		`Scope: ${providerScopeLabel}`,
		`Complexity: ${profile.complexityScore !== undefined ? `${Math.round(profile.complexityScore * 100)}%` : "n/a"} (${profile.routingTier ?? "n/a"}) via ${profile.classifierSource ?? "heuristic"}`,
		`Benchmarks: ${benchmarkSummary.join(", ") || "general fit"}`,
		`AA match: ${best.aaModel.name}${best.aaModel.hostLabel ? ` via ${best.aaModel.hostLabel}` : ""}`,
		`Trade-off: fit ${(best.benchmarkScore * 100).toFixed(0)} · cost ${(best.economicScore * 100).toFixed(0)} · speed ${(best.speedScore * 100).toFixed(0)} · latency ${(best.latencyScore * 100).toFixed(0)} · ctx ${(best.contextScore * 100).toFixed(0)}`,
		...(best.confidence ? [`Confidence: overall ${(best.confidence.overall * 100).toFixed(0)} · match ${(best.confidence.match * 100).toFixed(0)} · constraints ${(best.confidence.constraints * 100).toFixed(0)} · cost ${(best.confidence.cost * 100).toFixed(0)}`] : []),
		`Thinking: requested ${profile.targetThinkingLevel}, selected ${best.candidateThinkingLevel}`,
		...(profile.analysisNotes && profile.analysisNotes.length > 0 ? [`Signals: ${profile.analysisNotes.join(", ")}`] : []),
	];
}

export function buildDecisionShortSummary(
	best: Candidate,
	topCandidates: Candidate[],
	profile: PromptProfile,
	objective: RouteObjective,
): string[] {
	const runnerUp = topCandidates.find((candidate) => candidate.piModel.id !== best.piModel.id || candidate.candidateThinkingLevel !== best.candidateThinkingLevel);
	const bestFit = Math.round(best.benchmarkScore * 100);
	const selectedLine = `Selected ${best.piModel.id} @ ${best.candidateThinkingLevel} for a ${profile.routingTier ?? "routed"} prompt (${bestFit}% fit).`;
	if (!runnerUp) {
		return [selectedLine, `No close alternative matched the current scope better.`];
	}
	const runnerFit = Math.round(runnerUp.benchmarkScore * 100);
	const runnerName = `${runnerUp.piModel.id} @ ${runnerUp.candidateThinkingLevel}`;
	const qualityDelta = best.benchmarkScore - runnerUp.benchmarkScore;
	const factorDiffs = [
		{ label: "cost", value: best.economicScore - runnerUp.economicScore },
		{ label: "speed", value: best.speedScore - runnerUp.speedScore },
		{ label: "latency", value: best.latencyScore - runnerUp.latencyScore },
		{ label: "context", value: best.contextScore - runnerUp.contextScore },
	].sort((a, b) => b.value - a.value);
	const positiveFactors = factorDiffs.filter((item) => item.value > 0.03).slice(0, 2).map((item) => item.label);
	if (qualityDelta >= 0.03) {
		return [
			selectedLine,
			`It beat ${runnerName} on task fit (${bestFit}% vs ${runnerFit}%) while staying competitive on the other trade-offs.`,
		];
	}
	if (objective === "quality" && qualityDelta < 0) {
		const reasons = positiveFactors.length > 0 ? positiveFactors.join(" + ") : "overall route score";
		return [
			selectedLine,
			`Quality mode still kept it because it stayed close on fit (${bestFit}% vs ${runnerFit}% for ${runnerName}) and won on ${reasons}.`,
		];
	}
	const reasons = positiveFactors.length > 0 ? positiveFactors.join(" + ") : "overall route score";
	return [
		selectedLine,
		`Its fit was similar to ${runnerName} (${bestFit}% vs ${runnerFit}%), so ${reasons} decided the route.`,
	];
}

export function buildDecisionSummary(params: {
	best: Candidate;
	topCandidates: Candidate[];
	profile: PromptProfile;
	providerScopeMode: ProviderScopeMode;
	providerScopeLabel: string;
	availableModelCount: number;
	availableRouteCount: number;
	dataSourceLabel: string;
	objectiveUsed: RouteObjective;
	changedModel: boolean;
	changedThinkingLevel: boolean;
	actualThinkingLevel: ThinkingLevel;
}): RouteDecisionSummary {
	const benchmarkSummary = buildBenchmarkSummary(params.profile.benchmarkWeights);
	const reasonLines = buildWinnerReasonLines(params.best, params.profile, params.providerScopeLabel, benchmarkSummary);
	return {
		timestamp: Date.now(),
		changedModel: params.changedModel,
		changedThinkingLevel: params.changedThinkingLevel,
		provider: String(params.best.piModel.provider),
		providerScopeMode: params.providerScopeMode,
		providerScopeLabel: params.providerScopeLabel,
		availableModelCount: params.availableModelCount,
		availableRouteCount: params.availableRouteCount,
		dataSourceLabel: params.dataSourceLabel,
		objectiveUsed: params.objectiveUsed,
		modelId: params.best.piModel.id,
		modelName: params.best.piModel.name,
		requestedThinkingLevel: params.profile.targetThinkingLevel,
		thinkingLevel: params.actualThinkingLevel,
		aaSlug: params.best.aaModel.slug,
		aaName: params.best.aaModel.name,
		aaHost: params.best.aaModel.hostLabel,
		benchmarkSummary,
		profileSummary: params.profile.summary,
		complexityScore: params.profile.complexityScore,
		routingTier: params.profile.routingTier,
		classifierSource: params.profile.classifierSource,
		confidence: params.best.confidence,
		reasonLines,
		shortSummary: buildDecisionShortSummary(params.best, params.topCandidates, params.profile, params.objectiveUsed),
		topCandidates: params.topCandidates.map((candidate, index) => ({
			rank: index + 1,
			provider: String(candidate.piModel.provider),
			modelId: candidate.piModel.id,
			modelName: candidate.piModel.name,
			thinkingLevel: candidate.candidateThinkingLevel,
			aaName: candidate.aaModel.name,
			aaHost: candidate.aaModel.hostLabel,
			benchmarkScore: candidate.benchmarkScore,
			composite: candidate.composite,
			economicScore: candidate.economicScore,
			speedScore: candidate.speedScore,
			latencyScore: candidate.latencyScore,
			contextScore: candidate.contextScore,
			confidence: candidate.confidence,
			reasonBits: candidate.reasonBits,
		})),
	};
}

export function isContextDependentFollowUp(prompt: string): boolean {
	return FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(prompt.trim()));
}

export function summarizeDecision(decision: RouteDecisionSummary): string {
	return `${decision.provider}/${decision.modelId} @ ${decision.thinkingLevel} • ${decision.benchmarkSummary.join(", ")}`;
}

