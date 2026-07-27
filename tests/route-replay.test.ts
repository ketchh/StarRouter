import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	DEFAULT_CONFIG,
	buildStats,
	chooseRoute,
	clearAaMatchCache,
	countAvailableRoutes,
	pickAaMatchForPiModel,
	populateRouteSelectionObservability,
	type AaDataset,
	type AaModel,
	type BenchmarkKey,
	type PromptProfile,
	type RouterConfig,
} from "../src/router-core.ts";
import { buildDecisionTraceV1 } from "../src/decision-trace.ts";
import {
	ROUTE_REPLAY_MAX_MATCH_WORK,
	ROUTE_REPLAY_MAX_MODELS,
	ROUTE_REPLAY_MAX_PROFILES_PER_AA_MODEL,
	buildRouteReplayBundleV1,
	captureRouteReplayV1,
	defaultRouteReplayPath,
	formatRouteReplayResultV1,
	isRouteReplayBundleV1,
	readRouteReplayBundleV1,
	replayRouteBundleV1,
	resolveRouteReplayPath,
	writeRouteReplayBundleV1,
	type RouteReplayCaptureV1,
} from "../src/route-replay.ts";

const benchmarkKeys: BenchmarkKey[] = [
	"intelligence_index", "agentic_index", "coding_index", "gdpval_normalized", "tau2",
	"terminalbench_hard", "scicode", "livecodebench", "ifbench", "omniscience", "gpqa", "hle", "critpt", "lcr",
];

function weights(overrides: Partial<Record<BenchmarkKey, number>>): Record<BenchmarkKey, number> {
	return Object.fromEntries(benchmarkKeys.map((key) => [key, overrides[key] ?? 0])) as Record<BenchmarkKey, number>;
}

function model(id = "openai/gpt-5.5"): Model<Api> {
	return {
		api: "openai-completions",
		provider: "openrouter",
		id,
		name: id,
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	} as Model<Api>;
}

function aaModel(): AaModel {
	return {
		sourceMode: "api",
		slug: "gpt-5-5-non-reasoning",
		name: "GPT-5.5 (Non-reasoning)",
		shortName: "GPT-5.5",
		creatorName: "OpenAI",
		hostLabel: "OpenRouter",
		hostSlug: "openrouter",
		ifbench: 85,
		contextWindowTokens: 128_000,
		priceBlendedPer1M: 1.5,
		reasoningModel: false,
		inputModalityImage: false,
		performanceByPromptLength: [{
			promptLengthType: "medium",
			medianOutputSpeed: 80,
			medianEndToEndResponseTime: 4,
		}],
	};
}

function promptProfile(): PromptProfile {
	return {
		summary: "tier:simple • simple-output • think:off",
		matchedSignals: ["simple-output"],
		analysisNotes: ["cheap/simple rewrite or extraction task"],
		benchmarkWeights: weights({ ifbench: 1 }),
		priorities: {
			costSensitivity: 0.8,
			speedSensitivity: 0.5,
			reasoningNeed: 0.1,
			contextNeed: 0.1,
			visionNeed: 0,
			toolUseNeed: 0,
			formatReliabilityNeed: 0.8,
		},
		targetThinkingLevel: "off",
		promptLengthType: "medium",
		complexityScore: 0.12,
		routingTier: "simple",
		uncertain: false,
		classifierSource: "heuristic",
	};
}

function config(): RouterConfig {
	const value = structuredClone(DEFAULT_CONFIG) as RouterConfig;
	value.strategy = {
		objective: "balanced",
		qualityFloor: 0.3,
		preferCurrentWithin: 0,
		minAaMatch: 0.2,
		minRouteConfidence: 0,
		routingProvider: "openrouter",
	};
	value.modelOverrides = {};
	return value;
}

function replayInputHash(input: unknown, trace: unknown): string {
	const replayTrace = trace as { profile: unknown; prompt: unknown };
	return createHash("sha256").update(JSON.stringify({
		input,
		profile: replayTrace.profile,
		prompt: replayTrace.prompt,
	})).digest("hex");
}

function replayCapture(): RouteReplayCaptureV1 {
	const current = model();
	const models = [current];
	const row = aaModel();
	const dataset: AaDataset = {
		fetchedAt: Date.now() - 1_000,
		sourceKey: "fixture-source",
		sourceLabel: "fixture dataset",
		models: [row],
		provenance: "fresh-cache",
	};
	const stats = buildStats(dataset.models);
	const profile = promptProfile();
	const routeConfig = config();
	const selection = chooseRoute(models, dataset.models, stats, profile, routeConfig, current, "off", false);
	assert.ok(selection);
	populateRouteSelectionObservability(selection, profile, stats, routeConfig.strategy.objective);
	const trace = buildDecisionTraceV1({
		decisionId: "replay-decision-1",
		timestamp: Date.now(),
		promptCharacters: 37,
		hasImages: false,
		profile,
		providerScopeMode: "configured-provider",
		providerScopeLabel: "routing provider openrouter",
		availableModelCount: models.length,
		availableRouteCount: countAvailableRoutes(models),
		dataSourceLabel: dataset.sourceLabel,
		datasetFetchedAt: dataset.fetchedAt,
		datasetProvenance: dataset.provenance,
		objective: routeConfig.strategy.objective,
		recommendationBasis: selection.recommendationBasis,
		best: selection.best,
		applied: selection.best,
		applicationOrigin: "auto-accept",
		actualThinkingLevel: selection.best.candidateThinkingLevel,
		topCandidates: selection.topCandidates,
	});
	return captureRouteReplayV1({
		trace,
		models,
		currentModel: current,
		currentThinkingLevel: "off",
		dataset,
		datasetStats: stats,
		config: routeConfig,
	});
}

/*
 * Verifies a route decision can be materialized and re-executed offline with identical route,
 * ranking, benchmark coverage, objective score, and composite score.
 */
test("route replay reproduces the deterministic kernel decision", () => {
	const bundle = buildRouteReplayBundleV1(replayCapture());
	const result = replayRouteBundleV1(bundle);

	assert.equal(isRouteReplayBundleV1(bundle), true);
	assert.equal(result.matches, true, result.deltas.join("\n"));
	assert.deepEqual(result.deltas, []);
	assert.match(formatRouteReplayResultV1("fixture.json", result).join("\n"), /zero route\/score deltas/);
	assert.equal("promptText" in bundle.input, false);
	assert.doesNotMatch(JSON.stringify(bundle), /Rewrite this email briefly/);
});

/*
 * Verifies explicit replay export uses bounded safe JSON, an atomic private file mode, and survives
 * a read/validate round trip without changing its integrity hash.
 */
test("route replay bundle round-trips through private atomic storage", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "starrouter-replay-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const path = join(directory, "nested", "decision.json");
	const bundle = buildRouteReplayBundleV1(replayCapture());

	writeRouteReplayBundleV1(path, bundle);
	const restored = readRouteReplayBundleV1(path);

	assert.equal(statSync(path).mode & 0o777, 0o600);
	assert.equal(restored.inputSha256, bundle.inputSha256);
	assert.equal(replayRouteBundleV1(restored).matches, true);
	assert.match(readFileSync(path, "utf8"), /"schemaVersion": 1/);
});

/*
 * Verifies input tampering, undeclared prompt fields, and unsafe JSON object keys fail closed before
 * any replay can reach the deterministic kernel.
 */
test("route replay validation rejects tampering and unsafe content", (t) => {
	const bundle = buildRouteReplayBundleV1(replayCapture());
	const tampered = structuredClone(bundle);
	tampered.input.models[0]!.id = "changed-model";
	assert.equal(isRouteReplayBundleV1(tampered), false);

	const promptLeak = structuredClone(bundle) as unknown as { trace: { prompt: Record<string, unknown> } };
	promptLeak.trace.prompt.text = "secret";
	assert.equal(isRouteReplayBundleV1(promptLeak), false);

	const nestedLeak = structuredClone(bundle) as unknown as {
		input: { dataset: { promptText?: string; models: Array<{ promptText?: string }> } };
		inputSha256: string;
	};
	nestedLeak.input.dataset.promptText = "secret dataset prompt";
	nestedLeak.input.dataset.models[0]!.promptText = "secret model prompt";
	nestedLeak.inputSha256 = replayInputHash(nestedLeak.input, bundle.trace);
	assert.equal(isRouteReplayBundleV1(nestedLeak), false);

	const controlInjection = structuredClone(bundle);
	controlInjection.trace.recommendation.modelId = "model\n\u001b[31mspoof";
	assert.equal(isRouteReplayBundleV1(controlInjection), false);

	const profileTamper = structuredClone(bundle);
	profileTamper.trace.profile.priorities.costSensitivity = 0.01;
	assert.equal(isRouteReplayBundleV1(profileTamper), false);

	const sparsePool = structuredClone(bundle);
	sparsePool.input.models = new Array(1) as typeof sparsePool.input.models;
	sparsePool.inputSha256 = replayInputHash(sparsePool.input, sparsePool.trace);
	assert.equal(isRouteReplayBundleV1(sparsePool), false);

	const oversizedPool = structuredClone(bundle);
	oversizedPool.input.models = Array.from({ length: ROUTE_REPLAY_MAX_MODELS + 1 }, () => structuredClone(bundle.input.models[0]!));
	oversizedPool.inputSha256 = replayInputHash(oversizedPool.input, oversizedPool.trace);
	assert.equal(isRouteReplayBundleV1(oversizedPool), false);

	const excessiveWork = structuredClone(bundle);
	excessiveWork.input.models = Array.from({ length: ROUTE_REPLAY_MAX_MODELS }, () => structuredClone(bundle.input.models[0]!));
	excessiveWork.input.dataset.models = Array.from(
		{ length: Math.floor(ROUTE_REPLAY_MAX_MATCH_WORK / ROUTE_REPLAY_MAX_MODELS) + 1 },
		() => structuredClone(bundle.input.dataset.models[0]!),
	);
	excessiveWork.trace.scope.availableModelCount = excessiveWork.input.models.length;
	excessiveWork.trace.scope.availableRouteCount = excessiveWork.input.models.length;
	excessiveWork.inputSha256 = replayInputHash(excessiveWork.input, excessiveWork.trace);
	assert.equal(isRouteReplayBundleV1(excessiveWork), false);

	const profileHeavy = replayCapture();
	profileHeavy.dataset.models[0]!.performanceByPromptLength = Array.from(
		{ length: ROUTE_REPLAY_MAX_PROFILES_PER_AA_MODEL + 1 },
		() => ({ promptLengthType: "medium" as const, medianOutputSpeed: 80 }),
	);
	assert.throws(() => buildRouteReplayBundleV1(profileHeavy), /prompt profiles/);

	const directory = mkdtempSync(join(tmpdir(), "starrouter-replay-unsafe-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const path = join(directory, "unsafe.json");
	writeFileSync(path, '{"schemaVersion":1,"__proto__":{"polluted":true}}', "utf8");
	assert.throws(() => readRouteReplayBundleV1(path), /unsafe object key/);
});

/*
 * Verifies explicit export projects the validated AA schema instead of serializing arbitrary nested
 * properties that may have been attached to in-memory dataset objects.
 */
test("route replay export projects away undeclared dataset fields", () => {
	const capture = replayCapture();
	(capture.dataset as AaDataset & { promptText?: string }).promptText = "must not leave memory";
	(capture.dataset.models[0] as AaModel & { promptText?: string }).promptText = "must not be serialized";
	const bundle = buildRouteReplayBundleV1(capture);
	assert.equal("promptText" in bundle.input.dataset, false);
	assert.equal("promptText" in bundle.input.dataset.models[0]!, false);
	assert.doesNotMatch(JSON.stringify(bundle), /must not/);
});

/*
 * Verifies replay uses an isolated model-match cache and restores the warmed live cache afterward,
 * avoiding fixture retention or an unexpected cold-cache penalty on the next real route.
 */
test("route replay preserves the live AA match cache", (t) => {
	clearAaMatchCache();
	t.after(() => clearAaMatchCache());
	const liveModel = model();
	const liveRow = aaModel();
	const liveRows = [liveRow];
	const routeConfig = config();
	assert.ok(pickAaMatchForPiModel(liveModel, liveRows, "off", routeConfig));

	assert.equal(replayRouteBundleV1(buildRouteReplayBundleV1(replayCapture())).matches, true);
	Object.assign(liveRow, {
		slug: "claude-opus-9-non-reasoning",
		name: "Claude Opus 9 (Non-reasoning)",
		shortName: "Claude Opus 9",
		creatorName: "Anthropic",
	});
	assert.ok(pickAaMatchForPiModel(liveModel, liveRows, "off", routeConfig));
});

/*
 * Verifies a valid bundle can intentionally report a replay delta when its frozen candidate pool no
 * longer supports the expected recommendation, rather than silently rewriting expected evidence.
 */
test("route replay reports abstention as a deterministic delta", () => {
	const capture = replayCapture();
	capture.models = [model("unknown/no-aa-match")];
	capture.currentModel = capture.models[0];
	const bundle = buildRouteReplayBundleV1(capture);
	const result = replayRouteBundleV1(bundle);

	assert.equal(result.matches, false);
	assert.match(result.deltas.join("\n"), /replay abstained/);
});

/*
 * Verifies a portable bundle is validated against its capture timestamp rather than the verifier's
 * wall clock, avoiding temporary failures from cross-machine clock skew.
 */
test("route replay validation uses capture time rather than verifier wall clock", () => {
	const capture = replayCapture();
	const futureCapture = Date.now() + 24 * 60 * 60 * 1_000;
	capture.dataset.fetchedAt = futureCapture - 1_000;
	capture.trace.data.fetchedAt = capture.dataset.fetchedAt;
	const bundle = buildRouteReplayBundleV1(capture, futureCapture);
	assert.equal(isRouteReplayBundleV1(bundle), true);
	assert.equal(replayRouteBundleV1(bundle).matches, true);
});

/*
 * Verifies default and explicit replay paths remain deterministic, support home-relative paths, and
 * never depend on the current working directory for the default private replay location.
 */
test("route replay paths resolve explicit and default destinations", () => {
	assert.match(defaultRouteReplayPath("decision/unsafe"), /decision-unsafe\.json$/);
	assert.equal(resolveRouteReplayPath("/tmp/project", "relative/replay.json", "id"), "/tmp/project/relative/replay.json");
	assert.match(resolveRouteReplayPath("/tmp/project", undefined, "id"), /star-router\/replays\/id\.json$/);
});
