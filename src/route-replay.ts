import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { writeTextFileAtomically, type AtomicWriteOperations } from "./atomic-write.ts";
import { assertSafeJsonStructure, readBoundedJsonFileIfExists } from "./safe-json-file.ts";
import {
	DEFAULT_CONFIG,
	ROUTER_EXTENSION_DIR,
	chooseRoute,
	countAvailableRoutes,
	populateRouteSelectionObservability,
	withIsolatedAaMatchCache,
	isUsableAaDataset,
	type AaDataset,
	type AaModel,
	type Candidate,
	type DatasetStats,
	type PromptSpeedProfile,
	type PromptProfile,
	type RecommendationBasis,
	type RouteObjective,
	type RouterConfig,
	type ThinkingLevel,
} from "./router-core.ts";
import {
	DECISION_TRACE_MAX_STRING_LENGTH,
	isDecisionTraceV1,
	type DecisionTraceV1,
} from "./decision-trace.ts";

export const ROUTE_REPLAY_SCHEMA_VERSION = 1 as const;
export const ROUTE_REPLAY_KERNEL_CONTRACT = "starrouter-route-kernel-v1" as const;
export const ROUTE_REPLAY_MAX_BYTES = 16 * 1024 * 1024;
export const ROUTE_REPLAY_MAX_MODELS = 512;
export const ROUTE_REPLAY_MAX_AA_MODELS = 5_000;
export const ROUTE_REPLAY_MAX_PROFILES_PER_AA_MODEL = 12;
export const ROUTE_REPLAY_MAX_ROUTE_VARIANTS = 2_048;
export const ROUTE_REPLAY_MAX_MATCH_WORK = 2_000_000;
export const ROUTE_REPLAY_DIR = join(ROUTER_EXTENSION_DIR, "replays");

export interface ReplayPiModelV1 {
	api: string;
	provider: string;
	id: string;
	name: string;
	reasoning: boolean;
	input: string[];
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	contextWindow: number;
	thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
}

export interface ReplayRouteConfigV1 {
	strategy: {
		objective: RouteObjective;
		qualityFloor: number;
		preferCurrentWithin: number;
		minAaMatch: number;
		minRouteConfidence: number;
		routingProvider?: string;
	};
	modelOverrides: Record<string, string>;
}

export interface RouteReplayInputV1 {
	models: ReplayPiModelV1[];
	currentModel?: ReplayPiModelV1;
	currentThinkingLevel?: ThinkingLevel;
	dataset: AaDataset;
	datasetStats: DatasetStats;
	config: ReplayRouteConfigV1;
}

export interface RouteReplayBundleV1 {
	schemaVersion: typeof ROUTE_REPLAY_SCHEMA_VERSION;
	kernelContract: typeof ROUTE_REPLAY_KERNEL_CONTRACT;
	createdAt: number;
	trace: DecisionTraceV1;
	input: RouteReplayInputV1;
	inputSha256: string;
}

export interface RouteReplayCaptureV1 {
	trace: DecisionTraceV1;
	/** In-memory registry references; converted to bounded plain snapshots only on explicit export. */
	models: Model<Api>[];
	currentModel?: Model<Api>;
	currentThinkingLevel?: ThinkingLevel;
	dataset: AaDataset;
	datasetStats: DatasetStats;
	config: ReplayRouteConfigV1;
}

export interface BuildRouteReplayCaptureV1Input {
	trace: DecisionTraceV1;
	models: Model<Api>[];
	currentModel?: Model<Api>;
	currentThinkingLevel?: ThinkingLevel;
	dataset: AaDataset;
	datasetStats: DatasetStats;
	config: RouterConfig;
}

export interface RouteReplayCandidateResultV1 {
	rank: number;
	objectiveRank?: number;
	provider: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
	benchmarkScore: number;
	benchmarkCoverage: number;
	objectiveScore: number;
	composite: number;
}

export interface RouteReplayResultV1 {
	matches: boolean;
	deltas: string[];
	expected: {
		provider: string;
		modelId: string;
		thinkingLevel: ThinkingLevel;
		recommendationBasis: RecommendationBasis;
	};
	actual?: {
		provider: string;
		modelId: string;
		thinkingLevel: ThinkingLevel;
		recommendationBasis: RecommendationBasis;
		candidates: RouteReplayCandidateResultV1[];
	};
}

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const OBJECTIVES = new Set<RouteObjective>(["balanced", "quality", "cheapest", "fastest"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function finiteSnapshotNumber(value: unknown, label: string, fallback = 0): number {
	if (value === undefined || value === null) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is not finite`);
	return value;
}

function snapshotString(value: unknown, label: string, required = true): string {
	const text = String(value ?? "");
	if ((required && text.length === 0)
		|| text.length > DECISION_TRACE_MAX_STRING_LENGTH
		|| /[\u0000-\u001f\u007f-\u009f]/.test(text)) {
		throw new Error(`${label} is not a bounded replay string`);
	}
	return text;
}

function snapshotReplayModelV1(model: Model<Api>): ReplayPiModelV1 {
	const thinkingLevelMap: Partial<Record<ThinkingLevel, string | null>> = {};
	for (const level of THINKING_LEVELS) {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === undefined) continue;
		thinkingLevelMap[level] = mapped === null ? null : snapshotString(mapped, `thinkingLevelMap.${level}`, false);
	}
	return {
		api: snapshotString(model.api || "openai-completions", "model.api"),
		provider: snapshotString(model.provider, "model.provider"),
		id: snapshotString(model.id, "model.id"),
		name: snapshotString(model.name, "model.name"),
		reasoning: Boolean(model.reasoning),
		input: (model.input ?? []).map((value, index) => snapshotString(value, `model.input[${index}]`)),
		cost: {
			input: finiteSnapshotNumber(model.cost?.input, "model.cost.input"),
			output: finiteSnapshotNumber(model.cost?.output, "model.cost.output"),
			cacheRead: finiteSnapshotNumber(model.cost?.cacheRead, "model.cost.cacheRead"),
			cacheWrite: finiteSnapshotNumber(model.cost?.cacheWrite, "model.cost.cacheWrite"),
		},
		contextWindow: finiteSnapshotNumber(model.contextWindow, "model.contextWindow"),
		thinkingLevelMap: Object.keys(thinkingLevelMap).length > 0 ? thinkingLevelMap : undefined,
	};
}

function cloneDatasetStats(stats: DatasetStats): DatasetStats {
	return {
		metrics: Object.fromEntries(Object.entries(stats.metrics).map(([key, range]) => [key, { min: range.min, max: range.max }])),
	};
}

function snapshotPromptSpeedProfile(profile: PromptSpeedProfile): PromptSpeedProfile {
	return {
		promptLengthType: profile.promptLengthType,
		medianOutputSpeed: profile.medianOutputSpeed,
		medianTimeToFirstAnswerToken: profile.medianTimeToFirstAnswerToken,
		medianEndToEndResponseTime: profile.medianEndToEndResponseTime,
	};
}

function snapshotAaModel(model: AaModel): AaModel {
	if (model.performanceByPromptLength.length > ROUTE_REPLAY_MAX_PROFILES_PER_AA_MODEL) {
		throw new Error(`Replay AA row exceeds ${ROUTE_REPLAY_MAX_PROFILES_PER_AA_MODEL} prompt profiles`);
	}
	return {
		sourceMode: model.sourceMode,
		slug: model.slug,
		name: model.name,
		shortName: model.shortName,
		creatorName: model.creatorName,
		modelUrl: model.modelUrl,
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
		performanceByPromptLength: model.performanceByPromptLength.map(snapshotPromptSpeedProfile),
		fallbackTimeToFirstAnswerToken: model.fallbackTimeToFirstAnswerToken,
		fallbackEndToEndResponseTime: model.fallbackEndToEndResponseTime,
		tokenBurn: model.tokenBurn,
	};
}

function snapshotAaDataset(dataset: AaDataset): AaDataset {
	if (dataset.models.length === 0 || dataset.models.length > ROUTE_REPLAY_MAX_AA_MODELS) {
		throw new Error(`Replay AA dataset must contain 1-${ROUTE_REPLAY_MAX_AA_MODELS} rows`);
	}
	return {
		fetchedAt: dataset.fetchedAt,
		sourceKey: dataset.sourceKey,
		sourceLabel: dataset.sourceLabel,
		models: dataset.models.map(snapshotAaModel),
		provenance: dataset.provenance,
	};
}

function snapshotRouteConfigV1(config: RouterConfig): ReplayRouteConfigV1 {
	return {
		strategy: { ...config.strategy },
		modelOverrides: { ...config.modelOverrides },
	};
}

/**
 * Retains a shallow, in-memory view of the selected registry pool and already resident AA dataset.
 * Expensive plain-model snapshots and dataset serialization happen only after explicit export.
 */
export function captureRouteReplayV1(input: BuildRouteReplayCaptureV1Input): RouteReplayCaptureV1 {
	if (input.models.length === 0 || input.models.length > ROUTE_REPLAY_MAX_MODELS) {
		throw new Error(`Replay model pool must contain 1-${ROUTE_REPLAY_MAX_MODELS} models`);
	}
	return {
		trace: input.trace,
		models: [...input.models],
		currentModel: input.currentModel,
		currentThinkingLevel: input.currentThinkingLevel,
		dataset: input.dataset,
		datasetStats: cloneDatasetStats(input.datasetStats),
		config: snapshotRouteConfigV1(input.config),
	};
}

function hashReplayInput(input: RouteReplayInputV1, trace: DecisionTraceV1): string {
	return createHash("sha256").update(JSON.stringify({
		input,
		profile: trace.profile,
		prompt: trace.prompt,
	})).digest("hex");
}

/** Materializes and validates a portable route-kernel replay bundle. No raw prompt is accepted. */
export function buildRouteReplayBundleV1(capture: RouteReplayCaptureV1, now = Date.now()): RouteReplayBundleV1 {
	const input: RouteReplayInputV1 = {
		models: capture.models.map(snapshotReplayModelV1),
		currentModel: capture.currentModel ? snapshotReplayModelV1(capture.currentModel) : undefined,
		currentThinkingLevel: capture.currentThinkingLevel,
		dataset: snapshotAaDataset(capture.dataset),
		datasetStats: cloneDatasetStats(capture.datasetStats),
		config: {
			strategy: { ...capture.config.strategy },
			modelOverrides: { ...capture.config.modelOverrides },
		},
	};
	const bundle: RouteReplayBundleV1 = {
		schemaVersion: ROUTE_REPLAY_SCHEMA_VERSION,
		kernelContract: ROUTE_REPLAY_KERNEL_CONTRACT,
		createdAt: now,
		trace: structuredClone(capture.trace) as DecisionTraceV1,
		input,
		inputSha256: hashReplayInput(input, capture.trace),
	};
	if (!isRouteReplayBundleV1(bundle)) throw new Error("Route replay bundle failed its V1 contract");
	return bundle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDenseArray(value: unknown): value is unknown[] {
	if (!Array.isArray(value)) return false;
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
	}
	return true;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const set = new Set(allowed);
	return Object.keys(value).every((key) => set.has(key));
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isBoundedString(value: unknown, required = false): value is string {
	return typeof value === "string"
		&& value.length <= DECISION_TRACE_MAX_STRING_LENGTH
		&& (!required || value.length > 0)
		&& !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function isReplayModelV1(value: unknown): value is ReplayPiModelV1 {
	if (!isRecord(value) || !hasOnlyKeys(value, ["api", "provider", "id", "name", "reasoning", "input", "cost", "contextWindow", "thinkingLevelMap"])) return false;
	for (const key of ["api", "provider", "id", "name"] as const) {
		if (!isBoundedString(value[key], true)) return false;
	}
	if (typeof value.reasoning !== "boolean" || !isFiniteNumber(value.contextWindow) || value.contextWindow < 0) return false;
	if (!isDenseArray(value.input) || value.input.length === 0 || value.input.length > 16 || !value.input.every((item) => isBoundedString(item, true))) return false;
	if (!isRecord(value.cost) || !hasOnlyKeys(value.cost, ["input", "output", "cacheRead", "cacheWrite"])) return false;
	if (![value.cost.input, value.cost.output, value.cost.cacheRead, value.cost.cacheWrite].every(isFiniteNumber)) return false;
	if (value.thinkingLevelMap !== undefined) {
		if (!isRecord(value.thinkingLevelMap) || Object.keys(value.thinkingLevelMap).length > THINKING_LEVELS.size) return false;
		for (const [level, mapped] of Object.entries(value.thinkingLevelMap)) {
			if (!THINKING_LEVELS.has(level as ThinkingLevel) || (mapped !== null && !isBoundedString(mapped))) return false;
		}
	}
	return true;
}

const REPLAY_AA_MODEL_KEYS = [
	"sourceMode", "slug", "name", "shortName", "creatorName", "modelUrl", "hostLabel", "hostSlug", "hostApiId",
	"intelligenceIndex", "agenticIndex", "codingIndex", "gdpvalNormalized", "tau2", "terminalbenchHard",
	"scicode", "livecodebench", "ifbench", "omniscience", "gpqa", "hle", "critpt", "lcr",
	"contextWindowTokens", "priceInputPer1M", "priceOutputPer1M", "priceBlendedPer1M", "cacheHitPricePer1M",
	"reasoningModel", "inputModalityImage", "performanceByPromptLength", "fallbackTimeToFirstAnswerToken",
	"fallbackEndToEndResponseTime", "tokenBurn",
] as const;
const REPLAY_AA_OPTIONAL_NUMBERS = [
	"intelligenceIndex", "agenticIndex", "codingIndex", "gdpvalNormalized", "tau2", "terminalbenchHard",
	"scicode", "livecodebench", "ifbench", "omniscience", "gpqa", "hle", "critpt", "lcr",
	"contextWindowTokens", "priceInputPer1M", "priceOutputPer1M", "priceBlendedPer1M", "cacheHitPricePer1M",
	"fallbackTimeToFirstAnswerToken", "fallbackEndToEndResponseTime", "tokenBurn",
] as const;
const REPLAY_PROMPT_LENGTHS = new Set(["medium", "medium_coding", "long", "vision_single_image", "100k"]);

function isReplaySpeedProfile(value: unknown): value is PromptSpeedProfile {
	if (!isRecord(value) || !hasOnlyKeys(value, ["promptLengthType", "medianOutputSpeed", "medianTimeToFirstAnswerToken", "medianEndToEndResponseTime"])) return false;
	if (!REPLAY_PROMPT_LENGTHS.has(String(value.promptLengthType))) return false;
	return [value.medianOutputSpeed, value.medianTimeToFirstAnswerToken, value.medianEndToEndResponseTime]
		.every((metric) => metric === undefined || isFiniteNumber(metric));
}

function isReplayAaModel(value: unknown): value is AaModel {
	if (!isRecord(value) || !hasOnlyKeys(value, REPLAY_AA_MODEL_KEYS)) return false;
	if (value.sourceMode !== "api" && value.sourceMode !== "page-scrape") return false;
	for (const field of ["slug", "name", "shortName"] as const) {
		if (!isBoundedString(value[field], true)) return false;
	}
	for (const field of ["creatorName", "modelUrl", "hostLabel", "hostSlug", "hostApiId"] as const) {
		if (value[field] !== undefined && !isBoundedString(value[field])) return false;
	}
	if (typeof value.reasoningModel !== "boolean" || typeof value.inputModalityImage !== "boolean") return false;
	for (const field of REPLAY_AA_OPTIONAL_NUMBERS) {
		if (value[field] !== undefined && !isFiniteNumber(value[field])) return false;
	}
	return isDenseArray(value.performanceByPromptLength)
		&& value.performanceByPromptLength.length <= ROUTE_REPLAY_MAX_PROFILES_PER_AA_MODEL
		&& value.performanceByPromptLength.every(isReplaySpeedProfile);
}

function isReplayAaDataset(value: unknown, capturedAt: number): value is AaDataset {
	if (!isRecord(value) || !hasOnlyKeys(value, ["fetchedAt", "sourceKey", "sourceLabel", "models", "provenance"])) return false;
	if (!isUsableAaDataset(value, undefined, capturedAt)) return false;
	if (value.provenance !== undefined && !["network", "fresh-cache", "stale-fallback"].includes(String(value.provenance))) return false;
	return isDenseArray(value.models)
		&& value.models.length <= ROUTE_REPLAY_MAX_AA_MODELS
		&& value.models.every(isReplayAaModel);
}

function isDatasetStats(value: unknown): value is DatasetStats {
	if (!isRecord(value) || !hasOnlyKeys(value, ["metrics"]) || !isRecord(value.metrics)) return false;
	const entries = Object.entries(value.metrics);
	if (entries.length > 256) return false;
	return entries.every(([key, range]) => isBoundedString(key, true)
		&& isRecord(range)
		&& hasOnlyKeys(range, ["min", "max"])
		&& isFiniteNumber(range.min)
		&& isFiniteNumber(range.max));
}

function isReplayConfigV1(value: unknown): value is ReplayRouteConfigV1 {
	if (!isRecord(value) || !hasOnlyKeys(value, ["strategy", "modelOverrides"])) return false;
	if (!isRecord(value.strategy) || !hasOnlyKeys(value.strategy, ["objective", "qualityFloor", "preferCurrentWithin", "minAaMatch", "minRouteConfidence", "routingProvider"])) return false;
	if (!OBJECTIVES.has(value.strategy.objective as RouteObjective)) return false;
	for (const key of ["qualityFloor", "preferCurrentWithin", "minAaMatch", "minRouteConfidence"] as const) {
		if (!isFiniteNumber(value.strategy[key])) return false;
	}
	if (value.strategy.routingProvider !== undefined && !isBoundedString(value.strategy.routingProvider)) return false;
	if (!isRecord(value.modelOverrides) || Object.keys(value.modelOverrides).length > 4_096) return false;
	return Object.entries(value.modelOverrides).every(([key, mapped]) => isBoundedString(key, true) && isBoundedString(mapped, true));
}

export function isRouteReplayBundleV1(value: unknown): value is RouteReplayBundleV1 {
	if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "kernelContract", "createdAt", "trace", "input", "inputSha256"])) return false;
	try {
		assertSafeJsonStructure(value);
	} catch {
		return false;
	}
	if (value.schemaVersion !== ROUTE_REPLAY_SCHEMA_VERSION || value.kernelContract !== ROUTE_REPLAY_KERNEL_CONTRACT) return false;
	if (!isFiniteNumber(value.createdAt) || value.createdAt < 0 || !isDecisionTraceV1(value.trace)) return false;
	if (!isRecord(value.input) || !hasOnlyKeys(value.input, ["models", "currentModel", "currentThinkingLevel", "dataset", "datasetStats", "config"])) return false;
	if (!isDenseArray(value.input.models) || value.input.models.length === 0 || value.input.models.length > ROUTE_REPLAY_MAX_MODELS) return false;
	if (!value.input.models.every(isReplayModelV1)) return false;
	if (value.input.currentModel !== undefined && !isReplayModelV1(value.input.currentModel)) return false;
	if (value.input.currentThinkingLevel !== undefined && !THINKING_LEVELS.has(value.input.currentThinkingLevel as ThinkingLevel)) return false;
	if (!isReplayAaDataset(value.input.dataset, value.createdAt) || !isDatasetStats(value.input.datasetStats) || !isReplayConfigV1(value.input.config)) return false;
	if (!isBoundedString(value.inputSha256, true) || !SHA256_PATTERN.test(value.inputSha256)) return false;
	if (hashReplayInput(value.input as unknown as RouteReplayInputV1, value.trace as unknown as DecisionTraceV1) !== value.inputSha256) return false;
	const trace = value.trace as unknown as DecisionTraceV1;
	if (trace.objective !== value.input.config.strategy.objective) return false;
	if (trace.scope.availableModelCount !== value.input.models.length) return false;
	const routeVariants = countAvailableRoutes((value.input.models as unknown as ReplayPiModelV1[]).map(replayModelToPiModel));
	if (trace.scope.availableRouteCount !== routeVariants || routeVariants > ROUTE_REPLAY_MAX_ROUTE_VARIANTS) return false;
	if (routeVariants * value.input.dataset.models.length > ROUTE_REPLAY_MAX_MATCH_WORK) return false;
	if (trace.data.sourceLabel !== value.input.dataset.sourceLabel || trace.data.fetchedAt !== value.input.dataset.fetchedAt) return false;
	return true;
}

function replayModelToPiModel(snapshot: ReplayPiModelV1): Model<Api> {
	return {
		api: snapshot.api,
		provider: snapshot.provider,
		id: snapshot.id,
		name: snapshot.name,
		reasoning: snapshot.reasoning,
		input: [...snapshot.input],
		cost: { ...snapshot.cost },
		contextWindow: snapshot.contextWindow,
		maxTokens: 16_384,
		thinkingLevelMap: snapshot.thinkingLevelMap ? { ...snapshot.thinkingLevelMap } : undefined,
	} as Model<Api>;
}

function profileFromTrace(trace: DecisionTraceV1): PromptProfile {
	return {
		summary: trace.profile.summary,
		matchedSignals: [...trace.profile.matchedSignals],
		analysisNotes: [...trace.profile.analysisNotes],
		benchmarkWeights: { ...trace.profile.benchmarkWeights },
		priorities: { ...trace.profile.priorities },
		targetThinkingLevel: trace.profile.targetThinkingLevel,
		promptLengthType: trace.profile.promptLengthType,
		complexityScore: trace.profile.complexityScore,
		routingTier: trace.profile.routingTier,
		uncertain: trace.profile.uncertain,
		classifierSource: trace.profile.classifierSource,
	};
}

function configFromReplay(input: ReplayRouteConfigV1): RouterConfig {
	return {
		...(structuredClone(DEFAULT_CONFIG) as RouterConfig),
		strategy: { ...input.strategy },
		modelOverrides: { ...input.modelOverrides },
	};
}

function routeKey(provider: string, modelId: string, thinkingLevel: ThinkingLevel): string {
	return `${provider}/${modelId}@${thinkingLevel}`;
}

function candidateResult(candidate: Candidate, rank: number): RouteReplayCandidateResultV1 {
	if (!candidate.benchmarkAttribution || candidate.objectiveScore === undefined) {
		throw new Error(`Replayed candidate ${candidate.piModel.id} is missing observability fields`);
	}
	return {
		rank,
		objectiveRank: candidate.objectiveRank,
		provider: String(candidate.piModel.provider),
		modelId: candidate.piModel.id,
		thinkingLevel: candidate.candidateThinkingLevel,
		benchmarkScore: candidate.benchmarkScore,
		benchmarkCoverage: candidate.benchmarkAttribution.coverage,
		objectiveScore: candidate.objectiveScore,
		composite: candidate.composite,
	};
}

function compareNumber(deltas: string[], label: string, expected: number, actual: number, tolerance = 1e-9): void {
	if (Math.abs(expected - actual) > tolerance) deltas.push(`${label}: expected ${expected}, actual ${actual}`);
}

/** Re-runs only the deterministic route kernel. Prompt profiling is intentionally outside V1 replay. */
export function replayRouteBundleV1(bundle: RouteReplayBundleV1): RouteReplayResultV1 {
	if (!isRouteReplayBundleV1(bundle)) throw new Error("Invalid route replay bundle");
	const models = bundle.input.models.map(replayModelToPiModel);
	const currentModel = bundle.input.currentModel ? replayModelToPiModel(bundle.input.currentModel) : undefined;
	const replayStats = cloneDatasetStats(bundle.input.datasetStats);
	const replayProfile = profileFromTrace(bundle.trace);
	const selection = withIsolatedAaMatchCache(() => chooseRoute(
		models,
		bundle.input.dataset.models,
		replayStats,
		replayProfile,
		configFromReplay(bundle.input.config),
		currentModel,
		bundle.input.currentThinkingLevel,
		bundle.trace.prompt.hasImages,
	));
	if (selection) {
		populateRouteSelectionObservability(selection, replayProfile, replayStats, bundle.input.config.strategy.objective);
	}
	const expected = {
		provider: bundle.trace.recommendation.provider,
		modelId: bundle.trace.recommendation.modelId,
		thinkingLevel: bundle.trace.recommendation.thinkingLevel,
		recommendationBasis: bundle.trace.recommendation.basis,
	};
	if (!selection) {
		return { matches: false, deltas: ["expected a recommendation, replay abstained"], expected };
	}
	const actualCandidates = selection.topCandidates.map(candidateResult);
	const actual = {
		provider: String(selection.best.piModel.provider),
		modelId: selection.best.piModel.id,
		thinkingLevel: selection.best.candidateThinkingLevel,
		recommendationBasis: selection.recommendationBasis,
		candidates: actualCandidates,
	};
	const deltas: string[] = [];
	if (routeKey(expected.provider, expected.modelId, expected.thinkingLevel) !== routeKey(actual.provider, actual.modelId, actual.thinkingLevel)) {
		deltas.push(`recommendation: expected ${routeKey(expected.provider, expected.modelId, expected.thinkingLevel)}, actual ${routeKey(actual.provider, actual.modelId, actual.thinkingLevel)}`);
	}
	if (expected.recommendationBasis !== actual.recommendationBasis) {
		deltas.push(`recommendation basis: expected ${expected.recommendationBasis}, actual ${actual.recommendationBasis}`);
	}
	if (bundle.trace.candidates.length !== actualCandidates.length) {
		deltas.push(`top candidate count: expected ${bundle.trace.candidates.length}, actual ${actualCandidates.length}`);
	}
	for (let index = 0; index < Math.min(bundle.trace.candidates.length, actualCandidates.length); index += 1) {
		const expectedCandidate = bundle.trace.candidates[index]!;
		const actualCandidate = actualCandidates[index]!;
		const prefix = `candidate ${index + 1}`;
		if (routeKey(expectedCandidate.provider, expectedCandidate.modelId, expectedCandidate.thinkingLevel)
			!== routeKey(actualCandidate.provider, actualCandidate.modelId, actualCandidate.thinkingLevel)) {
			deltas.push(`${prefix} route: expected ${routeKey(expectedCandidate.provider, expectedCandidate.modelId, expectedCandidate.thinkingLevel)}, actual ${routeKey(actualCandidate.provider, actualCandidate.modelId, actualCandidate.thinkingLevel)}`);
		}
		if (expectedCandidate.objectiveRank !== actualCandidate.objectiveRank) {
			deltas.push(`${prefix} objective rank: expected ${expectedCandidate.objectiveRank ?? "n/a"}, actual ${actualCandidate.objectiveRank ?? "n/a"}`);
		}
		compareNumber(deltas, `${prefix} benchmark score`, expectedCandidate.benchmarkAttribution.score, actualCandidate.benchmarkScore);
		compareNumber(deltas, `${prefix} benchmark coverage`, expectedCandidate.benchmarkAttribution.coverage, actualCandidate.benchmarkCoverage);
		compareNumber(deltas, `${prefix} objective score`, expectedCandidate.objectiveScore, actualCandidate.objectiveScore);
		compareNumber(deltas, `${prefix} composite`, expectedCandidate.composite, actualCandidate.composite);
	}
	return { matches: deltas.length === 0, deltas, expected, actual };
}

export function defaultRouteReplayPath(decisionId: string): string {
	const safeId = decisionId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 128) || "decision";
	return join(ROUTE_REPLAY_DIR, `${safeId}.json`);
}

export function resolveRouteReplayPath(cwd: string, requestedPath: string | undefined, decisionId: string): string {
	const requested = requestedPath?.trim();
	if (!requested) return defaultRouteReplayPath(decisionId);
	const expanded = requested === "~" ? homedir() : requested.startsWith("~/") ? join(homedir(), requested.slice(2)) : requested;
	return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

export function writeRouteReplayBundleV1(
	path: string,
	bundle: RouteReplayBundleV1,
	operations?: AtomicWriteOperations,
): void {
	if (!isRouteReplayBundleV1(bundle)) throw new Error("Cannot write an invalid route replay bundle");
	const content = `${JSON.stringify(bundle, null, 2)}\n`;
	const bytes = Buffer.byteLength(content, "utf8");
	if (bytes > ROUTE_REPLAY_MAX_BYTES) throw new Error(`Route replay bundle exceeds ${ROUTE_REPLAY_MAX_BYTES} bytes`);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	writeTextFileAtomically(path, content, 0o600, operations);
}

export function readRouteReplayBundleV1(path: string): RouteReplayBundleV1 {
	const value = readBoundedJsonFileIfExists(path, ROUTE_REPLAY_MAX_BYTES);
	if (value === undefined) throw new Error(`Route replay bundle not found: ${path}`);
	if (!isRouteReplayBundleV1(value)) throw new Error(`Invalid route replay bundle: ${path}`);
	return value;
}

export function formatRouteReplayResultV1(path: string, result: RouteReplayResultV1): string[] {
	const expected = routeKey(result.expected.provider, result.expected.modelId, result.expected.thinkingLevel);
	if (result.matches && result.actual) {
		return [
			`StarRouter replay matched · ${path}`,
			`Recommendation · ${expected} · ${result.actual.recommendationBasis}`,
			`Candidates · ${result.actual.candidates.length} · zero route/score deltas`,
		];
	}
	return [
		`StarRouter replay delta · ${path}`,
		`Expected · ${expected} · ${result.expected.recommendationBasis}`,
		...result.deltas.slice(0, 12).map((delta) => `Delta · ${delta}`),
	];
}
