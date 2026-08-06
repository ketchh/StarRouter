import test from "node:test";
import assert from "node:assert/strict";
import {
	BENCHMARK_LABELS,
	benchmarkAttributionForAaModel,
	getAaMetric,
	normalizeByRange,
	type AaModel,
	type BenchmarkKey,
	type Candidate,
	type DatasetStats,
	type PromptProfile,
} from "../src/router-core.ts";
import {
	DECISION_TRACE_MAX_BENCHMARKS,
	DECISION_TRACE_SCHEMA_VERSION,
	buildBenchmarkAttribution,
	buildDecisionTraceV1,
	buildRoutingAttemptTraceV1,
	formatDecisionTraceV1,
	formatRoutingAttemptTraceV1,
	isDecisionTraceV1,
	isRoutingAttemptTraceV1,
} from "../src/decision-trace.ts";

const benchmarkKeys = Object.keys(BENCHMARK_LABELS) as BenchmarkKey[];

function weights(overrides: Partial<Record<BenchmarkKey, number>> = {}): Record<BenchmarkKey, number> {
	return Object.fromEntries(benchmarkKeys.map((key) => [key, overrides[key] ?? 0])) as Record<BenchmarkKey, number>;
}

function profile(benchmarkWeights: Record<BenchmarkKey, number>): PromptProfile {
	return {
		summary: "trace test",
		matchedSignals: ["coding"],
		benchmarkWeights,
		priorities: {
			costSensitivity: 0,
			speedSensitivity: 0,
			reasoningNeed: 0.5,
			contextNeed: 0,
			visionNeed: 0,
			toolUseNeed: 0,
			formatReliabilityNeed: 0,
		},
		targetThinkingLevel: "medium",
		promptLengthType: "medium_coding",
	};
}

function aaModel(overrides: Partial<AaModel> = {}): AaModel {
	return {
		sourceMode: "api",
		slug: "trace-model",
		name: "Trace Model",
		shortName: "Trace",
		reasoningModel: false,
		inputModalityImage: false,
		performanceByPromptLength: [],
		...overrides,
	};
}

function legacyBenchmarkScore(model: AaModel, promptProfile: PromptProfile, stats: DatasetStats): number {
	let score = 0;
	let totalWeight = 0;
	for (const [key, weight] of Object.entries(promptProfile.benchmarkWeights) as Array<[BenchmarkKey, number]>) {
		if (weight <= 0) continue;
		const value = getAaMetric(model, key);
		const normalized = normalizeByRange(value, stats.metrics[key], false);
		if (normalized <= 0 && !(typeof value === "number" && Number.isFinite(value))) continue;
		score += normalized * weight;
		totalWeight += weight;
	}
	return totalWeight > 0 ? score / totalWeight : 0;
}

/*
 * Verifies each per-benchmark contribution reconstructs the exact normalized quality score while
 * retaining every benchmark key for later explainability surfaces.
 */
test("benchmark attribution reconstructs the exact score from contributions", () => {
	const metricValues: Partial<Record<BenchmarkKey, number>> = {
		coding_index: 80,
		terminalbench_hard: 50,
	};
	const ranges: Partial<Record<BenchmarkKey, { min: number; max: number }>> = {
		coding_index: { min: 0, max: 100 },
		terminalbench_hard: { min: 0, max: 100 },
	};
	const attribution = buildBenchmarkAttribution({
		weights: weights({ coding_index: 0.6, terminalbench_hard: 0.4 }),
		metricFor: (key) => metricValues[key],
		rangeFor: (key) => ranges[key],
		labelFor: (key) => BENCHMARK_LABELS[key],
		normalize: (value, range) => normalizeByRange(value, range),
	});

	assert.equal(attribution.items.length, DECISION_TRACE_MAX_BENCHMARKS);
	assert.ok(Math.abs(attribution.score - 0.68) < 1e-12);
	assert.equal(attribution.totalRequestedWeight, 1);
	assert.equal(attribution.availableWeight, 1);
	assert.equal(attribution.coverage, 1);
	const coding = attribution.items.find((item) => item.key === "coding_index")!;
	const terminal = attribution.items.find((item) => item.key === "terminalbench_hard")!;
	assert.equal(coding.status, "used");
	assert.ok(Math.abs(coding.contribution - 0.48) < 1e-12);
	assert.ok(Math.abs(terminal.contribution - 0.2) < 1e-12);
	assert.ok(Math.abs(attribution.items.reduce((total, item) => total + item.contribution, 0) - attribution.score) < 1e-12);
});

/*
 * Verifies missing metrics reduce explicit coverage but retain the 1.1.1 behavior of renormalizing
 * the benchmark score over only finite, available metrics.
 */
test("benchmark attribution exposes missing-metric coverage and preserves legacy renormalization", () => {
	const promptProfile = profile(weights({ coding_index: 0.6, terminalbench_hard: 0.4 }));
	const model = aaModel({ codingIndex: 80, terminalbenchHard: undefined });
	const stats: DatasetStats = { metrics: { coding_index: { min: 0, max: 100 }, terminalbench_hard: { min: 0, max: 100 } } };
	const attribution = benchmarkAttributionForAaModel(model, promptProfile, stats);

	assert.ok(Math.abs(attribution.score - 0.8) < 1e-12);
	assert.equal(attribution.totalRequestedWeight, 1);
	assert.equal(attribution.availableWeight, 0.6);
	assert.equal(attribution.coverage, 0.6);
	assert.equal(attribution.items.find((item) => item.key === "coding_index")?.effectiveWeight, 1);
	assert.equal(attribution.items.find((item) => item.key === "terminalbench_hard")?.status, "missing-metric");
	assert.equal(attribution.items.find((item) => item.key === "terminalbench_hard")?.contribution, 0);
});

/*
 * Compares the new shared score implementation against a frozen copy of the 1.1.1 formula across
 * zero values, missing metrics, singleton ranges, and missing normalization ranges.
 */
test("benchmark attribution remains numerically identical to the 1.1.1 formula", () => {
	const cases: Array<{ model: AaModel; profile: PromptProfile; stats: DatasetStats }> = [
		{
			model: aaModel({ codingIndex: 0, terminalbenchHard: 75 }),
			profile: profile(weights({ coding_index: 0.5, terminalbench_hard: 0.5 })),
			stats: { metrics: { coding_index: { min: 0, max: 100 }, terminalbench_hard: { min: 0, max: 100 } } },
		},
		{
			model: aaModel({ codingIndex: 55, terminalbenchHard: undefined }),
			profile: profile(weights({ coding_index: 0.25, terminalbench_hard: 0.75 })),
			stats: { metrics: { coding_index: { min: 0, max: 100 } } },
		},
		{
			model: aaModel({ codingIndex: 10 }),
			profile: profile(weights({ coding_index: 1 })),
			stats: { metrics: { coding_index: { min: 10, max: 10 } } },
		},
		{
			model: aaModel({ codingIndex: 90 }),
			profile: profile(weights({ coding_index: 1 })),
			stats: { metrics: {} },
		},
	];

	for (const fixture of cases) {
		const expected = legacyBenchmarkScore(fixture.model, fixture.profile, fixture.stats);
		const actual = benchmarkAttributionForAaModel(fixture.model, fixture.profile, fixture.stats);
		assert.ok(Math.abs(actual.score - expected) < 1e-12, `${actual.score} !== ${expected}`);
		assert.ok(Math.abs(actual.items.reduce((total, item) => total + item.contribution, 0) - actual.score) < 1e-12);
	}
});

/*
 * Verifies the initial schema constants cover the complete benchmark registry and the attribution
 * builder has no prompt input or prompt-shaped output.
 */
test("trace contracts start at schema version one and never infer prompt content", () => {
	assert.equal(DECISION_TRACE_SCHEMA_VERSION, 1);
	assert.equal(DECISION_TRACE_MAX_BENCHMARKS, benchmarkKeys.length);
	assert.equal("prompt" in buildBenchmarkAttribution({
		weights: weights(),
		metricFor: () => undefined,
		rangeFor: () => undefined,
		labelFor: (key) => BENCHMARK_LABELS[key],
		normalize: () => 0,
	}), false);
});

function traceCandidate(id: string, benchmarkAttribution: ReturnType<typeof benchmarkAttributionForAaModel>, composite: number): Candidate {
	return {
		piModel: {
			provider: "openrouter",
			id,
			name: id,
			reasoning: false,
			input: ["text"],
			cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
		} as Candidate["piModel"],
		candidateThinkingLevel: "medium",
		requestedThinkingLevel: "medium",
		aaModel: aaModel({ slug: `${id}-aa`, name: `${id} AA`, shortName: id, hostLabel: "OpenRouter" }),
		aaMatchScore: 1,
		aaVariantLevel: "medium",
		aaEvidenceScope: "host-verified",
		benchmarkScore: benchmarkAttribution.score,
		benchmarkAttribution,
		price: 1,
		contextWindow: 128_000,
		economicScore: 0.5,
		speedScore: 0.5,
		latencyScore: 0.5,
		contextScore: 0.5,
		scoreBreakdown: { quality: 0.4, cost: 0.1, speed: 0.05, latency: 0.05, context: 0.05, match: 0.7 },
		confidence: { match: 0.8, constraints: 0.9, cost: 1, overall: 0.87, notes: [] },
		reasonBits: ["thinking medium", "AA host OpenRouter"],
		objectiveScore: composite,
		composite,
	};
}

/*
 * Verifies a successful route becomes a strict, bounded, redacted trace that rejects undeclared
 * prompt text and supplies the same plain explanation to every extension mode.
 */
test("decision trace builder emits a strict redacted snapshot and shared explanation", () => {
	const promptProfile = {
		...profile(weights({ coding_index: 0.6, terminalbench_hard: 0.4 })),
		analysisNotes: ["coding evidence"],
		complexityScore: 0.55,
		routingTier: "standard",
		uncertain: false,
		classifierSource: "heuristic",
	};
	const stats: DatasetStats = { metrics: { coding_index: { min: 0, max: 100 }, terminalbench_hard: { min: 0, max: 100 } } };
	const bestAttribution = benchmarkAttributionForAaModel(aaModel({ codingIndex: 90, terminalbenchHard: 80 }), promptProfile, stats);
	const runnerAttribution = benchmarkAttributionForAaModel(aaModel({ codingIndex: 70, terminalbenchHard: undefined }), promptProfile, stats);
	const best = traceCandidate("best", bestAttribution, 0.82);
	const runner = traceCandidate("runner", runnerAttribution, 0.75);
	best.objectiveRank = 1;
	runner.objectiveRank = 2;

	const trace = buildDecisionTraceV1({
		decisionId: "decision-test-1",
		timestamp: 1_721_000_000_000,
		promptCharacters: 137,
		hasImages: false,
		profile: promptProfile,
		providerScopeMode: "configured-provider",
		providerScopeLabel: "routing provider openrouter",
		availableModelCount: 2,
		availableRouteCount: 2,
		dataSourceLabel: "fixture",
		datasetFetchedAt: 1_720_999_000_000,
		datasetProvenance: "fresh-cache",
		objective: "balanced",
		recommendationBasis: "objective-ranking",
		best,
		applied: best,
		applicationOrigin: "auto-accept",
		actualThinkingLevel: "medium",
		topCandidates: [best, runner],
	});

	assert.equal(isDecisionTraceV1(trace), true);
	assert.ok(Buffer.byteLength(JSON.stringify(trace), "utf8") < 128 * 1024);
	assert.deepEqual(Object.keys(trace.prompt).sort(), ["characters", "contextMode", "followUpDisposition", "hasImages"]);
	assert.equal(JSON.stringify(trace).includes("sensitive prompt text"), false);
	assert.equal(trace.candidates[0]?.benchmarkAttribution.coverage, 1);
	assert.equal(trace.candidates[1]?.benchmarkAttribution.coverage, 0.6);
	const explanation = formatDecisionTraceV1(trace).join("\n");
	assert.match(explanation, /Profile · moderate detected complexity · detected score 55% · thinking medium · evidence recognized/);
	assert.match(explanation, /Benchmark evidence · fit 86% · coverage 100%/);
	assert.match(explanation, /Coding .* contribution/);
	assert.match(explanation, /Runner-up/);

	const unknownUncertainty = structuredClone(trace);
	delete unknownUncertainty.profile.uncertain;
	assert.equal(isDecisionTraceV1(unknownUncertainty), true);
	assert.match(formatDecisionTraceV1(unknownUncertainty).join("\n"), /uncertainty unknown/);

	const withRawPrompt = structuredClone(trace) as unknown as { prompt: Record<string, unknown> };
	withRawPrompt.prompt.text = "sensitive prompt text";
	assert.equal(isDecisionTraceV1(withRawPrompt), false);
	const missingBenchmark = structuredClone(trace);
	missingBenchmark.candidates[0]!.benchmarkAttribution.items.pop();
	assert.equal(isDecisionTraceV1(missingBenchmark), false);
	const inconsistentComposite = structuredClone(trace);
	inconsistentComposite.candidates[0]!.composite += 0.1;
	assert.equal(isDecisionTraceV1(inconsistentComposite), false);
	const sparseCandidates = structuredClone(trace);
	sparseCandidates.candidates = new Array(1) as typeof sparseCandidates.candidates;
	assert.equal(isDecisionTraceV1(sparseCandidates), false);
});

/*
 * Verifies non-decision routing outcomes such as exact follow-up preservation and abstention remain
 * visible without storing prompt text or pretending the previous successful decision was new.
 */
test("routing attempt trace explains skipped and successful outcomes without prompt text", () => {
	const followUp = buildRoutingAttemptTraceV1({
		attemptId: "attempt-follow-up",
		timestamp: 1_721_000_000_000,
		promptCharacters: 8,
		hasImages: false,
		outcome: "exact-follow-up-kept",
	});
	assert.equal(isRoutingAttemptTraceV1(followUp), true);
	assert.equal(followUp.routeAction, "current-route-kept");
	assert.equal(followUp.decisionId, undefined);
	assert.match(formatRoutingAttemptTraceV1(followUp).join("\n"), /exact continuation follow-up/);
	assert.deepEqual(Object.keys(followUp.prompt).sort(), ["characters", "contextMode", "hasImages"]);

	const limitedEvidence = buildRoutingAttemptTraceV1({
		attemptId: "attempt-limited-profile",
		promptCharacters: 56,
		hasImages: false,
		outcome: "insufficient-profile-evidence",
	});
	assert.equal(isRoutingAttemptTraceV1(limitedEvidence), true);
	assert.equal(limitedEvidence.reason, "profile-evidence-insufficient");
	assert.equal(limitedEvidence.routeAction, "current-route-kept");
	assert.match(formatRoutingAttemptTraceV1(limitedEvidence).join("\n"), /unclassified with limited evidence/);

	const decision = buildRoutingAttemptTraceV1({
		attemptId: "attempt-decision",
		promptCharacters: 42,
		hasImages: true,
		outcome: "decision",
		decisionId: "decision-42",
	});
	assert.equal(isRoutingAttemptTraceV1(decision), true);
	assert.equal(decision.routeAction, "decision-recorded");
	assert.equal(decision.decisionId, "decision-42");

	const leaked = structuredClone(followUp) as unknown as { prompt: Record<string, unknown> };
	leaked.prompt.text = "continue";
	assert.equal(isRoutingAttemptTraceV1(leaked), false);
});
