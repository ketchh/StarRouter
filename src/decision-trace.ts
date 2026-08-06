import type {
	ApplicationOrigin,
	AaDatasetProvenance,
	BenchmarkKey,
	Candidate,
	CandidateConfidence,
	CandidateScoreBreakdown,
	MetricRange,
	PromptLengthType,
	PromptProfile,
	ProviderScopeMode,
	RecommendationBasis,
	RouteObjective,
	ThinkingLevel,
} from "./router-core.ts";
import { promptProfileDisplayLabel } from "./prompt-understanding.ts";

/**
 * Version one is intentionally additive and observational. Changing this value requires a
 * migration or a new reader; never reinterpret an existing trace version in place.
 */
export const DECISION_TRACE_SCHEMA_VERSION = 1 as const;
export const DECISION_TRACE_MAX_CANDIDATES = 3;
export const DECISION_TRACE_BENCHMARK_KEYS = [
	"intelligence_index",
	"agentic_index",
	"coding_index",
	"gdpval_normalized",
	"tau2",
	"terminalbench_hard",
	"scicode",
	"livecodebench",
	"ifbench",
	"omniscience",
	"gpqa",
	"hle",
	"critpt",
	"lcr",
] as const satisfies readonly BenchmarkKey[];
export const DECISION_TRACE_MAX_BENCHMARKS = DECISION_TRACE_BENCHMARK_KEYS.length;
export const DECISION_TRACE_MAX_STRING_LENGTH = 4_096;
export const DECISION_TRACE_MAX_BYTES = 128 * 1024;

export type BenchmarkAttributionStatus = "used" | "missing-metric" | "missing-range" | "not-requested";

export interface BenchmarkAttributionItem {
	key: BenchmarkKey;
	label: string;
	requestedWeight: number;
	metricAvailable: boolean;
	rangeAvailable: boolean;
	status: BenchmarkAttributionStatus;
	rawMetric?: number;
	normalizedMetric?: number;
	/** Weight after the same available-metric renormalization used by benchmarkScore(). */
	effectiveWeight: number;
	/** normalizedMetric × requestedWeight, before available-weight renormalization. */
	weightedValue: number;
	/** Contribution to the final benchmark score; all used contributions sum to score. */
	contribution: number;
	/** Share of the non-zero benchmark score. This is presentational, never a ranking input. */
	contributionShare: number;
}

export interface BenchmarkAttributionSummary {
	score: number;
	totalRequestedWeight: number;
	availableWeight: number;
	coverage: number;
	items: BenchmarkAttributionItem[];
}

export interface BenchmarkAttributionInput {
	weights: Record<BenchmarkKey, number>;
	metricFor: (key: BenchmarkKey) => number | undefined;
	rangeFor: (key: BenchmarkKey) => MetricRange | undefined;
	labelFor: (key: BenchmarkKey) => string;
	normalize: (value: number | undefined, range: MetricRange | undefined) => number;
}

interface BenchmarkTotals {
	score: number;
	totalRequestedWeight: number;
	availableWeight: number;
	coverage: number;
}

/**
 * The single numeric implementation shared by ranking and attribution. It allocates no per-metric
 * trace objects, so normal candidate enumeration keeps the same bounded memory shape as V1.1.1.
 */
function computeBenchmarkTotals(input: BenchmarkAttributionInput): BenchmarkTotals {
	let numerator = 0;
	let totalRequestedWeight = 0;
	let availableWeight = 0;
	for (const [key, rawWeight] of Object.entries(input.weights) as Array<[BenchmarkKey, number]>) {
		const requestedWeight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 0;
		if (requestedWeight <= 0) continue;
		totalRequestedWeight += requestedWeight;
		const rawMetric = input.metricFor(key);
		if (typeof rawMetric !== "number" || !Number.isFinite(rawMetric)) continue;
		availableWeight += requestedWeight;
		numerator += input.normalize(rawMetric, input.rangeFor(key)) * requestedWeight;
	}
	const score = availableWeight > 0 ? numerator / availableWeight : 0;
	return {
		score,
		totalRequestedWeight,
		availableWeight,
		coverage: totalRequestedWeight > 0 ? availableWeight / totalRequestedWeight : 0,
	};
}

export function benchmarkScoreFromAttributionInput(input: BenchmarkAttributionInput): number {
	return computeBenchmarkTotals(input).score;
}

/**
 * Expands the existing V1 benchmark score into complete per-metric attribution. The denominator
 * deliberately mirrors legacy behavior: a finite zero metric keeps its requested weight, while a
 * missing metric contributes no denominator weight.
 */
export function buildBenchmarkAttribution(input: BenchmarkAttributionInput): BenchmarkAttributionSummary {
	const totals = computeBenchmarkTotals(input);
	const items: BenchmarkAttributionItem[] = (Object.entries(input.weights) as Array<[BenchmarkKey, number]>).map(([key, rawWeight]) => {
		const requestedWeight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 0;
		const rawMetric = input.metricFor(key);
		const metricAvailable = typeof rawMetric === "number" && Number.isFinite(rawMetric);
		const range = input.rangeFor(key);
		const rangeAvailable = Boolean(range && Number.isFinite(range.min) && Number.isFinite(range.max));
		const normalizedMetric = metricAvailable ? input.normalize(rawMetric, range) : undefined;
		const used = requestedWeight > 0 && metricAvailable;
		const effectiveWeight = used && totals.availableWeight > 0 ? requestedWeight / totals.availableWeight : 0;
		const weightedValue = used ? Number(normalizedMetric ?? 0) * requestedWeight : 0;
		const contribution = used && totals.availableWeight > 0 ? weightedValue / totals.availableWeight : 0;
		const status: BenchmarkAttributionStatus = requestedWeight <= 0
			? "not-requested"
			: !metricAvailable
				? "missing-metric"
				: !rangeAvailable
					? "missing-range"
					: "used";
		return {
			key,
			label: input.labelFor(key),
			requestedWeight,
			metricAvailable,
			rangeAvailable,
			status,
			rawMetric: metricAvailable ? rawMetric : undefined,
			normalizedMetric,
			effectiveWeight,
			weightedValue,
			contribution,
			contributionShare: totals.score > 0 ? contribution / totals.score : 0,
		};
	});
	return { ...totals, items };
}

export interface DecisionTracePromptV1 {
	characters: number;
	hasImages: boolean;
	contextMode: "local-only";
	followUpDisposition: "routed";
}

export interface DecisionTraceProfileV1 {
	summary: string;
	matchedSignals: string[];
	analysisNotes: string[];
	benchmarkWeights: Record<BenchmarkKey, number>;
	priorities: PromptProfile["priorities"];
	targetThinkingLevel: ThinkingLevel;
	promptLengthType: PromptLengthType;
	complexityScore?: number;
	routingTier?: string;
	uncertain?: boolean;
	classifierSource?: string;
}

export interface DecisionTraceCandidateV1 {
	rank: number;
	objectiveRank?: number;
	recommended: boolean;
	applied: boolean;
	provider: string;
	modelId: string;
	modelName: string;
	thinkingLevel: ThinkingLevel;
	aaSlug: string;
	aaName: string;
	aaHost?: string;
	evidenceScope: "host-verified" | "model-only";
	aaMatchScore: number;
	metrics: {
		price?: number;
		speed?: number;
		latency?: number;
		latencyBasis?: "end-to-end" | "ttft";
		contextWindow: number;
		tokenBurn?: number;
	};
	benchmarkAttribution: BenchmarkAttributionSummary;
	scoreBreakdown: CandidateScoreBreakdown;
	objectiveScore: number;
	compositeAdjustment: number;
	composite: number;
	confidence?: CandidateConfidence;
	reasonBits: string[];
}

export interface DecisionTraceV1 {
	schemaVersion: typeof DECISION_TRACE_SCHEMA_VERSION;
	decisionId: string;
	timestamp: number;
	prompt: DecisionTracePromptV1;
	profile: DecisionTraceProfileV1;
	scope: {
		mode: ProviderScopeMode;
		label: string;
		availableModelCount: number;
		availableRouteCount: number;
	};
	data: {
		sourceLabel: string;
		fetchedAt: number;
		provenance?: AaDatasetProvenance;
	};
	objective: RouteObjective;
	recommendation: {
		basis: RecommendationBasis;
		provider: string;
		modelId: string;
		thinkingLevel: ThinkingLevel;
	};
	application?: {
		origin: ApplicationOrigin;
		provider: string;
		modelId: string;
		thinkingLevel: ThinkingLevel;
	};
	candidates: DecisionTraceCandidateV1[];
}

export interface BuildDecisionTraceV1Input {
	decisionId: string;
	timestamp: number;
	promptCharacters: number;
	hasImages: boolean;
	profile: PromptProfile;
	providerScopeMode: ProviderScopeMode;
	providerScopeLabel: string;
	availableModelCount: number;
	availableRouteCount: number;
	dataSourceLabel: string;
	datasetFetchedAt: number;
	datasetProvenance?: AaDatasetProvenance;
	objective: RouteObjective;
	recommendationBasis: RecommendationBasis;
	best: Candidate;
	applied?: Candidate;
	applicationOrigin?: ApplicationOrigin;
	actualThinkingLevel?: ThinkingLevel;
	topCandidates: Candidate[];
}

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const OBJECTIVES = new Set<RouteObjective>(["balanced", "quality", "cheapest", "fastest"]);
const RECOMMENDATION_BASES = new Set<RecommendationBasis>(["objective-ranking", "hysteresis", "confidence-fallback"]);
const APPLICATION_ORIGINS = new Set<ApplicationOrigin>(["auto-accept", "user-recommended", "user-current", "user-alternative"]);
const ATTRIBUTION_STATUSES = new Set<BenchmarkAttributionStatus>(["used", "missing-metric", "missing-range", "not-requested"]);

function boundedString(value: string): string {
	if (value.length > DECISION_TRACE_MAX_STRING_LENGTH || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
		throw new Error("Decision trace string exceeds the V1 contract");
	}
	return value;
}

function boundedStrings(values: string[], maxItems = 32): string[] {
	if (values.length > maxItems) throw new Error(`Decision trace collection exceeds ${maxItems} items`);
	return values.map(boundedString);
}

function finiteOrUndefined(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function candidateKey(candidate: Candidate, thinkingLevel = candidate.candidateThinkingLevel): string {
	return `${candidate.piModel.provider}/${candidate.piModel.id}@${thinkingLevel}`;
}

function requireAttribution(candidate: Candidate): BenchmarkAttributionSummary {
	if (!candidate.benchmarkAttribution) {
		throw new Error(`Candidate ${candidate.piModel.id} has no benchmark attribution`);
	}
	return candidate.benchmarkAttribution;
}

function requireObjectiveScore(candidate: Candidate): number {
	if (typeof candidate.objectiveScore !== "number" || !Number.isFinite(candidate.objectiveScore)) {
		throw new Error(`Candidate ${candidate.piModel.id} has no objective score`);
	}
	return candidate.objectiveScore;
}

function cloneAttribution(attribution: BenchmarkAttributionSummary): BenchmarkAttributionSummary {
	return {
		score: attribution.score,
		totalRequestedWeight: attribution.totalRequestedWeight,
		availableWeight: attribution.availableWeight,
		coverage: attribution.coverage,
		items: attribution.items.slice(0, DECISION_TRACE_MAX_BENCHMARKS).map((item) => ({
			...item,
			label: boundedString(item.label),
		})),
	};
}

/** Builds a redacted, bounded snapshot from values already computed by the deterministic kernel. */
export function buildDecisionTraceV1(input: BuildDecisionTraceV1Input): DecisionTraceV1 {
	const applied = input.applied;
	const actualThinkingLevel = input.actualThinkingLevel ?? applied?.candidateThinkingLevel;
	const recommendedKey = candidateKey(input.best);
	const appliedKey = applied && actualThinkingLevel ? candidateKey(applied, actualThinkingLevel) : undefined;
	const candidates = input.topCandidates.slice(0, DECISION_TRACE_MAX_CANDIDATES).map((candidate, index): DecisionTraceCandidateV1 => ({
		rank: index + 1,
		objectiveRank: candidate.objectiveRank,
		recommended: candidateKey(candidate) === recommendedKey,
		applied: candidateKey(candidate) === appliedKey,
		provider: boundedString(String(candidate.piModel.provider)),
		modelId: boundedString(candidate.piModel.id),
		modelName: boundedString(candidate.piModel.name),
		thinkingLevel: candidate.candidateThinkingLevel,
		aaSlug: boundedString(candidate.aaModel.slug),
		aaName: boundedString(candidate.aaModel.name),
		aaHost: candidate.aaEvidenceScope === "host-verified" && candidate.aaModel.hostLabel
			? boundedString(candidate.aaModel.hostLabel)
			: undefined,
		evidenceScope: candidate.aaEvidenceScope,
		aaMatchScore: candidate.aaMatchScore,
		metrics: {
			price: finiteOrUndefined(candidate.price),
			speed: finiteOrUndefined(candidate.speed),
			latency: finiteOrUndefined(candidate.latency),
			latencyBasis: candidate.latencyBasis,
			contextWindow: candidate.contextWindow,
			tokenBurn: finiteOrUndefined(candidate.tokenBurn),
		},
		benchmarkAttribution: cloneAttribution(requireAttribution(candidate)),
		scoreBreakdown: { ...candidate.scoreBreakdown },
		objectiveScore: requireObjectiveScore(candidate),
		compositeAdjustment: candidate.composite - (
			candidate.scoreBreakdown.quality
			+ candidate.scoreBreakdown.cost
			+ candidate.scoreBreakdown.speed
			+ candidate.scoreBreakdown.latency
			+ candidate.scoreBreakdown.context
		),
		composite: candidate.composite,
		confidence: candidate.confidence ? { ...candidate.confidence, notes: boundedStrings(candidate.confidence.notes) } : undefined,
		reasonBits: boundedStrings(candidate.reasonBits),
	}));

	const trace: DecisionTraceV1 = {
		schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
		decisionId: boundedString(input.decisionId),
		timestamp: input.timestamp,
		prompt: {
			characters: Math.max(0, Math.floor(input.promptCharacters)),
			hasImages: input.hasImages,
			contextMode: "local-only",
			followUpDisposition: "routed",
		},
		profile: {
			summary: boundedString(input.profile.summary),
			matchedSignals: boundedStrings(input.profile.matchedSignals),
			analysisNotes: boundedStrings(input.profile.analysisNotes ?? []),
			benchmarkWeights: { ...input.profile.benchmarkWeights },
			priorities: { ...input.profile.priorities },
			targetThinkingLevel: input.profile.targetThinkingLevel,
			promptLengthType: input.profile.promptLengthType,
			complexityScore: input.profile.complexityScore,
			routingTier: input.profile.routingTier ? boundedString(input.profile.routingTier) : undefined,
			uncertain: input.profile.uncertain,
			classifierSource: input.profile.classifierSource ? boundedString(input.profile.classifierSource) : undefined,
		},
		scope: {
			mode: input.providerScopeMode,
			label: boundedString(input.providerScopeLabel),
			availableModelCount: input.availableModelCount,
			availableRouteCount: input.availableRouteCount,
		},
		data: {
			sourceLabel: boundedString(input.dataSourceLabel),
			fetchedAt: input.datasetFetchedAt,
			provenance: input.datasetProvenance,
		},
		objective: input.objective,
		recommendation: {
			basis: input.recommendationBasis,
			provider: boundedString(String(input.best.piModel.provider)),
			modelId: boundedString(input.best.piModel.id),
			thinkingLevel: input.best.candidateThinkingLevel,
		},
		application: applied && input.applicationOrigin && actualThinkingLevel ? {
			origin: input.applicationOrigin,
			provider: boundedString(String(applied.piModel.provider)),
			modelId: boundedString(applied.piModel.id),
			thinkingLevel: actualThinkingLevel,
		} : undefined,
		candidates,
	};
	if (!isDecisionTraceV1(trace)) throw new Error("Decision trace failed its V1 contract");
	return trace;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDenseArray(value: unknown): value is unknown[] {
	return Array.isArray(value)
		&& Array.from({ length: value.length }, (_, index) => index)
			.every((index) => Object.prototype.hasOwnProperty.call(value, index));
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const allow = new Set(allowed);
	return Object.keys(value).every((key) => allow.has(key));
}

function isBoundedString(value: unknown, required = false): value is string {
	return typeof value === "string"
		&& value.length <= DECISION_TRACE_MAX_STRING_LENGTH
		&& (!required || value.length > 0)
		&& !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function isStringArray(value: unknown, maxItems = 32): value is string[] {
	return isDenseArray(value) && value.length <= maxItems && value.every((item) => isBoundedString(item));
}

function isAttributionSummary(value: unknown): value is BenchmarkAttributionSummary {
	if (!isRecord(value) || !hasOnlyKeys(value, ["score", "totalRequestedWeight", "availableWeight", "coverage", "items"])) return false;
	if (!isFiniteNumber(value.score)
		|| !isFiniteNumber(value.totalRequestedWeight)
		|| !isFiniteNumber(value.availableWeight)
		|| !isFiniteNumber(value.coverage)) return false;
	if (value.coverage < 0 || value.coverage > 1 || value.totalRequestedWeight < 0 || value.availableWeight < 0) return false;
	if (!isDenseArray(value.items) || value.items.length !== DECISION_TRACE_MAX_BENCHMARKS) return false;
	const keys = new Set<string>();
	const knownKeys = new Set<string>(DECISION_TRACE_BENCHMARK_KEYS);
	let contributionTotal = 0;
	for (const item of value.items) {
		if (!isRecord(item) || !hasOnlyKeys(item, [
			"key", "label", "requestedWeight", "metricAvailable", "rangeAvailable", "status",
			"rawMetric", "normalizedMetric", "effectiveWeight", "weightedValue", "contribution", "contributionShare",
		])) return false;
		if (!isBoundedString(item.key, true) || !knownKeys.has(item.key) || !isBoundedString(item.label, true)) return false;
		if (keys.has(item.key)) return false;
		keys.add(item.key);
		if (!ATTRIBUTION_STATUSES.has(item.status as BenchmarkAttributionStatus)) return false;
		if (typeof item.metricAvailable !== "boolean" || typeof item.rangeAvailable !== "boolean") return false;
		for (const field of ["requestedWeight", "effectiveWeight", "weightedValue", "contribution", "contributionShare"] as const) {
			if (!isFiniteNumber(item[field])) return false;
		}
		if (item.rawMetric !== undefined && !isFiniteNumber(item.rawMetric)) return false;
		if (item.normalizedMetric !== undefined && !isFiniteNumber(item.normalizedMetric)) return false;
		contributionTotal += Number(item.contribution);
	}
	return Math.abs(contributionTotal - value.score) <= 1e-9;
}

function isCandidateTrace(value: unknown): value is DecisionTraceCandidateV1 {
	if (!isRecord(value) || !hasOnlyKeys(value, [
		"rank", "objectiveRank", "recommended", "applied", "provider", "modelId", "modelName", "thinkingLevel",
		"aaSlug", "aaName", "aaHost", "evidenceScope", "aaMatchScore", "metrics", "benchmarkAttribution", "scoreBreakdown",
		"objectiveScore", "compositeAdjustment", "composite", "confidence", "reasonBits",
	])) return false;
	if (!isFiniteNumber(value.rank) || value.rank < 1) return false;
	if (value.objectiveRank !== undefined && (!isFiniteNumber(value.objectiveRank) || value.objectiveRank < 1)) return false;
	if (typeof value.recommended !== "boolean" || typeof value.applied !== "boolean") return false;
	for (const field of ["provider", "modelId", "modelName", "aaSlug", "aaName"] as const) {
		if (!isBoundedString(value[field], true)) return false;
	}
	if (value.aaHost !== undefined && !isBoundedString(value.aaHost)) return false;
	if (!THINKING_LEVELS.has(value.thinkingLevel as ThinkingLevel)) return false;
	if (value.evidenceScope !== "host-verified" && value.evidenceScope !== "model-only") return false;
	if (!isFiniteNumber(value.aaMatchScore)
		|| !isRecord(value.metrics)
		|| !hasOnlyKeys(value.metrics, ["price", "speed", "latency", "latencyBasis", "contextWindow", "tokenBurn"])
		|| !isFiniteNumber(value.metrics.contextWindow)
		|| value.metrics.contextWindow < 0
		|| !isFiniteNumber(value.objectiveScore)
		|| !isFiniteNumber(value.compositeAdjustment)
		|| !isFiniteNumber(value.composite)) return false;
	for (const field of ["price", "speed", "latency", "tokenBurn"] as const) {
		if (value.metrics[field] !== undefined && !isFiniteNumber(value.metrics[field])) return false;
	}
	if (value.metrics.latencyBasis !== undefined && value.metrics.latencyBasis !== "end-to-end" && value.metrics.latencyBasis !== "ttft") return false;
	if (!isAttributionSummary(value.benchmarkAttribution) || !isRecord(value.scoreBreakdown)) return false;
	if (!hasOnlyKeys(value.scoreBreakdown, ["quality", "cost", "speed", "latency", "context", "match"])) return false;
	if (![value.scoreBreakdown.quality, value.scoreBreakdown.cost, value.scoreBreakdown.speed, value.scoreBreakdown.latency, value.scoreBreakdown.context, value.scoreBreakdown.match].every(isFiniteNumber)) return false;
	const compositeBase = Number(value.scoreBreakdown.quality)
		+ Number(value.scoreBreakdown.cost)
		+ Number(value.scoreBreakdown.speed)
		+ Number(value.scoreBreakdown.latency)
		+ Number(value.scoreBreakdown.context);
	if (Math.abs(compositeBase + value.compositeAdjustment - value.composite) > 1e-9) return false;
	if (value.confidence !== undefined) {
		if (!isRecord(value.confidence) || !hasOnlyKeys(value.confidence, ["match", "constraints", "cost", "overall", "notes"])) return false;
		if (![value.confidence.match, value.confidence.constraints, value.confidence.cost, value.confidence.overall].every(isFiniteNumber)) return false;
		if (!isStringArray(value.confidence.notes)) return false;
	}
	if (!isStringArray(value.reasonBits)) return false;
	return true;
}

export function isDecisionTraceV1(value: unknown): value is DecisionTraceV1 {
	if (!isRecord(value) || !hasOnlyKeys(value, [
		"schemaVersion", "decisionId", "timestamp", "prompt", "profile", "scope", "data", "objective",
		"recommendation", "application", "candidates",
	]) || value.schemaVersion !== DECISION_TRACE_SCHEMA_VERSION) return false;
	try {
		if (Buffer.byteLength(JSON.stringify(value), "utf8") > DECISION_TRACE_MAX_BYTES) return false;
	} catch {
		return false;
	}
	if (!isBoundedString(value.decisionId, true) || !isFiniteNumber(value.timestamp)) return false;
	if (!isRecord(value.prompt) || !hasOnlyKeys(value.prompt, ["characters", "hasImages", "contextMode", "followUpDisposition"])) return false;
	if (!isFiniteNumber(value.prompt.characters) || !Number.isInteger(value.prompt.characters) || value.prompt.characters < 0) return false;
	if (typeof value.prompt.hasImages !== "boolean" || value.prompt.contextMode !== "local-only" || value.prompt.followUpDisposition !== "routed") return false;
	if (!isRecord(value.profile) || !hasOnlyKeys(value.profile, [
		"summary", "matchedSignals", "analysisNotes", "benchmarkWeights", "priorities", "targetThinkingLevel",
		"promptLengthType", "complexityScore", "routingTier", "uncertain", "classifierSource",
	]) || !isBoundedString(value.profile.summary, true)) return false;
	if (!isStringArray(value.profile.matchedSignals) || !isStringArray(value.profile.analysisNotes)) return false;
	if (!isRecord(value.profile.benchmarkWeights) || !isRecord(value.profile.priorities)) return false;
	const benchmarkKeySet = new Set<string>(DECISION_TRACE_BENCHMARK_KEYS);
	if (Object.keys(value.profile.benchmarkWeights).length !== DECISION_TRACE_MAX_BENCHMARKS
		|| !Object.entries(value.profile.benchmarkWeights).every(([key, weight]) => benchmarkKeySet.has(key) && isFiniteNumber(weight) && weight >= 0)) return false;
	if (!hasOnlyKeys(value.profile.priorities, ["costSensitivity", "speedSensitivity", "reasoningNeed", "contextNeed", "visionNeed", "toolUseNeed", "formatReliabilityNeed"])) return false;
	if (!Object.values(value.profile.priorities).every((priority) => isFiniteNumber(priority) && priority >= 0 && priority <= 1)) return false;
	if (!THINKING_LEVELS.has(value.profile.targetThinkingLevel as ThinkingLevel) || !isBoundedString(value.profile.promptLengthType, true)) return false;
	if (value.profile.complexityScore !== undefined && !isFiniteNumber(value.profile.complexityScore)) return false;
	if (value.profile.routingTier !== undefined && !isBoundedString(value.profile.routingTier)) return false;
	if (value.profile.uncertain !== undefined && typeof value.profile.uncertain !== "boolean") return false;
	if (value.profile.classifierSource !== undefined && !isBoundedString(value.profile.classifierSource)) return false;
	if (!isRecord(value.scope) || !hasOnlyKeys(value.scope, ["mode", "label", "availableModelCount", "availableRouteCount"])) return false;
	if (value.scope.mode !== "configured-provider" || !isBoundedString(value.scope.label, true)) return false;
	if (!isFiniteNumber(value.scope.availableModelCount) || !Number.isInteger(value.scope.availableModelCount) || value.scope.availableModelCount < 0) return false;
	if (!isFiniteNumber(value.scope.availableRouteCount) || !Number.isInteger(value.scope.availableRouteCount) || value.scope.availableRouteCount < 0) return false;
	if (!isRecord(value.data) || !hasOnlyKeys(value.data, ["sourceLabel", "fetchedAt", "provenance"])) return false;
	if (!isBoundedString(value.data.sourceLabel, true) || !isFiniteNumber(value.data.fetchedAt)) return false;
	if (value.data.provenance !== undefined && !["network", "fresh-cache", "stale-fallback"].includes(String(value.data.provenance))) return false;
	if (!OBJECTIVES.has(value.objective as RouteObjective)) return false;
	if (!isRecord(value.recommendation) || !hasOnlyKeys(value.recommendation, ["basis", "provider", "modelId", "thinkingLevel"])) return false;
	if (!RECOMMENDATION_BASES.has(value.recommendation.basis as RecommendationBasis)) return false;
	if (!isBoundedString(value.recommendation.provider, true) || !isBoundedString(value.recommendation.modelId, true)) return false;
	if (!THINKING_LEVELS.has(value.recommendation.thinkingLevel as ThinkingLevel)) return false;
	if (value.application !== undefined) {
		if (!isRecord(value.application) || !hasOnlyKeys(value.application, ["origin", "provider", "modelId", "thinkingLevel"])) return false;
		if (!APPLICATION_ORIGINS.has(value.application.origin as ApplicationOrigin)) return false;
		if (!isBoundedString(value.application.provider, true) || !isBoundedString(value.application.modelId, true)) return false;
		if (!THINKING_LEVELS.has(value.application.thinkingLevel as ThinkingLevel)) return false;
	}
	if (!isDenseArray(value.candidates) || value.candidates.length === 0 || value.candidates.length > DECISION_TRACE_MAX_CANDIDATES) return false;
	if (!value.candidates.every(isCandidateTrace)) return false;
	const recommended = value.candidates.filter((candidate) => candidate.recommended);
	if (recommended.length !== 1) return false;
	if (`${recommended[0]!.provider}/${recommended[0]!.modelId}@${recommended[0]!.thinkingLevel}`
		!== `${value.recommendation.provider}/${value.recommendation.modelId}@${value.recommendation.thinkingLevel}`) return false;
	const applied = value.candidates.filter((candidate) => candidate.applied);
	if (value.application === undefined) return applied.length === 0;
	return applied.length === 1
		&& `${applied[0]!.provider}/${applied[0]!.modelId}@${applied[0]!.thinkingLevel}`
			=== `${value.application.provider}/${value.application.modelId}@${value.application.thinkingLevel}`;
}

export type RoutingAttemptOutcomeV1 =
	| "decision"
	| "exact-follow-up-kept"
	| "empty-prompt-skipped"
	| "dataset-unavailable"
	| "insufficient-profile-evidence"
	| "no-trustworthy-route"
	| "confirmation-cancelled"
	| "current-route-unrecordable"
	| "model-application-failed";

export type RoutingAttemptReasonV1 =
	| "decision-recorded"
	| "exact-follow-up-policy"
	| "empty-prompt"
	| "dataset-load-failed"
	| "profile-evidence-insufficient"
	| "candidate-pool-abstained"
	| "user-cancelled"
	| "current-route-not-in-candidate-set"
	| "set-model-failed";

export interface RoutingAttemptTraceV1 {
	schemaVersion: typeof DECISION_TRACE_SCHEMA_VERSION;
	attemptId: string;
	timestamp: number;
	prompt: {
		characters: number;
		hasImages: boolean;
		contextMode: "local-only";
	};
	outcome: RoutingAttemptOutcomeV1;
	reason: RoutingAttemptReasonV1;
	routeAction: "decision-recorded" | "current-route-kept";
	decisionId?: string;
}

const ROUTING_ATTEMPT_REASONS: Record<RoutingAttemptOutcomeV1, RoutingAttemptReasonV1> = {
	decision: "decision-recorded",
	"exact-follow-up-kept": "exact-follow-up-policy",
	"empty-prompt-skipped": "empty-prompt",
	"dataset-unavailable": "dataset-load-failed",
	"insufficient-profile-evidence": "profile-evidence-insufficient",
	"no-trustworthy-route": "candidate-pool-abstained",
	"confirmation-cancelled": "user-cancelled",
	"current-route-unrecordable": "current-route-not-in-candidate-set",
	"model-application-failed": "set-model-failed",
};

export function buildRoutingAttemptTraceV1(input: {
	attemptId: string;
	timestamp?: number;
	promptCharacters: number;
	hasImages: boolean;
	outcome: RoutingAttemptOutcomeV1;
	decisionId?: string;
}): RoutingAttemptTraceV1 {
	const attempt: RoutingAttemptTraceV1 = {
		schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
		attemptId: boundedString(input.attemptId),
		timestamp: input.timestamp ?? Date.now(),
		prompt: {
			characters: Math.max(0, Math.floor(input.promptCharacters)),
			hasImages: input.hasImages,
			contextMode: "local-only",
		},
		outcome: input.outcome,
		reason: ROUTING_ATTEMPT_REASONS[input.outcome],
		routeAction: input.outcome === "decision" ? "decision-recorded" : "current-route-kept",
		decisionId: input.outcome === "decision" && input.decisionId ? boundedString(input.decisionId) : undefined,
	};
	if (!isRoutingAttemptTraceV1(attempt)) throw new Error("Routing attempt failed its V1 contract");
	return attempt;
}

export function isRoutingAttemptTraceV1(value: unknown): value is RoutingAttemptTraceV1 {
	if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "attemptId", "timestamp", "prompt", "outcome", "reason", "routeAction", "decisionId"])) return false;
	if (value.schemaVersion !== DECISION_TRACE_SCHEMA_VERSION || !isBoundedString(value.attemptId, true) || !isFiniteNumber(value.timestamp)) return false;
	if (!isRecord(value.prompt) || !hasOnlyKeys(value.prompt, ["characters", "hasImages", "contextMode"])) return false;
	if (!isFiniteNumber(value.prompt.characters) || !Number.isInteger(value.prompt.characters) || value.prompt.characters < 0) return false;
	if (typeof value.prompt.hasImages !== "boolean" || value.prompt.contextMode !== "local-only") return false;
	if (!Object.prototype.hasOwnProperty.call(ROUTING_ATTEMPT_REASONS, String(value.outcome))) return false;
	const outcome = value.outcome as RoutingAttemptOutcomeV1;
	if (value.reason !== ROUTING_ATTEMPT_REASONS[outcome]) return false;
	if (value.routeAction !== (outcome === "decision" ? "decision-recorded" : "current-route-kept")) return false;
	if (outcome === "decision") return isBoundedString(value.decisionId, true);
	return value.decisionId === undefined;
}

export function formatRoutingAttemptTraceV1(attempt: RoutingAttemptTraceV1): string[] {
	const labels: Record<RoutingAttemptOutcomeV1, string> = {
		decision: "Decision recorded",
		"exact-follow-up-kept": "Current route kept for an exact continuation follow-up",
		"empty-prompt-skipped": "Routing skipped for an empty prompt",
		"dataset-unavailable": "Current route kept because routing data was unavailable",
		"insufficient-profile-evidence": "Current route kept because the prompt profile was unclassified with limited evidence",
		"no-trustworthy-route": "Current route kept because the candidate pool abstained",
		"confirmation-cancelled": "Current route kept because confirmation was cancelled",
		"current-route-unrecordable": "Current route kept without a benchmark candidate record",
		"model-application-failed": "Current route kept because model application failed",
	};
	return [
		`StarRouter routing attempt ${attempt.attemptId}`,
		`Outcome · ${labels[attempt.outcome]}`,
		`Reason · ${attempt.reason}`,
		`Context · ${attempt.prompt.contextMode} · ${attempt.prompt.characters} characters${attempt.prompt.hasImages ? " · images" : ""}`,
		...(attempt.decisionId ? [`Decision · ${attempt.decisionId}`] : []),
	];
}

function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function uncertaintyLabel(value: boolean | undefined): string {
	if (value === true) return "uncertain";
	if (value === false) return "evidence recognized";
	return "uncertainty unknown";
}

/** Plain, shared explain surface for print/RPC/TUI adapters. It never recalculates ranking inputs. */
export function formatDecisionTraceV1(trace: DecisionTraceV1): string[] {
	const recommended = trace.candidates.find((candidate) => candidate.recommended) ?? trace.candidates[0];
	const runnerUp = trace.candidates.find((candidate) => !candidate.recommended);
	const application = trace.application
		? `${trace.application.provider}/${trace.application.modelId} @ ${trace.application.thinkingLevel} (${trace.application.origin})`
		: "not recorded";
	const lines = [
		`StarRouter decision ${trace.decisionId}`,
		`Recommended · ${trace.recommendation.provider}/${trace.recommendation.modelId} @ ${trace.recommendation.thinkingLevel} · ${trace.objective} · ${trace.recommendation.basis}`,
		`Applied · ${application}`,
		`Profile · ${promptProfileDisplayLabel(trace.profile)} · detected score ${trace.profile.complexityScore === undefined ? "n/a" : percent(trace.profile.complexityScore)} · thinking ${trace.profile.targetThinkingLevel} · ${uncertaintyLabel(trace.profile.uncertain)} · ${trace.prompt.contextMode}`,
	];
	if (recommended) {
		lines.push(`Benchmark evidence · fit ${percent(recommended.benchmarkAttribution.score)} · coverage ${percent(recommended.benchmarkAttribution.coverage)} · ${recommended.evidenceScope}`);
		lines.push(`Route evidence · AA match ${percent(Math.min(recommended.aaMatchScore, 1))} · cost ${recommended.metrics.price === undefined ? "n/a" : "available"} · speed ${recommended.metrics.speed === undefined ? "n/a" : "available"} · latency ${recommended.metrics.latency === undefined ? "n/a" : recommended.metrics.latencyBasis ?? "available"}`);
		const contributions = recommended.benchmarkAttribution.items
			.filter((item) => item.status === "used")
			.sort((a, b) => b.contribution - a.contribution || b.requestedWeight - a.requestedWeight)
			.slice(0, 5);
		for (const item of contributions) {
			lines.push(`  ${item.label} · weight ${percent(item.requestedWeight)} · metric ${item.normalizedMetric === undefined ? "n/a" : percent(item.normalizedMetric)} · contribution ${percent(item.contribution)}`);
		}
		const missing = recommended.benchmarkAttribution.items
			.filter((item) => item.status === "missing-metric" && item.requestedWeight > 0)
			.sort((a, b) => b.requestedWeight - a.requestedWeight)
			.map((item) => `${item.label} (${percent(item.requestedWeight)})`);
		if (missing.length > 0) lines.push(`Missing weighted metrics · ${missing.join(", ")}`);
		const missingRanges = recommended.benchmarkAttribution.items
			.filter((item) => item.status === "missing-range" && item.requestedWeight > 0)
			.sort((a, b) => b.requestedWeight - a.requestedWeight)
			.map((item) => `${item.label} (${percent(item.requestedWeight)})`);
		if (missingRanges.length > 0) lines.push(`Missing normalization ranges · ${missingRanges.join(", ")}`);
	}
	if (runnerUp) {
		lines.push(`Runner-up · ${runnerUp.provider}/${runnerUp.modelId} @ ${runnerUp.thinkingLevel} · fit ${percent(runnerUp.benchmarkAttribution.score)} · objective ${runnerUp.objectiveScore.toFixed(3)}`);
	}
	lines.push(`Scope · ${trace.scope.label} · ${trace.scope.availableModelCount} models / ${trace.scope.availableRouteCount} routes`);
	lines.push(`Data · ${trace.data.sourceLabel} · ${trace.data.provenance ?? "provenance unavailable"}`);
	return lines;
}
