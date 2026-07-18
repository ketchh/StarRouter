import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { writeTextFileAtomically, type AtomicWriteOperations } from "./atomic-write.ts";
import { readBoundedJsonFileIfExists, UNSAFE_OBJECT_KEYS } from "./safe-json-file.ts";
import { inferPromptProfileSmart } from "./prompt-understanding.ts";

export { writeTextFileAtomically } from "./atomic-write.ts";
export type { AtomicWriteOperations } from "./atomic-write.ts";
import {
	applyBuiltInModelFilterPreset,
	applyModelFilters,
	getProviderFilterConfig,
	normalizeModelFilters,
	type RouterModelFilters,
} from "./model-filters-screen.ts";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type PromptLengthType = "medium" | "medium_coding" | "long" | "vision_single_image" | "100k";
export type RouteObjective = "balanced" | "quality" | "cheapest" | "fastest";
export type DataSourceMode = "api" | "page-scrape";
export type ProviderScopeMode = "configured-provider";
export type RecommendationBasis = "objective-ranking" | "hysteresis" | "confidence-fallback";
export type ApplicationOrigin = "auto-accept" | "user-recommended" | "user-current" | "user-alternative";

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

export type AaDatasetProvenance = "network" | "fresh-cache" | "stale-fallback";

export interface AaDataset {
	fetchedAt: number;
	sourceKey: string;
	sourceLabel: string;
	models: AaModel[];
	/** Runtime-only acquisition provenance. It is intentionally not persisted in cache files. */
	provenance?: AaDatasetProvenance;
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

export type AaEvidenceScope = "host-verified" | "model-only";

export interface Candidate {
	piModel: Model<Api>;
	candidateThinkingLevel: ThinkingLevel;
	requestedThinkingLevel: ThinkingLevel;
	aaModel: AaModel;
	aaMatchScore: number;
	aaVariantLevel: ThinkingLevel;
	aaEvidenceScope: AaEvidenceScope;
	benchmarkScore: number;
	price: number;
	tokenBurn?: number;
	speed?: number;
	latency?: number;
	ttft?: number;
	latencyBasis?: "end-to-end" | "ttft";
	aaHostVerified?: boolean;
	aaOverrideApplied?: boolean;
	aaMovingAliasPin?: boolean;
	contextWindow: number;
	economicScore: number;
	speedScore: number;
	latencyScore: number;
	contextScore: number;
	scoreBreakdown: CandidateScoreBreakdown;
	confidence?: CandidateConfidence;
	reasonBits: string[];
	composite: number;
	/** Objective ordering before hysteresis or confidence fallback changes the recommendation. */
	objectiveRank?: number;
}

export interface RouteCandidateSummary {
	/** Presentation order; the recommendation remains first for confirmation compatibility. */
	rank: number;
	objectiveRank?: number;
	recommended?: boolean;
	applied?: boolean;
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

export interface RecommendedRouteSummary {
	provider: string;
	modelId: string;
	modelName: string;
	thinkingLevel: ThinkingLevel;
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
	/** Additive in 1.1.1; absent only on legacy 1.1.0 session entries. */
	recommendationBasis?: RecommendationBasis;
	/** Additive in 1.1.1; absent on legacy entries and pre-confirmation UI summaries. */
	applicationOrigin?: ApplicationOrigin;
	/** The algorithmic recommendation, independent from the applied route fields below. */
	recommendedRoute?: RecommendedRouteSummary;
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

export const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const PROVIDER_HOST_ALIASES: Record<string, string[]> = {
	"amazon-bedrock": ["amazon-bedrock", "amazon bedrock", "bedrock", "aws"],
	anthropic: ["anthropic"],
	google: ["google", "google ai studio"],
	"google-vertex": ["vertex", "google vertex"],
	openai: ["openai"],
	"azure-openai-responses": ["azure", "azure openai"],
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
	"cloudflare-ai-gateway": ["cloudflare", "cloudflare ai gateway"],
	xiaomi: ["xiaomi"],
	"xiaomi-token-plan-cn": ["xiaomi"],
	"xiaomi-token-plan-ams": ["xiaomi"],
	"xiaomi-token-plan-sgp": ["xiaomi"],
};

export const OFFICIAL_AA_ORIGIN = "https://artificialanalysis.ai";
export const ROUTER_STATE_ENTRY = "aa-router-state";
export const ROUTER_DECISION_ENTRY = "aa-router-decision";
export const ROUTER_EXTENSION_DIR = join(getAgentDir(), "extensions", "star-router");
export const DEFAULT_TEST_SUITE_FILE = join(ROUTER_EXTENSION_DIR, "test", "prompts.txt");
export const DATA_CACHE_FILE = join(getAgentDir(), "cache", "star-router-public.json");
export const GLOBAL_CONFIG_FILE = join(getAgentDir(), "model-router.json");
export const GLOBAL_FILTER_PRESETS_DIR = join(getAgentDir(), "model-router-filter-presets");

export const FOLLOW_UP_PATTERNS = [
	/^\s*(?:continue|go ahead|proceed|retry|try again|do it|same|yes|ok|okay)\s*[.!?]*\s*$/i,
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

/** Host/deployment identity must retain qualifiers such as “(Vertex)” and “(Turbo)”. */
export function normalizeHostIdentity(input: string): string {
	return input
		.toLowerCase()
		.replace(/[()\[\]{}]+/g, " ")
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
	if (text.includes("max effort") || /(^|[-\s])max($|[-\s])/.test(text)) return "max";
	if (text.includes("xhigh") || text.includes("adaptive")) return "xhigh";
	return model.reasoningModel ? "xhigh" : "off";
}

export function thinkingDistance(a: ThinkingLevel, b: ThinkingLevel): number {
	const order: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
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

export function estimateCandidatePrice(
	model: Model<Api>,
	aaModel: AaModel,
	thinkingLevel: ThinkingLevel,
	profile: PromptProfile,
	allowAaHostFallback = true,
): number {
	const base = blendPiModelPrice(model) ?? (allowAaHostFallback ? aaModel.priceBlendedPer1M : undefined) ?? Number.POSITIVE_INFINITY;
	if (!Number.isFinite(base)) return base;
	const thinkingMultiplier: Record<ThinkingLevel, number> = {
		off: 1,
		minimal: 1.03,
		low: 1.08,
		medium: 1.18,
		high: 1.35,
		xhigh: 1.55,
		max: 1.75,
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
		if (level === "xhigh" || level === "max") return mapped !== undefined;
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
	if (configured) return providers.includes(configured) ? configured : undefined;
	return providers[0];
}

export function resolveSelectedRoutingProviderFromAll(models: Model<Api>[], config: RouterConfig): string | undefined {
	return resolveRoutingProvider(models, config);
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
	const normalized = normalizeHostIdentity(provider);
	return [...new Set([normalized, ...(PROVIDER_HOST_ALIASES[provider] ?? []).map(normalizeHostIdentity)])].filter(Boolean);
}

function authoritativeAaHostIdentities(aaModel: AaModel): string[] {
	const label = normalizeHostIdentity(aaModel.hostLabel ?? "");
	const slug = normalizeHostIdentity(aaModel.hostSlug ?? "");
	if (label && slug) {
		if (label === slug) return [label];
		// Preserve whichever side carries a deployment qualifier. In AA host-model data the label is
		// normally the qualified side (for example Google (Vertex)) while the slug may stay generic.
		if (label.startsWith(`${slug}-`)) return [label];
		if (slug.startsWith(`${label}-`)) return [slug];
		// Punctuation-only variants such as Z.ai/zai are equivalent, not conflicting deployments.
		if (label.replaceAll("-", "") === slug.replaceAll("-", "")) return [label, slug];
		return [label];
	}
	return [label || slug].filter(Boolean);
}

export function hostAffinityBonus(provider: string, aaModel: AaModel): number {
	const aliases = providerHostAliases(provider);
	const targets = authoritativeAaHostIdentities(aaModel);
	if (aliases.length === 0 || targets.length === 0) return 0;
	// hostApiId identifies the hosted model/API route, not the host itself. It remains useful for
	// model alias similarity, but must never certify host-scoped economics or performance. Host proof
	// is exact after normalization: qualified deployments must be explicit aliases, never fuzzy
	// prefixes/suffixes of a generic provider name.
	return targets.some((target) => aliases.includes(target)) ? 0.14 : 0;
}

const MODEL_ONLY_AGGREGATOR_PROVIDERS = new Set([
	"openrouter",
	"vercel-ai-gateway",
	"github-copilot",
	"opencode",
	"opencode-go",
	"cloudflare-ai-gateway",
]);

function aaHostEvidence(provider: string, aaModel: AaModel): { compatible: boolean; scope: AaEvidenceScope; bonus: number } {
	const hasHostMetadata = [aaModel.hostLabel, aaModel.hostSlug]
		.some((value) => typeof value === "string" && value.trim().length > 0);
	if (!hasHostMetadata) {
		// API host-model rows must identify their host. The page fallback is explicitly model-only.
		return aaModel.sourceMode === "page-scrape"
			? { compatible: true, scope: "model-only", bonus: -0.1 }
			: { compatible: false, scope: "model-only", bonus: 0 };
	}
	const bonus = hostAffinityBonus(provider, aaModel);
	if (bonus >= 0.08) return { compatible: true, scope: "host-verified", bonus };
	// Aggregators can use identity-compatible model quality, but never economics/performance from
	// an unrelated AA host. Direct providers fail closed on the same mismatch.
	return MODEL_ONLY_AGGREGATOR_PROVIDERS.has(provider)
		? { compatible: true, scope: "model-only", bonus: -0.12 }
		: { compatible: false, scope: "model-only", bonus: 0 };
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
		const subfamily = hasToken(normalized, "haiku")
			? "haiku"
			: hasToken(normalized, "sonnet")
				? "sonnet"
				: hasToken(normalized, "opus")
					? "opus"
					: hasToken(normalized, "fable")
						? "fable"
						: undefined;
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
						: hasToken(normalized, "sol")
							? "sol"
							: hasToken(normalized, "luna")
								? "luna"
								: hasToken(normalized, "terra")
									? "terra"
									: hasToken(normalized, "oss")
										? "oss"
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

function versionFromMatch(match: RegExpMatchArray | null): string | undefined {
	if (!match?.[1]) return undefined;
	return match[2] ? `${match[1]}.${match[2]}` : match[1];
}

function extractGenerationFromText(normalized: string, family: string | undefined): string | undefined {
	const patterns: Partial<Record<string, RegExp[]>> = {
		claude: [/(?:^|-)claude-(?:(?:haiku|sonnet|opus)-)?(\d+)(?:-(\d+))?(?:-|$)/],
		gpt: [/(?:^|-)gpt-(\d+)(?:-(\d+))?(?:-|$)/],
		gemini: [/(?:^|-)gemini-(\d+)(?:-(\d+))?(?:-|$)/],
		deepseek: [/(?:^|-)deepseek-(?:v)?(\d+)(?:-(\d+))?(?:-|$)/],
		qwen: [/(?:^|-)qwen-?(\d+)(?:-(\d+))?(?:-|$)/],
		kimi: [/(?:^|-)kimi-(?:k)?(\d+)(?:-(\d+))?(?:-|$)/],
		hermes: [/(?:^|-)hermes-(\d+)(?:-(\d+))?(?:-|$)/],
		mistral: [/(?:^|-)(?:mistral|mixtral|codestral|magistral)(?:-[a-z]+)*?-(\d+)(?:-(\d+))?(?:-|$)/],
		granite: [/(?:^|-)granite-(\d+)(?:-(\d+))?(?:-|$)/],
		nova: [/(?:^|-)nova-(\d+)(?:-(\d+))?(?:-|$)/],
		phi: [/(?:^|-)phi-(\d+)(?:-(\d+))?(?:-|$)/],
	};
	for (const pattern of family ? patterns[family] ?? [] : []) {
		const version = versionFromMatch(normalized.match(pattern));
		if (version) return version;
	}
	return firstNumericGeneration(tokenize(normalized));
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
	if (identity.family === "claude") return ["haiku", "sonnet", "opus", "fable"].includes(identity.subfamily);
	if (identity.family === "gpt") return ["codex", "sol", "luna", "terra", "oss"].includes(identity.subfamily);
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

export function modelIdentityCompatibility(
	piIdentity: ModelIdentity,
	aaIdentity: ModelIdentity,
	options: { allowPinnedMovingAlias?: boolean } = {},
): { compatible: boolean; bonus: number; reason?: string } {
	if (piIdentity.movingAlias && !options.allowPinnedMovingAlias) {
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
	if (requiresGenerationMatch(piIdentity) || requiresGenerationMatch(aaIdentity)) {
		if (piIdentity.generation !== aaIdentity.generation) {
			return {
				compatible: false,
				bonus: 0,
				reason: `generation ${piIdentity.generation ?? "unknown"}≠${aaIdentity.generation ?? "unknown"}`,
			};
		}
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
	if (piIdentity.family === aaIdentity.family && (piIdentity.variant || aaIdentity.variant) && piIdentity.variant !== aaIdentity.variant) {
		return { compatible: false, bonus: 0, reason: `variant ${piIdentity.variant ?? "base"}≠${aaIdentity.variant ?? "base"}` };
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
		if (UNSAFE_OBJECT_KEYS.has(key)) continue;
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

export const MAX_ROUTER_CONFIG_BYTES = 1024 * 1024;
export const MAX_ROUTER_CONFIG_ENTRIES = 512;
export const MAX_ROUTER_IDENTIFIER_LENGTH = 256;
const MAX_ROUTER_CONFIG_STRING_LENGTH = 2048;

export function readJsonIfExists(path: string, maxBytes = MAX_ROUTER_CONFIG_BYTES): unknown | undefined {
	return readBoundedJsonFileIfExists(path, maxBytes);
}

export type RouterSettingsScope = "global" | "project";

export function getProjectConfigFile(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "model-router.json");
}

export function getConfigFileForScope(scope: RouterSettingsScope, cwd: string): string {
	return scope === "global" ? GLOBAL_CONFIG_FILE : getProjectConfigFile(cwd);
}

export function getProjectFilterPresetDir(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "model-router-filter-presets");
}

export function getFilterPresetDirForScope(scope: RouterSettingsScope, cwd: string): string {
	return scope === "global" ? GLOBAL_FILTER_PRESETS_DIR : getProjectFilterPresetDir(cwd);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedNumber(value: unknown, fallback: number, min: number, max: number, integer = false): number {
	const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
	if (!Number.isFinite(parsed)) return fallback;
	const clamped = clamp(parsed, min, max);
	return integer ? Math.round(clamped) : clamped;
}

function normalizedString(value: unknown, fallback: string, maxLength = MAX_ROUTER_CONFIG_STRING_LENGTH): string {
	return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength ? value.trim() : fallback;
}

function boundedStringEntries(value: unknown): Array<[string, string]> {
	if (!isRecord(value)) return [];
	const entries: Array<[string, string]> = [];
	let examined = 0;
	for (const [key, rawValue] of Object.entries(value)) {
		if (examined >= MAX_ROUTER_CONFIG_ENTRIES) break;
		examined += 1;
		if (UNSAFE_OBJECT_KEYS.has(key) || key.length === 0 || key.length > MAX_ROUTER_IDENTIFIER_LENGTH) continue;
		if (typeof rawValue !== "string") continue;
		const normalizedValue = rawValue.trim();
		if (normalizedValue.length === 0 || normalizedValue.length > MAX_ROUTER_IDENTIFIER_LENGTH) continue;
		entries.push([key, normalizedValue]);
	}
	return entries;
}

export function normalizeRouterConfig(config: RouterConfig): RouterConfig {
	const raw = isRecord(config) ? config as unknown as Record<string, unknown> : {};
	const rawDataSource = isRecord(raw.dataSource) ? raw.dataSource : {};
	const rawStrategy = isRecord(raw.strategy) ? raw.strategy : {};
	const rawUi = isRecord(raw.ui) ? raw.ui : {};
	const dataSourceModes: DataSourceMode[] = ["api", "page-scrape"];
	const promptLengths: PromptLengthType[] = ["medium", "medium_coding", "long", "vision_single_image", "100k"];
	const objectives: RouteObjective[] = ["balanced", "quality", "cheapest", "fastest"];
	const legacyPageUrl = typeof rawDataSource.url === "string" ? rawDataSource.url : undefined;
	const apiKeyEnv = typeof rawDataSource.apiKeyEnv === "string"
		&& rawDataSource.apiKeyEnv.trim().length > 0
		&& rawDataSource.apiKeyEnv.trim().length <= MAX_ROUTER_IDENTIFIER_LENGTH
		? rawDataSource.apiKeyEnv.trim()
		: DEFAULT_CONFIG.dataSource.apiKeyEnv;
	const routingProvider = typeof rawStrategy.routingProvider === "string"
		&& rawStrategy.routingProvider.trim().length > 0
		&& rawStrategy.routingProvider.trim().length <= MAX_ROUTER_IDENTIFIER_LENGTH
		? rawStrategy.routingProvider.trim()
		: undefined;
	const modelOverrides = isRecord(raw.modelOverrides)
		? Object.fromEntries(boundedStringEntries(raw.modelOverrides))
		: structuredClone(DEFAULT_CONFIG.modelOverrides);

	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_CONFIG.enabled,
		dataSource: {
			mode: dataSourceModes.includes(rawDataSource.mode as DataSourceMode) ? rawDataSource.mode as DataSourceMode : DEFAULT_CONFIG.dataSource.mode,
			baseUrl: normalizedString(rawDataSource.baseUrl, DEFAULT_CONFIG.dataSource.baseUrl),
			apiPath: normalizedString(rawDataSource.apiPath, DEFAULT_CONFIG.dataSource.apiPath),
			pageUrl: normalizedString(rawDataSource.pageUrl ?? legacyPageUrl, DEFAULT_CONFIG.dataSource.pageUrl),
			apiKeyEnv,
			cacheTtlMinutes: normalizedNumber(rawDataSource.cacheTtlMinutes, DEFAULT_CONFIG.dataSource.cacheTtlMinutes, 1, 10_080, true),
			requestTimeoutMs: normalizedNumber(rawDataSource.requestTimeoutMs, DEFAULT_CONFIG.dataSource.requestTimeoutMs, 1_000, 120_000, true),
			parallelQueries: normalizedNumber(rawDataSource.parallelQueries, DEFAULT_CONFIG.dataSource.parallelQueries, 1, 32, true),
			promptLength: promptLengths.includes(rawDataSource.promptLength as PromptLengthType) ? rawDataSource.promptLength as PromptLengthType : DEFAULT_CONFIG.dataSource.promptLength,
		},
		strategy: {
			objective: objectives.includes(rawStrategy.objective as RouteObjective) ? rawStrategy.objective as RouteObjective : DEFAULT_CONFIG.strategy.objective,
			qualityFloor: normalizedNumber(rawStrategy.qualityFloor, DEFAULT_CONFIG.strategy.qualityFloor, 0.3, 0.99),
			preferCurrentWithin: normalizedNumber(rawStrategy.preferCurrentWithin, DEFAULT_CONFIG.strategy.preferCurrentWithin, 0, 0.5),
			minAaMatch: normalizedNumber(rawStrategy.minAaMatch, DEFAULT_CONFIG.strategy.minAaMatch, 0, 1.2),
			minRouteConfidence: normalizedNumber(rawStrategy.minRouteConfidence, DEFAULT_CONFIG.strategy.minRouteConfidence, 0, 1),
			routingProvider,
		},
		ui: {
			showAdvancedSettings: typeof rawUi.showAdvancedSettings === "boolean" ? rawUi.showAdvancedSettings : DEFAULT_CONFIG.ui.showAdvancedSettings,
			autoAcceptRouting: typeof rawUi.autoAcceptRouting === "boolean" ? rawUi.autoAcceptRouting : DEFAULT_CONFIG.ui.autoAcceptRouting,
		},
		filters: normalizeModelFilters(isRecord(raw.filters) ? raw.filters as Partial<RouterModelFilters> : undefined),
		modelOverrides,
	};
}

export interface RouterProjectConfig {
	strategy: Omit<RouterConfig["strategy"], "routingProvider">;
	ui: Pick<RouterConfig["ui"], "showAdvancedSettings">;
	filters: RouterModelFilters;
	modelOverrides: Record<string, string>;
}

export function projectConfigProjection(config: RouterConfig): RouterProjectConfig {
	const normalized = normalizeRouterConfig(config);
	const { routingProvider: _routingProvider, ...strategy } = normalized.strategy;
	return {
		strategy,
		ui: { showAdvancedSettings: normalized.ui.showAdvancedSettings },
		filters: normalized.filters,
		modelOverrides: normalized.modelOverrides,
	};
}

function projectConfigOverride(value: unknown): Partial<RouterConfig> | undefined {
	if (!isRecord(value)) return undefined;
	const rawStrategy = isRecord(value.strategy) ? value.strategy : {};
	const strategy = Object.fromEntries(
		["objective", "qualityFloor", "preferCurrentWithin", "minAaMatch", "minRouteConfidence"]
			.filter((key) => rawStrategy[key] !== undefined)
			.map((key) => [key, rawStrategy[key]]),
	);
	const rawUi = isRecord(value.ui) ? value.ui : {};
	const override: Partial<RouterConfig> = {};
	if (Object.keys(strategy).length > 0) override.strategy = strategy as RouterConfig["strategy"];
	if (rawUi.showAdvancedSettings !== undefined) {
		override.ui = { showAdvancedSettings: rawUi.showAdvancedSettings } as RouterConfig["ui"];
	}
	if (value.filters !== undefined) override.filters = value.filters as RouterModelFilters;
	if (value.modelOverrides !== undefined) override.modelOverrides = value.modelOverrides as Record<string, string>;
	return override;
}

export function loadGlobalConfig(): RouterConfig {
	let config = structuredClone(DEFAULT_CONFIG) as RouterConfig;
	try {
		const globalConfig = readJsonIfExists(GLOBAL_CONFIG_FILE);
		if (isRecord(globalConfig)) config = mergeDeep(config, globalConfig as Partial<RouterConfig>);
	} catch (error) {
		console.error(`[star-router] Failed to parse ${GLOBAL_CONFIG_FILE}:`, error);
	}
	return normalizeRouterConfig(config);
}

export function loadConfig(cwd: string): RouterConfig {
	const projectConfigPath = getProjectConfigFile(cwd);
	let config = loadGlobalConfig();
	try {
		config = mergeDeep(config, projectConfigOverride(readJsonIfExists(projectConfigPath)));
	} catch (error) {
		console.error(`[star-router] Failed to parse ${projectConfigPath}:`, error);
	}
	return normalizeRouterConfig(config);
}

export function saveConfigForScope(scope: RouterSettingsScope, cwd: string, config: RouterConfig): string {
	const path = getConfigFileForScope(scope, cwd);
	const persisted = scope === "project" ? projectConfigProjection(config) : normalizeRouterConfig(config);
	const content = `${JSON.stringify(persisted, null, 2)}\n`;
	if (Buffer.byteLength(content, "utf8") > MAX_ROUTER_CONFIG_BYTES) {
		throw new Error(`Router configuration exceeds ${MAX_ROUTER_CONFIG_BYTES} bytes`);
	}
	mkdirSync(dirname(path), { recursive: true });
	writeTextFileAtomically(path, content, scope === "global" ? 0o600 : 0o644);
	return path;
}

export function saveCache(
	path: string,
	data: unknown,
	operations?: AtomicWriteOperations,
	maxBytes = MAX_AA_CACHE_BYTES,
): void {
	const content = JSON.stringify(data);
	if (Buffer.byteLength(content, "utf8") > maxBytes) {
		throw new Error(`Artificial Analysis cache exceeds ${maxBytes} bytes`);
	}
	mkdirSync(dirname(path), { recursive: true });
	writeTextFileAtomically(path, content, 0o600, operations);
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

const PROMPT_LENGTH_TYPES = new Set<PromptLengthType>(["medium", "medium_coding", "long", "vision_single_image", "100k"]);

export function parsePromptSpeedProfiles(rawEntries: unknown): PromptSpeedProfile[] {
	if (!Array.isArray(rawEntries)) return [];
	return rawEntries
		.map((entry: any): PromptSpeedProfile | undefined => {
			const promptLengthType = entry?.prompt_length_type as PromptLengthType | undefined;
			// AA can add observational buckets (for example medium_parallel) independently of
			// StarRouter. Ignore unknown buckets while keeping recognized profiles strict.
			if (!promptLengthType || typeof promptLengthType !== "string" || !PROMPT_LENGTH_TYPES.has(promptLengthType)) return undefined;
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
		hostSlug: typeof raw.host?.slug === "string" ? raw.host.slug : undefined,
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

const MAX_AA_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_AA_CACHE_BYTES = 40 * 1024 * 1024;
const MAX_AA_MODELS = 20_000;
const MAX_AA_PROFILES_PER_MODEL = 32;
const MAX_EXTERNAL_STRING_LENGTH = 4_096;

async function readResponseTextBounded(response: Response, maxBytes = MAX_AA_RESPONSE_BYTES): Promise<string> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		throw new Error(`Artificial Analysis response exceeds ${maxBytes} bytes`);
	}
	if (!response.body) {
		const text = await response.text();
		if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error(`Artificial Analysis response exceeds ${maxBytes} bytes`);
		return text;
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel("response too large");
			throw new Error(`Artificial Analysis response exceeds ${maxBytes} bytes`);
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(merged);
}

export async function fetchAaModelsViaPage(config: RouterConfig, now: number): Promise<AaDataset> {
	const response = await fetch(config.dataSource.pageUrl, {
		headers: {
			"user-agent": "pi-star-router/1.1",
		},
		signal: AbortSignal.timeout(config.dataSource.requestTimeoutMs),
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} fetching ${config.dataSource.pageUrl}`);
	}
	const html = await readResponseTextBounded(response);
	const decoded = decodeNextFlightChunks(html).join("");
	const arrayText = findJsonArray(decoded, '"defaultData":[');
	if (!arrayText) {
		throw new Error("Could not find defaultData in Artificial Analysis page");
	}
	const rawModels = safeJsonParse<any[]>(arrayText);
	if (!Array.isArray(rawModels)) {
		throw new Error("defaultData was not a JSON array");
	}
	if (rawModels.length > MAX_AA_MODELS) throw new Error(`Artificial Analysis page exceeds ${MAX_AA_MODELS} models`);
	const models = rawModels.map(trimAaPageModel).filter((value): value is AaModel => Boolean(value));
	if (models.length === 0) throw new Error("Artificial Analysis page returned no usable models");
	return {
		fetchedAt: now,
		sourceKey: buildDataSourceCacheKey({ ...config, dataSource: { ...config.dataSource, mode: "page-scrape" } }),
		sourceLabel: `page ${config.dataSource.pageUrl}`,
		models,
	};
}

export function buildAaApiUrl(config: RouterConfig): string {
	const base = new URL(config.dataSource.baseUrl);
	if (config.dataSource.apiPath.includes("\\")) {
		throw new Error("Artificial Analysis apiPath must not contain backslashes");
	}
	const resolutionBase = base.toString().endsWith("/") ? base : new URL(`${base.toString()}/`);
	const url = new URL(config.dataSource.apiPath, resolutionBase);
	if (url.origin !== base.origin) {
		throw new Error(`Artificial Analysis apiPath must stay on ${base.origin}`);
	}
	url.searchParams.set("prompt_length", config.dataSource.promptLength);
	url.searchParams.set("parallel_queries", String(config.dataSource.parallelQueries));
	return url.toString();
}

export function isOfficialAaApiOrigin(baseUrl: string): boolean {
	try {
		const url = new URL(baseUrl);
		return url.protocol === "https:" && url.origin === OFFICIAL_AA_ORIGIN;
	} catch {
		return false;
	}
}

export function buildAaRequestHeaders(config: RouterConfig, apiUrl = buildAaApiUrl(config)): Record<string, string> {
	const headers: Record<string, string> = {
		accept: "application/json",
		"user-agent": "pi-star-router/1.1",
	};
	const apiKey = config.dataSource.apiKeyEnv && isOfficialAaApiOrigin(apiUrl)
		? process.env[config.dataSource.apiKeyEnv]
		: undefined;
	if (apiKey) {
		headers.authorization = `Bearer ${apiKey}`;
		headers["x-api-key"] = apiKey;
	}
	return headers;
}

export async function fetchAaModelsViaApi(config: RouterConfig, now: number): Promise<AaDataset> {
	const apiUrl = buildAaApiUrl(config);
	const response = await fetch(apiUrl, {
		headers: buildAaRequestHeaders(config, apiUrl),
		redirect: "error",
		signal: AbortSignal.timeout(config.dataSource.requestTimeoutMs),
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} fetching ${apiUrl}`);
	}
	const payload = safeJsonParse<any>(await readResponseTextBounded(response));
	if (!payload) throw new Error("Artificial Analysis API returned invalid JSON");
	const rawModels = Array.isArray(payload?.hostModels)
		? payload.hostModels
		: Array.isArray(payload?.hostsModels)
			? payload.hostsModels
			: undefined;
	if (!Array.isArray(rawModels)) {
		throw new Error("Artificial Analysis API response did not include hostModels[]");
	}
	if (rawModels.length > MAX_AA_MODELS) throw new Error(`Artificial Analysis API exceeds ${MAX_AA_MODELS} models`);
	const models = rawModels.map(trimAaApiModel).filter((value): value is AaModel => Boolean(value));
	if (models.length === 0) throw new Error("Artificial Analysis API returned no usable models");
	return {
		fetchedAt: now,
		sourceKey: buildDataSourceCacheKey(config),
		sourceLabel: buildDataSourceLabel(config),
		models,
	};
}

const DATASET_FUTURE_TOLERANCE_MS = 5 * 60_000;
const AA_OPTIONAL_NUMBER_FIELDS = [
	"intelligenceIndex",
	"agenticIndex",
	"codingIndex",
	"gdpvalNormalized",
	"tau2",
	"terminalbenchHard",
	"scicode",
	"livecodebench",
	"ifbench",
	"omniscience",
	"gpqa",
	"hle",
	"critpt",
	"lcr",
	"contextWindowTokens",
	"priceInputPer1M",
	"priceOutputPer1M",
	"priceBlendedPer1M",
	"cacheHitPricePer1M",
	"fallbackTimeToFirstAnswerToken",
	"fallbackEndToEndResponseTime",
	"tokenBurn",
] as const;
const SPEED_OPTIONAL_NUMBER_FIELDS = [
	"medianOutputSpeed",
	"medianTimeToFirstAnswerToken",
	"medianEndToEndResponseTime",
] as const;

function hasOnlyFiniteOptionalNumbers(value: Record<string, unknown>, fields: readonly string[]): boolean {
	return fields.every((field) => value[field] === undefined || isFiniteNumber(value[field]));
}

function isBoundedExternalString(value: unknown, required = false): boolean {
	if (value === undefined && !required) return true;
	return typeof value === "string"
		&& (!required || value.length > 0)
		&& value.length <= MAX_EXTERNAL_STRING_LENGTH
		&& !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function isUsablePromptSpeedProfile(value: unknown): value is PromptSpeedProfile {
	return isRecord(value)
		&& PROMPT_LENGTH_TYPES.has(value.promptLengthType as PromptLengthType)
		&& hasOnlyFiniteOptionalNumbers(value, SPEED_OPTIONAL_NUMBER_FIELDS);
}

function isUsableAaModel(value: unknown): value is AaModel {
	if (!isRecord(value)) return false;
	if (value.sourceMode !== "api" && value.sourceMode !== "page-scrape") return false;
	for (const field of ["slug", "name", "shortName"] as const) {
		if (!isBoundedExternalString(value[field], true)) return false;
	}
	for (const field of ["creatorName", "hostLabel", "hostSlug", "hostApiId"] as const) {
		if (!isBoundedExternalString(value[field])) return false;
	}
	if (typeof value.reasoningModel !== "boolean" || typeof value.inputModalityImage !== "boolean") return false;
	if (!hasOnlyFiniteOptionalNumbers(value, AA_OPTIONAL_NUMBER_FIELDS)) return false;
	return Array.isArray(value.performanceByPromptLength)
		&& value.performanceByPromptLength.length <= MAX_AA_PROFILES_PER_MODEL
		&& value.performanceByPromptLength.every(isUsablePromptSpeedProfile);
}

export function isUsableAaDataset(value: unknown, expectedSourceKey?: string, now = Date.now()): value is AaDataset {
	if (!isRecord(value)) return false;
	if (!isFiniteNumber(value.fetchedAt) || value.fetchedAt < 0 || value.fetchedAt > now + DATASET_FUTURE_TOLERANCE_MS) return false;
	if (!isBoundedExternalString(value.sourceKey, true) || !isBoundedExternalString(value.sourceLabel, true)) return false;
	if (expectedSourceKey !== undefined && value.sourceKey !== expectedSourceKey) return false;
	return Array.isArray(value.models)
		&& value.models.length > 0
		&& value.models.length <= MAX_AA_MODELS
		&& value.models.every(isUsableAaModel);
}

export interface FetchAaModelsOptions {
	forceRefresh?: boolean;
	/** Prevent an obsolete generation from replacing a newer cache snapshot. */
	shouldPersist?: () => boolean;
	/** Deterministic persistence seam used by durability tests. */
	cacheWriteOperations?: AtomicWriteOperations;
}

function readBoundedCache(path: string): unknown | undefined {
	try {
		return readBoundedJsonFileIfExists(path, MAX_AA_CACHE_BYTES);
	} catch {
		return undefined;
	}
}

export async function fetchAaModels(
	config: RouterConfig,
	cacheFile = DATA_CACHE_FILE,
	options: FetchAaModelsOptions = {},
): Promise<AaDataset> {
	const now = Date.now();
	const cached = readBoundedCache(cacheFile);
	const ttlMs = config.dataSource.cacheTtlMinutes * 60_000;
	const sourceKey = buildDataSourceCacheKey(config);
	if (!options.forceRefresh && isUsableAaDataset(cached, sourceKey) && now - cached.fetchedAt < ttlMs) {
		return { ...cached, provenance: "fresh-cache" };
	}
	try {
		let dataset: AaDataset;
		if (config.dataSource.mode === "api") {
			try {
				dataset = await fetchAaModelsViaApi(config, now);
			} catch (error) {
				console.error("[star-router] API fetch failed, falling back to page scrape:", error);
				const pageDataset = await fetchAaModelsViaPage(config, now);
				dataset = {
					...pageDataset,
					sourceKey,
					sourceLabel: `${pageDataset.sourceLabel} (API fallback)`,
				};
			}
		} else {
			dataset = await fetchAaModelsViaPage(config, now);
		}
		if (!isUsableAaDataset(dataset, sourceKey)) throw new Error("Artificial Analysis dataset failed validation");
		const persisted = { ...dataset };
		delete persisted.provenance;
		if (options.shouldPersist?.() !== false) {
			try {
				saveCache(cacheFile, persisted, options.cacheWriteOperations);
			} catch (error) {
				// A validated network snapshot remains authoritative for this run even if local durability
				// fails. Do not reinterpret a cache-write error as acquisition failure or use older data.
				console.error("[star-router] Failed to persist Artificial Analysis cache; using fresh network data:", error);
			}
		}
		return { ...dataset, provenance: "network" };
	} catch (error) {
		if (isUsableAaDataset(cached, sourceKey)) {
			console.error("[star-router] Using stale Artificial Analysis cache after fetch failure:", error);
			return { ...cached, provenance: "stale-fallback" };
		}
		throw error;
	}
}

function aaRowCompleteness(model: AaModel): number {
	let score = 0;
	for (const value of Object.values(model)) {
		if (isFiniteNumber(value)) score += 1;
		else if (typeof value === "string" && value.length > 0) score += 1;
	}
	for (const profile of model.performanceByPromptLength) {
		score += 1;
		if (isFiniteNumber(profile.medianOutputSpeed)) score += 1;
		if (isFiniteNumber(profile.medianTimeToFirstAnswerToken)) score += 1;
		if (isFiniteNumber(profile.medianEndToEndResponseTime)) score += 1;
	}
	return score;
}

function stableAaRowKey(model: AaModel): string {
	const profiles = [...model.performanceByPromptLength]
		.sort((a, b) => a.promptLengthType.localeCompare(b.promptLengthType))
		.map((profile) => [
			profile.promptLengthType,
			profile.medianOutputSpeed ?? null,
			profile.medianTimeToFirstAnswerToken ?? null,
			profile.medianEndToEndResponseTime ?? null,
		]);
	return JSON.stringify([
		model.sourceMode, model.slug, model.name, model.shortName, model.creatorName ?? null,
		model.modelUrl ?? null, model.hostLabel ?? null, model.hostSlug ?? null, model.hostApiId ?? null,
		model.intelligenceIndex ?? null, model.agenticIndex ?? null, model.codingIndex ?? null,
		model.gdpvalNormalized ?? null, model.tau2 ?? null, model.terminalbenchHard ?? null,
		model.scicode ?? null, model.livecodebench ?? null, model.ifbench ?? null,
		model.omniscience ?? null, model.gpqa ?? null, model.hle ?? null, model.critpt ?? null,
		model.lcr ?? null, model.contextWindowTokens ?? null, model.priceInputPer1M ?? null,
		model.priceOutputPer1M ?? null, model.priceBlendedPer1M ?? null,
		model.cacheHitPricePer1M ?? null, model.reasoningModel, model.inputModalityImage, profiles,
		model.fallbackTimeToFirstAnswerToken ?? null, model.fallbackEndToEndResponseTime ?? null,
		model.tokenBurn ?? null,
	]);
}

function selectCoherentAaRow(entries: AaModel[]): AaModel {
	return entries
		.map((model) => ({ model, completeness: aaRowCompleteness(model), stableKey: stableAaRowKey(model) }))
		.sort((a, b) => {
			const completenessDelta = b.completeness - a.completeness;
			if (completenessDelta !== 0) return completenessDelta;
			return a.stableKey < b.stableKey ? -1 : a.stableKey > b.stableKey ? 1 : 0;
		})[0]!.model;
}

export function normalizeAaModelsForRouting(models: AaModel[]): AaModel[] {
	const deployments = new Map<string, AaModel[]>();
	for (const model of models) {
		const hostParts = [model.hostLabel, model.hostSlug]
			.map((value) => normalizeHostIdentity(value ?? ""));
		const hostKey = hostParts.some(Boolean) ? hostParts.join("::") : "unhosted";
		const apiRouteKey = normalizeHostIdentity(model.hostApiId ?? "") || "default-route";
		const key = `${normalizeKey(model.slug)}::${hostKey}::${apiRouteKey}`;
		const entries = deployments.get(key) ?? [];
		entries.push(model);
		deployments.set(key, entries);
	}
	// True duplicates select one complete source row. Metrics are never combined across rows, and
	// sorting by deployment key plus a stable row comparator removes input-order dependence.
	return [...deployments.entries()]
		.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
		.map(([, entries]) => selectCoherentAaRow(entries));
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
		ttft_medium: (model) => getAaTtftMetric(model, "medium"),
		ttft_medium_coding: (model) => getAaTtftMetric(model, "medium_coding"),
		ttft_long: (model) => getAaTtftMetric(model, "long"),
		ttft_vision_single_image: (model) => getAaTtftMetric(model, "vision_single_image"),
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

export interface AaMatchResult {
	aaModel: AaModel;
	matchScore: number;
	variantLevel: ThinkingLevel;
	evidenceScope: AaEvidenceScope;
	hostVerified: boolean;
	overrideApplied: boolean;
	movingAliasPin: boolean;
}

const aaMatchCache = new Map<string, AaMatchResult | undefined>();
let aaFingerprintCache = new WeakMap<AaModel[], string>();
const AA_MATCH_CACHE_MAX_ENTRIES = 25_000;

export function clearAaMatchCache(): void {
	aaMatchCache.clear();
	aaFingerprintCache = new WeakMap<AaModel[], string>();
}

function aaModelSetFingerprint(aaModels: AaModel[]): string {
	const cached = aaFingerprintCache.get(aaModels);
	if (cached) return cached;
	const hash = createHash("sha256");
	for (const model of aaModels) {
		hash.update(JSON.stringify({
			sourceMode: model.sourceMode,
			slug: model.slug,
			name: model.name,
			shortName: model.shortName,
			creatorName: model.creatorName,
			hostLabel: model.hostLabel,
			hostSlug: model.hostSlug,
			hostApiId: model.hostApiId,
			intelligenceIndex: model.intelligenceIndex,
			agenticIndex: model.agenticIndex,
			codingIndex: model.codingIndex,
			gdpvalNormalized: model.gdpvalNormalized,
			tau2: model.tau2,
			terminalbenchHard: model.terminalbenchHard,
			scicode: model.scicode,
			livecodebench: model.livecodebench,
			ifbench: model.ifbench,
			omniscience: model.omniscience,
			gpqa: model.gpqa,
			hle: model.hle,
			critpt: model.critpt,
			lcr: model.lcr,
			contextWindowTokens: model.contextWindowTokens,
			priceInputPer1M: model.priceInputPer1M,
			priceOutputPer1M: model.priceOutputPer1M,
			priceBlendedPer1M: model.priceBlendedPer1M,
			cacheHitPricePer1M: model.cacheHitPricePer1M,
			reasoningModel: model.reasoningModel,
			inputModalityImage: model.inputModalityImage,
			performanceByPromptLength: model.performanceByPromptLength,
			fallbackTimeToFirstAnswerToken: model.fallbackTimeToFirstAnswerToken,
			fallbackEndToEndResponseTime: model.fallbackEndToEndResponseTime,
			tokenBurn: model.tokenBurn,
		}));
		hash.update("\u001e");
	}
	const fingerprint = `${aaModels.length}:${hash.digest("base64url").slice(0, 22)}`;
	aaFingerprintCache.set(aaModels, fingerprint);
	return fingerprint;
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
): AaMatchResult | undefined {
	const cacheKey = aaMatchCacheKey(piModel, aaModels, candidateThinkingLevel, config);
	if (aaMatchCache.has(cacheKey)) return aaMatchCache.get(cacheKey);

	const remember = (value: AaMatchResult | undefined) => {
		if (aaMatchCache.size >= AA_MATCH_CACHE_MAX_ENTRIES) aaMatchCache.clear();
		aaMatchCache.set(cacheKey, value);
		return value;
	};
	const provider = String(piModel.provider);
	const piIdentity = identityForPiModel(piModel);
	const stableAaKey = (model: AaModel) => [model.slug, model.hostSlug, model.hostLabel, model.hostApiId].map((value) => value ?? "").join("::");
	const scopeRank = (scope: AaEvidenceScope) => scope === "host-verified" ? 1 : 0;
	const betterMatch = (candidate: AaMatchResult, current: AaMatchResult | undefined) => !current
		|| scopeRank(candidate.evidenceScope) > scopeRank(current.evidenceScope)
		|| (candidate.evidenceScope === current.evidenceScope && candidate.matchScore > current.matchScore + 1e-12)
		|| (candidate.evidenceScope === current.evidenceScope
			&& Math.abs(candidate.matchScore - current.matchScore) <= 1e-12
			&& stableAaKey(candidate.aaModel).localeCompare(stableAaKey(current.aaModel)) < 0);

	let bestOverride: AaMatchResult | undefined;
	for (const key of buildPiOverrideKey(piModel, candidateThinkingLevel)) {
		const overrideSlug = config.modelOverrides[key];
		if (!overrideSlug) continue;
		for (const aaModel of aaModels) {
			// An override is an alias pin, never a host selector or an identity bypass.
			if (aaModel.slug !== overrideSlug) continue;
			const identityCompatibility = modelIdentityCompatibility(piIdentity, identityForAaModel(aaModel), { allowPinnedMovingAlias: true });
			if (!identityCompatibility.compatible) continue;
			const variantLevel = variantLevelFromAaModel(aaModel);
			if ((candidateThinkingLevel === "off") !== (variantLevel === "off")) continue;
			const hostEvidence = aaHostEvidence(provider, aaModel);
			if (!hostEvidence.compatible) continue;
			const movingAliasPin = Boolean(piIdentity.movingAlias);
			const matchScore = (movingAliasPin ? 0.78 : 0.98) + identityCompatibility.bonus + hostEvidence.bonus;
			const candidate: AaMatchResult = {
				aaModel,
				matchScore,
				variantLevel,
				evidenceScope: hostEvidence.scope,
				hostVerified: hostEvidence.scope === "host-verified",
				overrideApplied: true,
				movingAliasPin,
			};
			if (betterMatch(candidate, bestOverride)) bestOverride = candidate;
		}
	}
	if (bestOverride && bestOverride.matchScore >= config.strategy.minAaMatch) return remember(bestOverride);

	const piAliases = aliasSetForPiModel(piModel);
	let best: AaMatchResult | undefined;
	for (const aaModel of aaModels) {
		const identityCompatibility = modelIdentityCompatibility(piIdentity, identityForAaModel(aaModel));
		if (!identityCompatibility.compatible) continue;
		const hostEvidence = aaHostEvidence(provider, aaModel);
		if (!hostEvidence.compatible) continue;
		const aaAliases = aliasSetForAaModel(aaModel);
		let baseScore = 0;
		for (const piAlias of piAliases) {
			for (const aaAlias of aaAliases) baseScore = Math.max(baseScore, aliasSimilarity(piAlias, aaAlias));
		}
		if (baseScore <= 0) continue;
		const variantLevel = variantLevelFromAaModel(aaModel);
		if ((candidateThinkingLevel === "off") !== (variantLevel === "off")) continue;
		const hostApiSimilarity = aaModel.hostApiId
			? Math.max(...piAliases.map((piAlias) => aliasSimilarity(piAlias, normalizeKey(aaModel.hostApiId ?? ""))))
			: 0;
		const candidate: AaMatchResult = {
			aaModel,
			matchScore: baseScore + identityCompatibility.bonus + variantCompatibilityScore(candidateThinkingLevel, variantLevel) + hostEvidence.bonus + hostApiSimilarity * 0.06,
			variantLevel,
			evidenceScope: hostEvidence.scope,
			hostVerified: hostEvidence.scope === "host-verified",
			overrideApplied: false,
			movingAliasPin: false,
		};
		if (betterMatch(candidate, best)) best = candidate;
	}

	return remember(best && best.matchScore >= config.strategy.minAaMatch ? best : undefined);
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
	const metric = candidate.latencyBasis === "ttft" ? `ttft_${promptLengthType}` : `latency_${promptLengthType}`;
	return normalizeByRange(candidate.latency, datasetStats.metrics[metric], true);
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
	// Trust/degraded-evidence facts outrank optional performance badges in the compact rationale.
	if (candidate.aaEvidenceScope === "model-only") bits.push("AA model-only evidence");
	if (candidate.aaOverrideApplied) bits.push(candidate.aaMovingAliasPin ? "explicit moving-alias pin" : "explicit AA alias pin");
	if (candidate.latencyBasis === "ttft") bits.push("TTFT fallback pool");
	if (profile.priorities.costSensitivity >= 0.45 && candidate.economicScore >= 0.7) bits.push("good cost");
	if (profile.priorities.speedSensitivity >= 0.45 && candidate.speedScore >= 0.7) bits.push("fast");
	if (profile.priorities.contextNeed >= 0.45 && candidate.contextScore >= 0.7) bits.push("long-context");
	if (profile.matchedSignals.includes("coding") && /(codex|code|coder|grok-code|kimi-coding|deepseek)/i.test(`${candidate.piModel.id} ${candidate.piModel.name}`)) {
		bits.push("coding-specialized");
	}
	if (candidate.aaHostVerified && candidate.aaModel.hostLabel) bits.push(`AA host ${candidate.aaModel.hostLabel}`);
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

export function objectiveScore(candidate: Candidate, objective: RouteObjective, profile?: PromptProfile): number {
	if (objective === "quality") return candidate.benchmarkScore;
	if (objective === "cheapest") return candidate.economicScore;
	if (objective === "fastest") return candidate.latencyScore * 0.65 + candidate.speedScore * 0.35;
	if (profile && isSimpleEfficiencyTask(profile)) return simpleTaskEfficiencyScore(candidate, profile);
	return candidate.composite;
}

export function shouldPreferCurrentCandidate(
	winner: Candidate,
	current: Candidate,
	objective: RouteObjective,
	preferCurrentWithin: number,
	profile?: PromptProfile,
): boolean {
	return objectiveScore(winner, objective, profile) - objectiveScore(current, objective, profile) <= preferCurrentWithin;
}

function compareCandidateIdentity(a: Candidate, b: Candidate): number {
	return String(a.piModel.provider).localeCompare(String(b.piModel.provider))
		|| a.piModel.id.localeCompare(b.piModel.id)
		|| thinkingLevelIndex(a.candidateThinkingLevel) - thinkingLevelIndex(b.candidateThinkingLevel)
		|| a.aaModel.slug.localeCompare(b.aaModel.slug)
		|| (a.aaModel.hostSlug ?? a.aaModel.hostLabel ?? "").localeCompare(b.aaModel.hostSlug ?? b.aaModel.hostLabel ?? "");
}

export function rankCandidatesForObjective(candidates: Candidate[], objective: RouteObjective, profile?: PromptProfile): Candidate[] {
	const ranked = [...candidates];
	const simpleEfficiency = profile && isSimpleEfficiencyTask(profile);
	if (simpleEfficiency && objective === "balanced") {
		ranked.sort((a, b) => compareNumberDesc(simpleTaskEfficiencyScore(a, profile), simpleTaskEfficiencyScore(b, profile)) || compareNumberDesc(a.economicScore, b.economicScore) || compareNumberDesc(a.benchmarkScore, b.benchmarkScore) || compareCandidateIdentity(a, b));
		return ranked;
	}
	switch (objective) {
		case "quality":
			ranked.sort((a, b) => compareNumberDesc(a.benchmarkScore, b.benchmarkScore) || compareNumberDesc(a.composite, b.composite) || compareNumberDesc(a.contextScore, b.contextScore) || compareCandidateIdentity(a, b));
			break;
		case "cheapest":
			ranked.sort((a, b) => compareNumberAsc(a.price, b.price) || compareNumberDesc(a.economicScore, b.economicScore) || compareNumberDesc(a.benchmarkScore, b.benchmarkScore) || compareNumberDesc(a.latencyScore, b.latencyScore) || compareCandidateIdentity(a, b));
			break;
		case "fastest":
			ranked.sort((a, b) => compareNumberDesc(a.latencyScore * 0.65 + a.speedScore * 0.35, b.latencyScore * 0.65 + b.speedScore * 0.35) || compareNumberDesc(a.benchmarkScore, b.benchmarkScore) || compareNumberDesc(a.economicScore, b.economicScore) || compareCandidateIdentity(a, b));
			break;
		case "balanced":
		default:
			ranked.sort((a, b) => compareNumberDesc(a.composite, b.composite) || compareNumberDesc(a.benchmarkScore, b.benchmarkScore) || compareCandidateIdentity(a, b));
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

function constrainCandidatesForProfile(candidates: Candidate[], profile: PromptProfile, objective: RouteObjective): Candidate[] {
	if (candidates.length === 0) return candidates;
	const minimumThinking = minimumThinkingForProfile(profile, objective);
	const maximumThinking = maximumThinkingForProfile(profile, objective);
	let constrained = candidates.filter((candidate) => {
		if (!thinkingAtLeast(candidate.candidateThinkingLevel, minimumThinking)) return false;
		if (maximumThinking && !thinkingAtMost(candidate.candidateThinkingLevel, maximumThinking)) return false;
		return true;
	});
	if (constrained.length === 0) return [];

	const contextRequirement = contextTokenRequirementForProfile(profile);
	if (contextRequirement) {
		constrained = constrained.filter((candidate) => candidate.contextWindow >= contextRequirement);
		if (constrained.length === 0) return [];
	}

	// Family specialization and efficiency are soft scoring signals. Hard filtering here would
	// contradict explicit objectives (especially quality) and can delete the strongest measured fit.
	return constrained;
}

function dominatesCandidate(a: Candidate, b: Candidate): boolean {
	const epsilon = 1e-9;
	const aValues = [a.benchmarkScore, a.economicScore, a.speedScore, a.latencyScore, a.contextScore];
	const bValues = [b.benchmarkScore, b.economicScore, b.speedScore, b.latencyScore, b.contextScore];
	const noWorse = aValues.every((value, index) => value + epsilon >= (bValues[index] ?? 0));
	const better = aValues.some((value, index) => value > (bValues[index] ?? 0) + epsilon);
	return noWorse && better;
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
	let evidencePenalty = 0;
	if (candidate.aaEvidenceScope === "model-only") {
		evidencePenalty += 0.1;
		notes.push("model-only-host-unverified");
	}
	if (candidate.aaMovingAliasPin) {
		evidencePenalty += 0.06;
		notes.push("moving-alias-pin");
	}
	const overall = clamp(match * 0.48 + constraints * 0.34 + cost * 0.18 - evidencePenalty, 0, 1);
	if (overall < config.strategy.minRouteConfidence) notes.push("below-route-confidence-threshold");
	return { match, constraints, cost, overall, notes };
}

export interface RouteSelection {
	best: Candidate;
	topCandidates: Candidate[];
	recommendationBasis: RecommendationBasis;
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
): RouteSelection | undefined {
	const routingAaModels = normalizeAaModelsForRouting(aaModels);
	const candidates: Candidate[] = [];
	const visionRequired = requireVision || profile.priorities.visionNeed > 0 || profile.matchedSignals.includes("vision");
	for (const piModel of availableModels) {
		if (visionRequired && !piModel.input.includes("image")) continue;
		for (const candidateThinkingLevel of getSupportedThinkingLevelsForModel(piModel)) {
			const aaMatch = pickAaMatchForPiModel(piModel, routingAaModels, candidateThinkingLevel, config);
			if (!aaMatch) continue;
			const aaModel = aaMatch.aaModel;
			const benchmark = benchmarkScore(aaModel, profile, datasetStats);
			const hostVerified = aaMatch.evidenceScope === "host-verified";
			const actualPrice = estimateCandidatePrice(piModel, aaModel, candidateThinkingLevel, profile, hostVerified);
			const actualContext = Number(piModel.contextWindow || (hostVerified ? aaModel.contextWindowTokens : 0) || 0);
			const speed = hostVerified ? getAaPromptMetric(aaModel, profile.promptLengthType, "speed") : undefined;
			const latency = hostVerified ? getAaPromptMetric(aaModel, profile.promptLengthType, "latency") : undefined;
			const ttft = hostVerified ? getAaTtftMetric(aaModel, profile.promptLengthType) : undefined;
			candidates.push({
				piModel,
				candidateThinkingLevel,
				requestedThinkingLevel: profile.targetThinkingLevel,
				aaModel,
				aaMatchScore: aaMatch.matchScore,
				aaVariantLevel: aaMatch.variantLevel,
				aaEvidenceScope: aaMatch.evidenceScope,
				benchmarkScore: benchmark,
				price: actualPrice,
				tokenBurn: hostVerified ? aaModel.tokenBurn : undefined,
				speed,
				latency,
				ttft,
				aaHostVerified: aaMatch.hostVerified,
				aaOverrideApplied: aaMatch.overrideApplied,
				aaMovingAliasPin: aaMatch.movingAliasPin,
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

	const useEndToEndLatency = candidates.some((candidate) => isFiniteNumber(candidate.latency));
	for (const candidate of candidates) {
		candidate.latencyBasis = useEndToEndLatency ? "end-to-end" : "ttft";
		if (!useEndToEndLatency) candidate.latency = candidate.ttft;
	}
	const priceValues = candidates.map((candidate) => candidate.price).filter(isFiniteNumber);
	const tokenBurnValues = candidates.map((candidate) => candidate.tokenBurn ?? Number.NaN).filter(isFiniteNumber);
	const contextValues = candidates.map((candidate) => candidate.contextWindow).filter(isFiniteNumber);
	const hostPerformanceStats = buildStats(candidates
		.filter((candidate) => candidate.aaEvidenceScope === "host-verified")
		.map((candidate) => candidate.aaModel));
	for (const candidate of candidates) {
		candidate.economicScore = candidateEconomicScore(candidate, priceValues, tokenBurnValues);
		candidate.speedScore = candidateSpeedScore(candidate, hostPerformanceStats, profile.promptLengthType);
		candidate.latencyScore = candidateLatencyScore(candidate, hostPerformanceStats, profile.promptLengthType);
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
	const eligible = viable.length > 0 ? viable : constrainedCandidates;
	if (config.strategy.objective === "cheapest" && !eligible.some((candidate) => Number.isFinite(candidate.price))) {
		return undefined;
	}
	if (config.strategy.objective === "fastest" && !eligible.some((candidate) =>
		candidate.aaEvidenceScope === "host-verified" && (isFiniteNumber(candidate.speed) || isFiniteNumber(candidate.latency)))) {
		return undefined;
	}
	const objectiveRanked = rankCandidatesForObjective(eligible, config.strategy.objective, profile);
	objectiveRanked.forEach((candidate, index) => { candidate.objectiveRank = index + 1; });
	const eligibleSet = new Set(eligible);
	const objectiveRankedBelowFloor = rankCandidatesForObjective(
		constrainedCandidates.filter((candidate) => !eligibleSet.has(candidate)),
		config.strategy.objective,
		profile,
	);
	objectiveRankedBelowFloor.forEach((candidate, index) => { candidate.objectiveRank = objectiveRanked.length + index + 1; });
	const frontier = paretoFrontierCandidates(eligible);
	const ranked = rankCandidatesForObjective(frontier.length > 0 ? frontier : eligible, config.strategy.objective, profile);
	let best = ranked[0];
	let recommendationBasis: RecommendationBasis = "objective-ranking";

	const currentKey = currentRouteKey(currentModel, currentThinkingLevel);
	const currentCandidate = currentKey
		? constrainedCandidates.find((candidate) => currentRouteKey(candidate.piModel, candidate.candidateThinkingLevel) === currentKey)
		: undefined;
	const hysteresisCandidate = currentKey
		? eligible.find((candidate) => currentRouteKey(candidate.piModel, candidate.candidateThinkingLevel) === currentKey)
		: undefined;
	if (hysteresisCandidate && shouldPreferCurrentCandidate(best, hysteresisCandidate, config.strategy.objective, config.strategy.preferCurrentWithin, profile)) {
		if (currentRouteKey(best.piModel, best.candidateThinkingLevel) !== currentRouteKey(hysteresisCandidate.piModel, hysteresisCandidate.candidateThinkingLevel)) {
			recommendationBasis = "hysteresis";
		}
		best = hysteresisCandidate;
	}
	if (best.confidence && best.confidence.overall < routeConfidenceFloor(config)) {
		if (!currentCandidate) return undefined;
		best = currentCandidate;
		recommendationBasis = "confidence-fallback";
	}

	const bestKey = currentRouteKey(best.piModel, best.candidateThinkingLevel);
	const topCandidates = [
		best,
		...ranked.filter((candidate) => currentRouteKey(candidate.piModel, candidate.candidateThinkingLevel) !== bestKey),
	].slice(0, 3);
	return {
		best,
		topCandidates,
		recommendationBasis,
	};
}

export function buildWinnerReasonLines(
	best: Candidate,
	profile: PromptProfile,
	providerScopeLabel: string,
	benchmarkSummary: string[],
): string[] {
	const metric = (available: boolean, score: number) => available ? (score * 100).toFixed(0) : "n/a";
	return [
		`Scope: ${providerScopeLabel}`,
		`Complexity: ${profile.complexityScore !== undefined ? `${Math.round(profile.complexityScore * 100)}%` : "n/a"} (${profile.routingTier ?? "n/a"}) via ${profile.classifierSource ?? "heuristic"}`,
		`Benchmarks: ${benchmarkSummary.join(", ") || "general fit"}`,
		`AA match: ${best.aaModel.name}${best.aaEvidenceScope === "host-verified" && best.aaModel.hostLabel ? ` via ${best.aaModel.hostLabel}` : ""}${best.aaEvidenceScope === "model-only" ? " (model-only evidence; host performance unavailable)" : ""}`,
		`Trade-off: fit ${(best.benchmarkScore * 100).toFixed(0)} · cost ${metric(Number.isFinite(best.price), best.economicScore)} · speed ${metric(Number.isFinite(best.speed), best.speedScore)} · latency ${metric(Number.isFinite(best.latency), best.latencyScore)} · ctx ${metric(best.contextWindow > 0, best.contextScore)}`,
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
	const recommendationLine = `Recommended ${best.piModel.id} @ ${best.candidateThinkingLevel} for a ${profile.routingTier ?? "routed"} prompt (${bestFit}% fit).`;
	if (!runnerUp) {
		return [recommendationLine, `No close alternative matched the current scope better.`];
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
			recommendationLine,
			`It beat ${runnerName} on task fit (${bestFit}% vs ${runnerFit}%) while staying competitive on the other trade-offs.`,
		];
	}
	if (objective === "quality" && qualityDelta < 0) {
		const reasons = positiveFactors.length > 0 ? positiveFactors.join(" + ") : "overall route score";
		return [
			recommendationLine,
			`Quality mode still kept it because it stayed close on fit (${bestFit}% vs ${runnerFit}% for ${runnerName}) and won on ${reasons}.`,
		];
	}
	const reasons = positiveFactors.length > 0 ? positiveFactors.join(" + ") : "overall route score";
	return [
		recommendationLine,
		`Its fit was similar to ${runnerName} (${bestFit}% vs ${runnerFit}%), so ${reasons} decided the route.`,
	];
}

function candidateRouteKey(candidate: Candidate): string {
	return `${candidate.piModel.provider}/${candidate.piModel.id}@${candidate.candidateThinkingLevel}`;
}

function buildAppliedRouteLine(
	recommended: Candidate,
	applied: Candidate,
	actualThinkingLevel: ThinkingLevel,
	origin: ApplicationOrigin,
): string {
	const appliedLabel = `${applied.piModel.id} @ ${actualThinkingLevel}`;
	const sameRoute = candidateRouteKey(recommended) === candidateRouteKey(applied)
		&& actualThinkingLevel === recommended.candidateThinkingLevel;
	const originLabel: Record<ApplicationOrigin, string> = {
		"auto-accept": "automatic acceptance",
		"user-recommended": "user confirmation",
		"user-current": "explicit keep-current choice",
		"user-alternative": "user alternative choice",
	};
	return sameRoute
		? `Applied the recommended route ${appliedLabel} via ${originLabel[origin]}.`
		: `Applied ${appliedLabel} via ${originLabel[origin]}; the recommendation remained ${recommended.piModel.id} @ ${recommended.candidateThinkingLevel}.`;
}

export function buildDecisionSummary(params: {
	/** The deterministic kernel recommendation. */
	best: Candidate;
	/** The route actually applied; defaults to the recommendation for pre-confirmation summaries. */
	applied?: Candidate;
	topCandidates: Candidate[];
	profile: PromptProfile;
	providerScopeMode: ProviderScopeMode;
	providerScopeLabel: string;
	availableModelCount: number;
	availableRouteCount: number;
	dataSourceLabel: string;
	objectiveUsed: RouteObjective;
	recommendationBasis: RecommendationBasis;
	applicationOrigin?: ApplicationOrigin;
	changedModel: boolean;
	changedThinkingLevel: boolean;
	actualThinkingLevel: ThinkingLevel;
}): RouteDecisionSummary {
	const recommended = params.best;
	const applied = params.applied ?? recommended;
	const benchmarkSummary = buildBenchmarkSummary(params.profile.benchmarkWeights);
	const reasonLines = buildWinnerReasonLines(recommended, params.profile, params.providerScopeLabel, benchmarkSummary);
	const recommendationSummary = buildDecisionShortSummary(recommended, params.topCandidates, params.profile, params.objectiveUsed);
	const shortSummary = params.applicationOrigin
		? [...recommendationSummary, buildAppliedRouteLine(recommended, applied, params.actualThinkingLevel, params.applicationOrigin)]
		: recommendationSummary;
	const recommendedKey = candidateRouteKey(recommended);
	const appliedKey = `${applied.piModel.provider}/${applied.piModel.id}@${params.actualThinkingLevel}`;
	return {
		timestamp: Date.now(),
		changedModel: params.changedModel,
		changedThinkingLevel: params.changedThinkingLevel,
		provider: String(applied.piModel.provider),
		providerScopeMode: params.providerScopeMode,
		providerScopeLabel: params.providerScopeLabel,
		availableModelCount: params.availableModelCount,
		availableRouteCount: params.availableRouteCount,
		dataSourceLabel: params.dataSourceLabel,
		objectiveUsed: params.objectiveUsed,
		recommendationBasis: params.recommendationBasis,
		applicationOrigin: params.applicationOrigin,
		recommendedRoute: {
			provider: String(recommended.piModel.provider),
			modelId: recommended.piModel.id,
			modelName: recommended.piModel.name,
			thinkingLevel: recommended.candidateThinkingLevel,
		},
		modelId: applied.piModel.id,
		modelName: applied.piModel.name,
		requestedThinkingLevel: params.profile.targetThinkingLevel,
		thinkingLevel: params.actualThinkingLevel,
		aaSlug: applied.aaModel.slug,
		aaName: applied.aaModel.name,
		aaHost: applied.aaEvidenceScope === "host-verified" ? applied.aaModel.hostLabel : undefined,
		benchmarkSummary,
		profileSummary: params.profile.summary,
		complexityScore: params.profile.complexityScore,
		routingTier: params.profile.routingTier,
		classifierSource: params.profile.classifierSource,
		confidence: applied.confidence,
		reasonLines,
		shortSummary,
		topCandidates: params.topCandidates.map((candidate, index) => ({
			rank: index + 1,
			objectiveRank: candidate.objectiveRank,
			recommended: candidateRouteKey(candidate) === recommendedKey,
			applied: params.applicationOrigin !== undefined && candidateRouteKey(candidate) === appliedKey,
			provider: String(candidate.piModel.provider),
			modelId: candidate.piModel.id,
			modelName: candidate.piModel.name,
			thinkingLevel: candidate.candidateThinkingLevel,
			aaName: candidate.aaModel.name,
			aaHost: candidate.aaEvidenceScope === "host-verified" ? candidate.aaModel.hostLabel : undefined,
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

function isBoundedStringArray(value: unknown, maxItems = 32): value is string[] {
	return Array.isArray(value)
		&& value.length <= maxItems
		&& value.every((item) => isBoundedExternalString(item));
}

export function isUsableRouteDecisionSummary(value: unknown): value is RouteDecisionSummary {
	if (!isRecord(value)) return false;
	if (!isFiniteNumber(value.timestamp) || typeof value.changedModel !== "boolean" || typeof value.changedThinkingLevel !== "boolean") return false;
	for (const field of ["provider", "providerScopeLabel", "dataSourceLabel", "modelId", "modelName", "aaSlug", "aaName", "profileSummary"] as const) {
		if (!isBoundedExternalString(value[field], true)) return false;
	}
	if (value.aaHost !== undefined && !isBoundedExternalString(value.aaHost)) return false;
	if (value.providerScopeMode !== "configured-provider") return false;
	if (!["balanced", "quality", "cheapest", "fastest"].includes(String(value.objectiveUsed))) return false;
	if (value.recommendationBasis !== undefined
		&& !["objective-ranking", "hysteresis", "confidence-fallback"].includes(String(value.recommendationBasis))) return false;
	if (value.applicationOrigin !== undefined
		&& !["auto-accept", "user-recommended", "user-current", "user-alternative"].includes(String(value.applicationOrigin))) return false;
	if (value.recommendedRoute !== undefined) {
		if (!isRecord(value.recommendedRoute)) return false;
		for (const field of ["provider", "modelId", "modelName"] as const) {
			if (!isBoundedExternalString(value.recommendedRoute[field], true)) return false;
		}
		if (!ALL_THINKING_LEVELS.includes(value.recommendedRoute.thinkingLevel as ThinkingLevel)) return false;
	}
	if ((value.recommendationBasis !== undefined || value.applicationOrigin !== undefined) && value.recommendedRoute === undefined) return false;
	if (!ALL_THINKING_LEVELS.includes(value.requestedThinkingLevel as ThinkingLevel) || !ALL_THINKING_LEVELS.includes(value.thinkingLevel as ThinkingLevel)) return false;
	if (!isFiniteNumber(value.availableModelCount) || !isFiniteNumber(value.availableRouteCount)) return false;
	if (!isBoundedStringArray(value.benchmarkSummary) || !isBoundedStringArray(value.reasonLines) || !isBoundedStringArray(value.shortSummary)) return false;
	if (!Array.isArray(value.topCandidates) || value.topCandidates.length > 10) return false;
	return value.topCandidates.every((candidate) => isRecord(candidate)
		&& isFiniteNumber(candidate.rank)
		&& (candidate.objectiveRank === undefined || (isFiniteNumber(candidate.objectiveRank) && candidate.objectiveRank >= 1))
		&& (candidate.recommended === undefined || typeof candidate.recommended === "boolean")
		&& (candidate.applied === undefined || typeof candidate.applied === "boolean")
		&& isBoundedExternalString(candidate.provider, true)
		&& isBoundedExternalString(candidate.modelId, true)
		&& ALL_THINKING_LEVELS.includes(candidate.thinkingLevel as ThinkingLevel));
}

export function summarizeDecision(decision: RouteDecisionSummary): string {
	return `${decision.provider}/${decision.modelId} @ ${decision.thinkingLevel} • ${decision.benchmarkSummary.join(", ")}`;
}

