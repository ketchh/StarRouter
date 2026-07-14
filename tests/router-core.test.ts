import test from "node:test";
import assert from "node:assert/strict";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	DEFAULT_CONFIG,
	buildStats,
	buildWinnerReasonLines,
	chooseRoute,
	clearAaMatchCache,
	getProviderScopedModels,
	getSupportedThinkingLevelsForModel,
	isContextDependentFollowUp,
	normalizeAaModelsForRouting,
	normalizeRouterConfig,
	paretoFrontierCandidates,
	pickAaMatchForPiModel,
	rankCandidatesForObjective,
	shouldPreferCurrentCandidate,
	type AaModel,
	type Candidate,
	type PromptProfile,
	type RouterConfig,
} from "../src/router-core.ts";
import { applyBuiltInModelFilterPreset, applyModelFilters, getProviderFilterConfig, inferModelFamily, normalizeModelFilters, setModelFilterEnabled, setProviderSavedFilterPreset } from "../src/model-filters-screen.ts";

function cloneConfig(overrides: any = {}): RouterConfig {
	return normalizeRouterConfig({
		...structuredClone(DEFAULT_CONFIG),
		...overrides,
		strategy: { ...structuredClone(DEFAULT_CONFIG.strategy), ...(overrides.strategy ?? {}) },
		dataSource: { ...structuredClone(DEFAULT_CONFIG.dataSource), ...(overrides.dataSource ?? {}) },
		ui: { ...structuredClone(DEFAULT_CONFIG.ui), ...(overrides.ui ?? {}) },
		filters: overrides.filters ?? structuredClone(DEFAULT_CONFIG.filters),
		modelOverrides: { ...structuredClone(DEFAULT_CONFIG.modelOverrides), ...(overrides.modelOverrides ?? {}) },
	} as RouterConfig);
}

function model(params: Partial<Model<Api>> & Pick<Model<Api>, "provider" | "id" | "name">): Model<Api> {
	return {
		api: "openai-completions",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
		...params,
	} as Model<Api>;
}

function aa(params: Partial<AaModel> & Pick<AaModel, "slug" | "name" | "shortName">): AaModel {
	return {
		sourceMode: "api",
		creatorName: "OpenRouter",
		hostLabel: "OpenRouter",
		hostSlug: "openrouter",
		intelligenceIndex: 50,
		agenticIndex: 50,
		codingIndex: 50,
		gdpvalNormalized: 50,
		tau2: 50,
		terminalbenchHard: 50,
		scicode: 50,
		livecodebench: 50,
		ifbench: 50,
		omniscience: 50,
		gpqa: 50,
		hle: 50,
		critpt: 50,
		lcr: 50,
		contextWindowTokens: 128_000,
		priceBlendedPer1M: 1,
		reasoningModel: false,
		inputModalityImage: false,
		performanceByPromptLength: [
			{ promptLengthType: "medium", medianOutputSpeed: 100, medianEndToEndResponseTime: 4 },
			{ promptLengthType: "medium_coding", medianOutputSpeed: 80, medianEndToEndResponseTime: 6 },
			{ promptLengthType: "long", medianOutputSpeed: 60, medianEndToEndResponseTime: 12 },
			{ promptLengthType: "vision_single_image", medianOutputSpeed: 50, medianEndToEndResponseTime: 10 },
		],
		...params,
	};
}

function fakeCandidateForPareto(id: string): Candidate {
	return {
		piModel: model({ provider: "openrouter", id, name: id }),
		candidateThinkingLevel: "off",
		requestedThinkingLevel: "off",
		aaModel: aa({ slug: id, name: id, shortName: id }),
		aaMatchScore: 1,
		aaVariantLevel: "off",
		aaEvidenceScope: "host-verified",
		benchmarkScore: 0,
		price: 1,
		contextWindow: 128_000,
		economicScore: 0,
		speedScore: 0,
		latencyScore: 0,
		contextScore: 0,
		scoreBreakdown: { quality: 0, cost: 0, speed: 0, latency: 0, context: 0, match: 1 },
		reasonBits: [],
		composite: 0,
	};
}

const simpleProfile: PromptProfile = {
	summary: "tier:simple • complexity:12% • simple-output • think:off",
	matchedSignals: ["simple-output"],
	benchmarkWeights: {
		intelligence_index: 0,
		agentic_index: 0,
		coding_index: 0,
		gdpval_normalized: 0,
		tau2: 0,
		terminalbench_hard: 0,
		scicode: 0,
		livecodebench: 0,
		ifbench: 1,
		omniscience: 0,
		gpqa: 0,
		hle: 0,
		critpt: 0,
		lcr: 0,
	},
	priorities: {
		costSensitivity: 0.9,
		speedSensitivity: 0.7,
		reasoningNeed: 0.1,
		contextNeed: 0.1,
		visionNeed: 0,
		toolUseNeed: 0.05,
		formatReliabilityNeed: 0.85,
	},
	targetThinkingLevel: "off",
	promptLengthType: "medium",
	complexityScore: 0.12,
	routingTier: "simple",
	classifierSource: "heuristic",
};

const codingProfile: PromptProfile = {
	...simpleProfile,
	summary: "tier:standard • coding • think:medium",
	matchedSignals: ["coding"],
	benchmarkWeights: { ...simpleProfile.benchmarkWeights, ifbench: 0, coding_index: 0.55, terminalbench_hard: 0.45 },
	priorities: { ...simpleProfile.priorities, costSensitivity: 0.25, speedSensitivity: 0.25, reasoningNeed: 0.55 },
	targetThinkingLevel: "medium",
	promptLengthType: "medium_coding",
	complexityScore: 0.55,
	routingTier: "standard",
};

/*
 * Verifies that supported thinking levels come from pi model metadata and hide unsupported levels.
 */
test("supported thinking levels respect model reasoning and thinkingLevelMap", () => {
	const nonReasoning = model({ provider: "openrouter", id: "fast-model", name: "Fast" });
	const reasoning = model({
		provider: "openrouter",
		id: "reasoning-model",
		name: "Reasoning",
		reasoning: true,
		thinkingLevelMap: { minimal: null, low: null, xhigh: "xhigh", max: "max" },
	});

	assert.deepEqual(getSupportedThinkingLevelsForModel(nonReasoning), ["off"]);
	assert.deepEqual(getSupportedThinkingLevelsForModel(reasoning), ["off", "medium", "high", "xhigh", "max"]);
});

/*
 * Verifies that short context-dependent follow-ups do not trigger unnecessary automatic routing.
 */
test("context-dependent follow-ups are detected", () => {
	assert.equal(isContextDependentFollowUp("continue"), true);
	assert.equal(isContextDependentFollowUp("retry"), true);
	assert.equal(isContextDependentFollowUp("continue with the security review"), false);
	assert.equal(isContextDependentFollowUp("okay, now refactor src/router.ts"), false);
	assert.equal(isContextDependentFollowUp("design a new architecture"), false);
});

/*
 * Verifies that duplicate rows are merged only inside the same AA host, preserving real host
 * economics instead of manufacturing a best-of-all-hosts synthetic route.
 */
test("AA normalization deduplicates only within the same host", () => {
	const normalized = normalizeAaModelsForRouting([
		aa({ slug: "same-model", name: "Same Model", shortName: "Same", hostLabel: "OpenRouter", hostSlug: "openrouter", hostApiId: "shared-id", codingIndex: 70, priceBlendedPer1M: 2, contextWindowTokens: 100_000, performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: 50, medianEndToEndResponseTime: 8 }] }),
		aa({ slug: "same-model", name: "Same Model", shortName: "Same", hostLabel: "OpenRouter", hostSlug: "openrouter", hostApiId: "different-model-api-id", codingIndex: 82, priceBlendedPer1M: 1, contextWindowTokens: 1_000_000, performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: 90, medianEndToEndResponseTime: 3 }] }),
		aa({ slug: "same-model", name: "Same Model", shortName: "Same", hostLabel: "Anthropic", hostSlug: "anthropic", hostApiId: "shared-id", codingIndex: 99, priceBlendedPer1M: 9, contextWindowTokens: 200_000 }),
	]);

	assert.equal(normalized.length, 2);
	const openRouter = normalized.find((entry) => entry.hostSlug === "openrouter");
	const anthropic = normalized.find((entry) => entry.hostSlug === "anthropic");
	assert.equal(openRouter?.hostLabel, "OpenRouter");
	assert.equal(openRouter?.codingIndex, 82);
	assert.equal(openRouter?.priceBlendedPer1M, 1);
	assert.equal(openRouter?.contextWindowTokens, 1_000_000);
	assert.equal(openRouter?.performanceByPromptLength[0]?.medianOutputSpeed, 90);
	assert.equal(anthropic?.codingIndex, 99);
	assert.equal(anthropic?.priceBlendedPer1M, 9);
});

/*
 * Verifies that the Pareto frontier removes candidates dominated across quality, economics,
 * throughput, latency, and context before objective tie-breaking.
 */
test("Pareto frontier removes fully dominated candidates", () => {
	const strong = { ...fakeCandidateForPareto("strong"), benchmarkScore: 0.9, economicScore: 0.9, speedScore: 0.9, latencyScore: 0.9, contextScore: 0.9 };
	const dominated = { ...fakeCandidateForPareto("dominated"), benchmarkScore: 0.82, economicScore: 0.8, speedScore: 0.82, latencyScore: 0.83, contextScore: 0.84 };
	const frontier = paretoFrontierCandidates([strong, dominated]);

	assert.deepEqual(frontier.map((candidate) => candidate.piModel.id), ["strong"]);
});

/*
 * Verifies that a high-throughput route remains on the frontier for the fastest objective even
 * when another route is better on end-to-end latency and the other dimensions.
 */
test("Pareto frontier preserves throughput trade-offs", () => {
	const lowLatency = { ...fakeCandidateForPareto("low-latency"), benchmarkScore: 0.9, economicScore: 0.9, speedScore: 0.25, latencyScore: 0.95, contextScore: 0.9 };
	const highThroughput = { ...fakeCandidateForPareto("high-throughput"), benchmarkScore: 0.82, economicScore: 0.82, speedScore: 0.95, latencyScore: 0.84, contextScore: 0.82 };
	const frontier = paretoFrontierCandidates([lowLatency, highThroughput]);

	assert.deepEqual(frontier.map((candidate) => candidate.piModel.id), ["low-latency", "high-throughput"]);
});

/*
 * Verifies that explicit modelOverrides take precedence over heuristic alias matching.
 */
test("AA matching honors explicit model overrides", () => {
	clearAaMatchCache();
	const config = cloneConfig({
		strategy: { minAaMatch: 0.52 },
		modelOverrides: { "openrouter/custom-fast@off": "custom-fast-aa" },
	});
	const piModel = model({ provider: "openrouter", id: "custom-fast", name: "Custom Fast" });
	const aaModels = [aa({ slug: "custom-fast-aa", name: "Custom Fast AA", shortName: "Custom Fast" })];

	const match = pickAaMatchForPiModel(piModel, aaModels, "off", config);

	assert.equal(match?.aaModel.slug, "custom-fast-aa");
	assert.equal(match?.overrideApplied, true);
	assert.equal(match?.hostVerified, true);
	assert.ok((match?.matchScore ?? 0) >= config.strategy.minAaMatch);
});

/*
 * Verifies that AA match caching fingerprints the full identity set instead of reusing a result for
 * two same-sized catalogs that merely share their first and last slugs.
 */
test("AA match cache distinguishes identity and metric updates", () => {
	clearAaMatchCache();
	const config = cloneConfig({ strategy: { minAaMatch: 0.9 } });
	const piModel = model({ provider: "openrouter", id: "custom-target", name: "Custom Target" });
	const first = aa({ slug: "first-row", name: "First Row", shortName: "First" });
	const last = aa({ slug: "last-row", name: "Last Row", shortName: "Last" });
	const matching = aa({ slug: "custom-target", name: "Custom Target", shortName: "Custom Target", codingIndex: 70 });
	const changedIdentity = aa({ slug: "different-target", name: "Different Target", shortName: "Different" });
	const changedMetrics = { ...matching, codingIndex: 95, priceBlendedPer1M: 0.25 };

	const firstMatch = pickAaMatchForPiModel(piModel, [first, matching, last], "off", config);
	const metricMatch = pickAaMatchForPiModel(piModel, [first, changedMetrics, last], "off", config);
	assert.equal(firstMatch?.aaModel.slug, "custom-target");
	assert.equal(metricMatch?.aaModel.codingIndex, 95);
	assert.equal(metricMatch?.aaModel.priceBlendedPer1M, 0.25);
	assert.equal(pickAaMatchForPiModel(piModel, [first, changedIdentity, last], "off", config), undefined);
});

/*
 * Verifies that provider host affinity selects the real matching host row and does not treat the
 * model creator as if it were the serving host.
 */
test("AA matching preserves provider-specific host economics", () => {
	clearAaMatchCache();
	const config = cloneConfig({ strategy: { minAaMatch: 0.35 } });
	const piModel = model({ provider: "openrouter", id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5" });
	const aaModels = [
		aa({ slug: "claude-haiku-4-5-non-reasoning", name: "Claude Haiku 4.5 (Non-reasoning)", shortName: "Haiku", creatorName: "Anthropic", hostLabel: "Anthropic", hostSlug: "anthropic", priceBlendedPer1M: 9 }),
		aa({ slug: "claude-haiku-4-5-non-reasoning", name: "Claude Haiku 4.5 (Non-reasoning)", shortName: "Haiku", creatorName: "Anthropic", hostLabel: "OpenRouter", hostSlug: "openrouter", priceBlendedPer1M: 2 }),
	];

	const match = pickAaMatchForPiModel(piModel, normalizeAaModelsForRouting(aaModels), "off", config);
	assert.equal(match?.aaModel.hostSlug, "openrouter");
	assert.equal(match?.aaModel.priceBlendedPer1M, 2);
});

/*
 * Verifies that the benchmark-safe preset blocks auto/free endpoints while preserving known benchmarkable families.
 */
test("benchmark-safe filters block auto/free endpoints while preserving known families", () => {
	const models = [
		model({ provider: "openrouter", id: "auto", name: "Auto" }),
		model({ provider: "openrouter", id: "openrouter/auto", name: "OpenRouter Auto" }),
		model({ provider: "openrouter", id: "google/gemini-3.1-flash-lite", name: "Gemini Flash Lite" }),
		model({ provider: "openrouter", id: "anthropic/claude-haiku-4.5", name: "Claude Haiku" }),
		model({ provider: "openrouter", id: "random-vendor/unknown-xyz", name: "Unknown" }),
	];
	const filters = applyBuiltInModelFilterPreset({ providers: {} }, "openrouter", models, "benchmark-safe");
	const enabled = applyModelFilters(models, filters).map((candidate) => candidate.id);

	assert.deepEqual(inferModelFamily(models[3]!).key, "claude-haiku");
	assert.ok(enabled.includes("google/gemini-3.1-flash-lite"));
	assert.ok(enabled.includes("anthropic/claude-haiku-4.5"));
	assert.ok(!enabled.includes("auto"));
	assert.ok(!enabled.includes("openrouter/auto"));
	assert.ok(!enabled.includes("random-vendor/unknown-xyz"));
});

/*
 * Verifies that enabling a model inside a disabled family automatically turns the family into a mixed state
 * by re-enabling the family and keeping sibling models disabled.
 */
test("enabling a model inside an off family creates a mixed family", () => {
	const filters = { providers: { openrouter: { preset: "none" as const, disabledFamilies: ["gpt-5"], disabledModels: [] } } };
	const familyModelIds = ["openai/gpt-5", "openai/gpt-5-mini", "openai/gpt-5-nano"];

	setModelFilterEnabled(filters, "openrouter", "gpt-5", "openai/gpt-5-mini", familyModelIds, true);

	const providerFilters = getProviderFilterConfig(filters, "openrouter");
	assert.ok(!providerFilters.disabledFamilies.includes("gpt-5"));
	assert.ok(!providerFilters.disabledModels.includes("openai/gpt-5-mini"));
	assert.ok(providerFilters.disabledModels.includes("openai/gpt-5"));
	assert.ok(providerFilters.disabledModels.includes("openai/gpt-5-nano"));
});

/*
 * Verifies that saved preset labels survive normalization so selecting a saved preset does not fall back
 * to the generic All available/custom label in the settings UI.
 */
test("saved filter preset metadata is retained for settings display", () => {
	const filters = { providers: { openrouter: { preset: "benchmark-safe" as const, disabledFamilies: ["auto"], disabledModels: [] } } };
	setProviderSavedFilterPreset(filters, "openrouter", "team-safe", "Team Safe");
	const normalized = normalizeModelFilters(filters);
	const providerFilters = getProviderFilterConfig(normalized, "openrouter");

	assert.equal(providerFilters.preset, "none");
	assert.equal(providerFilters.savedPresetId, "team-safe");
	assert.equal(providerFilters.savedPresetName, "Team Safe");
});

/*
 * Verifies that configured provider scope keeps only the selected provider and applies family/model filters.
 */
test("provider scoped models use routing provider and filters", () => {
	const models = [
		model({ provider: "openrouter", id: "anthropic/claude-haiku-4.5", name: "Claude Haiku" }),
		model({ provider: "openrouter", id: "openai/gpt-4o", name: "GPT-4o" }),
		model({ provider: "github-copilot", id: "gpt-5-mini", name: "GPT-5 mini" }),
	];
	const config = cloneConfig({
		strategy: { routingProvider: "openrouter" },
		filters: { providers: { openrouter: { preset: "none", disabledFamilies: ["gpt-4o"], disabledModels: [] } } },
	});

	const scoped = getProviderScopedModels(models, undefined, config);

	assert.equal(scoped.availableModelCount, 1);
	assert.equal(scoped.models[0]?.id, "anthropic/claude-haiku-4.5");
	assert.equal(scoped.providerScopeMode, "configured-provider");
});

/*
 * Verifies that an unavailable configured provider abstains instead of silently routing through
 * the first authenticated provider in registry order.
 */
test("configured provider is a strict routing boundary", () => {
	const config = cloneConfig({ strategy: { routingProvider: "github-copilot" } });
	const scoped = getProviderScopedModels(
		[model({ provider: "openrouter", id: "openai/gpt-5-mini", name: "GPT-5 mini" })],
		undefined,
		config,
	);

	assert.deepEqual(scoped.models, []);
	assert.equal(scoped.availableModelCount, 0);
	assert.equal(scoped.availableRouteCount, 0);
	assert.equal(scoped.providerScopeLabel, "routing provider unavailable");
});

/*
 * Verifies that config normalization drops retired pre-V1 feature blocks instead of letting
 * old classifier/policy/reliability settings affect the clean public router surface.
 */
test("config normalization removes retired feature blocks", () => {
	const config = cloneConfig() as RouterConfig & { classifier?: unknown; policy?: unknown; reliability?: unknown; debug?: unknown };
	config.classifier = { mode: "openai", apiKeyEnv: "OPENAI_API_KEY" };
	config.policy = { profile: "regulated-safe" };
	config.reliability = { enabled: true };
	config.debug = { enabled: true };

	const normalized = normalizeRouterConfig(config);

	assert.equal("classifier" in normalized, false);
	assert.equal("policy" in normalized, false);
	assert.equal("reliability" in normalized, false);
	assert.equal("debug" in normalized, false);
});

/*
 * Verifies that simple non-coding tasks prefer efficient models even when a frontier model has slightly higher benchmark fit.
 */
test("simple non-coding route favors efficient low-cost models", () => {
	clearAaMatchCache();
	const models = [
		model({ provider: "openrouter", id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", cost: { input: 0.14, output: 0.28, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_048_576 }),
		model({ provider: "openrouter", id: "openai/gpt-5.5-pro", name: "GPT-5.5 Pro", reasoning: true, cost: { input: 5, output: 25, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_100_000, thinkingLevelMap: { xhigh: "max" } }),
	];
	const aaModels = [
		aa({ slug: "baseline-weak", name: "Baseline Weak", shortName: "Weak", ifbench: 50, priceBlendedPer1M: 1 }),
		aa({ slug: "deepseek-v4-flash", name: "DeepSeek V4 Flash", shortName: "DeepSeek Flash", ifbench: 82, priceBlendedPer1M: 0.2, contextWindowTokens: 1_048_576 }),
		aa({ slug: "gpt-5-5-pro", name: "GPT-5.5 Pro", shortName: "GPT-5.5 Pro", ifbench: 90, priceBlendedPer1M: 10, reasoningModel: true, contextWindowTokens: 1_100_000 }),
	];
	const config = cloneConfig({ strategy: { objective: "balanced", minAaMatch: 0.35, qualityFloor: 0.88 } });
	const result = chooseRoute(models, aaModels, buildStats(aaModels), simpleProfile, config, undefined, "off", false);

	assert.equal(result?.best.piModel.id, "deepseek/deepseek-v4-flash");
	assert.ok(["off", "minimal", "low"].includes(result?.best.candidateThinkingLevel ?? ""));
});

/*
 * Verifies that the quality objective can select the strongest benchmark candidate for coding/reasoning prompts.
 */
test("quality objective prioritizes benchmark fit for coding prompts", () => {
	clearAaMatchCache();
	const models = [
		model({ provider: "openrouter", id: "qwen/qwen3-coder-plus", name: "Qwen3 Coder Plus", cost: { input: 0.65, output: 3.25, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000 }),
		model({ provider: "openrouter", id: "openai/gpt-5.1-codex", name: "GPT-5.1 Codex", reasoning: true, cost: { input: 1.25, output: 10, cacheRead: 0, cacheWrite: 0 }, contextWindow: 400_000, thinkingLevelMap: { xhigh: "max" } }),
	];
	const aaModels = [
		aa({ slug: "qwen3-coder-plus", name: "Qwen3 Coder Plus", shortName: "Qwen Coder", codingIndex: 75, terminalbenchHard: 72, priceBlendedPer1M: 1.2, contextWindowTokens: 1_000_000 }),
		aa({ slug: "gpt-5-1-codex", name: "GPT-5.1 Codex", shortName: "GPT Codex", codingIndex: 95, terminalbenchHard: 92, priceBlendedPer1M: 4, reasoningModel: true, contextWindowTokens: 400_000 }),
	];
	const config = cloneConfig({ strategy: { objective: "quality", minAaMatch: 0.35, qualityFloor: 0.8 } });
	const result = chooseRoute(models, aaModels, buildStats(aaModels), codingProfile, config, undefined, "medium", false);

	assert.equal(result?.best.piModel.id, "openai/gpt-5.1-codex");
});

/*
 * Verifies debugging specialization remains a soft bonus: quality mode must not delete a much
 * stronger general candidate merely because a lower-fit Codex route exists.
 */
test("debugging quality keeps the strongest benchmark fit", () => {
	clearAaMatchCache();
	const models = [
		model({ provider: "openrouter", id: "openai/gpt-5.1", name: "GPT-5.1", reasoning: true, thinkingLevelMap: { xhigh: "xhigh", max: "max" } }),
		model({ provider: "openrouter", id: "openai/gpt-5.1-codex", name: "GPT-5.1 Codex", reasoning: true, thinkingLevelMap: { xhigh: "xhigh", max: "max" } }),
	];
	const aaModels = [
		aa({ slug: "gpt-5-1-medium", name: "GPT-5.1 (medium)", shortName: "GPT-5.1", creatorName: "OpenAI", reasoningModel: true, codingIndex: 100, terminalbenchHard: 100 }),
		aa({ slug: "gpt-5-1-codex-medium", name: "GPT-5.1 Codex (medium)", shortName: "GPT Codex", creatorName: "OpenAI", reasoningModel: true, codingIndex: 1, terminalbenchHard: 1 }),
	];
	const profile: PromptProfile = {
		...codingProfile,
		matchedSignals: ["coding", "debugging"],
		priorities: { ...codingProfile.priorities, reasoningNeed: 0.7 },
		routingTier: "complex",
	};
	const config = cloneConfig({ strategy: { objective: "quality", minAaMatch: 0.2, minRouteConfidence: 0, qualityFloor: 0.3 }, modelOverrides: {} });
	const result = chooseRoute(models, aaModels, buildStats(aaModels), profile, config, undefined, "medium", false);

	assert.equal(result?.best.piModel.id, "openai/gpt-5.1");
	assert.ok((result?.best.benchmarkScore ?? 0) > 0.9);
});

/*
 * Verifies that route hysteresis compares the metric selected by the active objective rather than
 * keeping a current route merely because its balanced composite is close.
 */
test("preferCurrentWithin uses the active objective metric", () => {
	const winner = { ...fakeCandidateForPareto("winner"), composite: 0.9, benchmarkScore: 0.92, economicScore: 0.9, speedScore: 0.9, latencyScore: 0.9 };
	const current = { ...fakeCandidateForPareto("current"), composite: 0.89, benchmarkScore: 0.7, economicScore: 0.88, speedScore: 0.4, latencyScore: 0.4 };

	assert.equal(shouldPreferCurrentCandidate(winner, current, "balanced", 0.02), true);
	assert.equal(shouldPreferCurrentCandidate(winner, current, "cheapest", 0.03), true);
	assert.equal(shouldPreferCurrentCandidate(winner, current, "quality", 0.02), false);
	assert.equal(shouldPreferCurrentCandidate(winner, current, "fastest", 0.02), false);
});

/*
 * Verifies that image prompts filter out text-only models and select image-capable candidates.
 */
test("vision requirement filters out text-only models", () => {
	clearAaMatchCache();
	const textOnly = model({ provider: "openrouter", id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", input: ["text"] });
	const vision = model({ provider: "openrouter", id: "google/gemini-3.1-flash-lite", name: "Gemini Flash Lite", input: ["text", "image"] });
	const aaModels = [
		aa({ slug: "deepseek-v4-flash", name: "DeepSeek V4 Flash", shortName: "DeepSeek Flash", inputModalityImage: false }),
		aa({ slug: "gemini-3-1-flash-lite", name: "Gemini 3.1 Flash Lite", shortName: "Gemini Flash", inputModalityImage: true }),
	];
	const config = cloneConfig({ strategy: { minAaMatch: 0.35 } });
	const result = chooseRoute([textOnly, vision], aaModels, buildStats(aaModels), { ...simpleProfile, matchedSignals: ["vision"], promptLengthType: "vision_single_image", priorities: { ...simpleProfile.priorities, visionNeed: 1 } }, config, undefined, "off", true);

	assert.equal(result?.best.piModel.id, "google/gemini-3.1-flash-lite");
});

/*
 * Verifies that identity gating checks both Claude subfamily and the complete minor version,
 * rather than borrowing the nearest Sonnet or Haiku row.
 */
test("AA matching rejects Claude subfamily and minor-version drift", () => {
	clearAaMatchCache();
	const config = cloneConfig({ strategy: { minAaMatch: 0.35 } });
	const piModel = model({ provider: "openrouter", id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" });
	const aaModels = [
		aa({ slug: "claude-4-5-haiku", name: "Claude 4.5 Haiku (Non-reasoning)", shortName: "Haiku", creatorName: "Anthropic", ifbench: 90 }),
		aa({ slug: "claude-sonnet-4-6-non-reasoning", name: "Claude Sonnet 4.6 (Non-reasoning)", shortName: "Sonnet", creatorName: "Anthropic", ifbench: 70 }),
	];

	const match = pickAaMatchForPiModel(piModel, aaModels, "off", config);

	assert.equal(match, undefined);
});

/*
 * Verifies that complete minor versions remain part of identity for current GPT and Gemini families.
 */
test("AA matching rejects GPT and Gemini minor-version drift", () => {
	const config = cloneConfig({ strategy: { minAaMatch: 0.35 } });
	const cases = [
		{
			pi: model({ provider: "openrouter", id: "openai/gpt-5.1-codex", name: "GPT-5.1 Codex" }),
			aa: aa({ slug: "gpt-5-5-codex-non-reasoning", name: "GPT-5.5 Codex (Non-reasoning)", shortName: "GPT-5.5 Codex", creatorName: "OpenAI" }),
		},
		{
			pi: model({ provider: "openrouter", id: "google/gemini-3.1-pro", name: "Gemini 3.1 Pro" }),
			aa: aa({ slug: "gemini-3-2-pro-non-reasoning", name: "Gemini 3.2 Pro (Non-reasoning)", shortName: "Gemini 3.2 Pro", creatorName: "Google" }),
		},
	];

	for (const item of cases) {
		clearAaMatchCache();
		assert.equal(pickAaMatchForPiModel(item.pi, [item.aa], "off", config), undefined);
	}
});

/*
 * Verifies that a versioned Pi model cannot borrow an unversioned AA family row and that an alias
 * override does not bypass the fixed-generation identity gate.
 */
test("AA matching rejects missing generation even with an override", () => {
	clearAaMatchCache();
	const piModel = model({ provider: "openrouter", id: "openai/gpt-5.1-codex", name: "GPT-5.1 Codex" });
	const unversioned = aa({ slug: "gpt-codex-non-reasoning", name: "GPT Codex (Non-reasoning)", shortName: "GPT Codex", creatorName: "OpenAI" });
	const strictConfig = cloneConfig({ strategy: { minAaMatch: 0.35 } });
	const overrideConfig = cloneConfig({
		strategy: { minAaMatch: 0.35 },
		modelOverrides: { "openrouter/openai/gpt-5.1-codex@off": "gpt-codex-non-reasoning" },
	});

	assert.equal(pickAaMatchForPiModel(piModel, [unversioned], "off", strictConfig), undefined);
	assert.equal(pickAaMatchForPiModel(piModel, [unversioned], "off", overrideConfig), undefined);
});

/*
 * Verifies that an off route cannot borrow a reasoning AA row and that an alias override cannot
 * bypass reasoning-class parity.
 */
test("AA matching hard-gates reasoning variants even with an override", () => {
	clearAaMatchCache();
	const piModel = model({ provider: "openrouter", id: "openai/gpt-5.1-codex", name: "GPT-5.1 Codex" });
	const reasoningAa = aa({ slug: "gpt-5-1-codex", name: "GPT-5.1 Codex", shortName: "GPT Codex", creatorName: "OpenAI", reasoningModel: true });
	const strictConfig = cloneConfig({ strategy: { minAaMatch: 0.35 } });
	const overrideConfig = cloneConfig({
		strategy: { minAaMatch: 0.35 },
		modelOverrides: { "openrouter/openai/gpt-5.1-codex@off": "gpt-5-1-codex" },
	});

	assert.equal(pickAaMatchForPiModel(piModel, [reasoningAa], "off", strictConfig), undefined);
	assert.equal(pickAaMatchForPiModel(piModel, [reasoningAa], "off", overrideConfig), undefined);
});

/*
 * Verifies that numeric/version overlap alone cannot map an unrelated GLM route to Claude Sonnet 4.6.
 */
test("AA matching rejects cross-vendor numeric overlap", () => {
	clearAaMatchCache();
	const config = cloneConfig({ strategy: { minAaMatch: 0.35 } });
	const piModel = model({ provider: "openrouter", id: "z-ai/glm-4.6", name: "GLM 4.6" });
	const aaModels = [aa({ slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", shortName: "Sonnet", creatorName: "Anthropic" })];

	const match = pickAaMatchForPiModel(piModel, aaModels, "off", config);

	assert.equal(match, undefined);
});

/*
 * Verifies that same-family generation drift is rejected, so alias overrides cannot borrow
 * benchmarks across materially different model generations.
 */
test("AA matching rejects same-family generation drift", () => {
	clearAaMatchCache();
	const config = cloneConfig({ strategy: { minAaMatch: 0.35 } });
	const piModel = model({ provider: "openrouter", id: "nousresearch/hermes-3-llama-3.1-70b", name: "Nous Hermes 3 70B Instruct" });
	const aaModels = [aa({ slug: "hermes-4-llama-3-1-70b", name: "Hermes 4 - Llama-3.1 70B", shortName: "Hermes 4 70B", creatorName: "Nous Research" })];

	const match = pickAaMatchForPiModel(piModel, aaModels, "off", config);

	assert.equal(match, undefined);
});

/*
 * Verifies that moving provider aliases such as latest/free/auto are not benchmark-routable without
 * an explicit override that pins the exact Artificial Analysis row.
 */
test("AA matching rejects moving aliases without explicit override", () => {
	clearAaMatchCache();
	const config = cloneConfig({ strategy: { minAaMatch: 0.35 } });
	const piModel = model({ provider: "openrouter", id: "moonshotai/kimi-latest", name: "MoonshotAI Kimi Latest" });
	const aaModels = [aa({ slug: "kimi-k2-5-non-reasoning", name: "Kimi K2.5 (Non-reasoning)", shortName: "Kimi K2.5", creatorName: "Kimi" })];

	const match = pickAaMatchForPiModel(piModel, aaModels, "off", config);

	assert.equal(match, undefined);
});

/*
 * Verifies that an explicit override can still intentionally pin a moving alias to a known AA row.
 */
test("AA matching allows moving aliases with explicit override", () => {
	clearAaMatchCache();
	const config = cloneConfig({
		strategy: { minAaMatch: 0.35 },
		modelOverrides: { "openrouter/moonshotai/kimi-latest@off": "kimi-k2-5-non-reasoning" },
	});
	const piModel = model({ provider: "openrouter", id: "moonshotai/kimi-k2.5-latest", name: "MoonshotAI Kimi K2.5 Latest" });
	const aaModels = [aa({ slug: "kimi-k2-5-non-reasoning", name: "Kimi K2.5 (Non-reasoning)", shortName: "Kimi K2.5", creatorName: "Kimi" })];
	config.modelOverrides = { "openrouter/moonshotai/kimi-k2.5-latest@off": "kimi-k2-5-non-reasoning" };

	const match = pickAaMatchForPiModel(piModel, aaModels, "off", config);

	assert.equal(match?.aaModel.slug, "kimi-k2-5-non-reasoning");
	assert.equal(match?.movingAliasPin, true);
	assert.ok((match?.matchScore ?? 2) < 1.25);
});

/*
 * Verifies that cheapest routing still honors a reasoning floor for critical distributed-system prompts.
 */
test("critical-system cheapest route keeps medium-or-higher thinking", () => {
	clearAaMatchCache();
	const reasoning = model({
		provider: "openrouter",
		id: "deepseek/deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		reasoning: true,
		thinkingLevelMap: { xhigh: "max" },
		cost: { input: 0.4, output: 0.8, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000_000,
	});
	const aaModels = [
		aa({ slug: "deepseek-v4-pro", name: "DeepSeek V4 Pro", shortName: "DeepSeek Pro", creatorName: "DeepSeek", gdpvalNormalized: 90, tau2: 90, intelligenceIndex: 90, reasoningModel: true, contextWindowTokens: 1_000_000 }),
	];
	const profile: PromptProfile = {
		...codingProfile,
		matchedSignals: ["architecture", "security", "critical-system"],
		benchmarkWeights: { ...simpleProfile.benchmarkWeights, ifbench: 0, gdpval_normalized: 0.45, tau2: 0.35, intelligence_index: 0.2 },
		priorities: { ...codingProfile.priorities, reasoningNeed: 0.95, costSensitivity: 0.4, contextNeed: 0.5 },
		targetThinkingLevel: "xhigh",
		routingTier: "frontier",
		complexityScore: 0.9,
	};
	const config = cloneConfig({ strategy: { objective: "cheapest", minAaMatch: 0.35 } });
	const result = chooseRoute([reasoning], aaModels, buildStats(aaModels), profile, config, undefined, "off", false);
	const order = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

	assert.ok(order.indexOf(result?.best.candidateThinkingLevel ?? "off") >= order.indexOf("medium"));
});

/*
 * Verifies that a critical reasoning floor is a hard constraint: if the scoped pool exposes only
 * thinking-off routes, StarRouter abstains instead of silently relaxing the floor.
 */
test("critical-system route abstains when no model meets the thinking floor", () => {
	clearAaMatchCache();
	const offOnly = model({ provider: "openrouter", id: "openai/gpt-5.5", name: "GPT-5.5" });
	const aaModels = [aa({ slug: "gpt-5-5-non-reasoning", name: "GPT-5.5 (Non-reasoning)", shortName: "GPT-5.5", creatorName: "OpenAI" })];
	const profile: PromptProfile = {
		...codingProfile,
		matchedSignals: ["architecture", "critical-system"],
		priorities: { ...codingProfile.priorities, reasoningNeed: 0.95 },
		targetThinkingLevel: "xhigh",
		routingTier: "frontier",
	};
	const config = cloneConfig({ strategy: { minAaMatch: 0.35 } });

	assert.equal(chooseRoute([offOnly], aaModels, buildStats(aaModels), profile, config, undefined, "off", false), undefined);
});

/*
 * Verifies that low-confidence winners cannot route merely because some unrelated current model
 * exists outside the configured candidate pool.
 */
test("low-confidence route abstains when current model is outside the pool", () => {
	clearAaMatchCache();
	const candidate = model({ provider: "openrouter", id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" });
	const currentOutsidePool = model({ provider: "github-copilot", id: "gpt-5-mini", name: "GPT-5 mini" });
	const aaModels = [aa({ slug: "deepseek-v4-flash-non-reasoning", name: "DeepSeek V4 Flash (Non-reasoning)", shortName: "DeepSeek Flash", creatorName: "DeepSeek" })];
	const profile = { ...simpleProfile, uncertain: true };
	const config = cloneConfig({ strategy: { minAaMatch: 0.35, minRouteConfidence: 0.99 } });

	assert.equal(chooseRoute([candidate], aaModels, buildStats(aaModels), profile, config, currentOutsidePool, "off", false), undefined);
});

/*
 * Verifies that the same low-confidence condition may safely keep an exact current route that is
 * still inside the constrained provider pool, because no untrusted switch is performed.
 */
test("low-confidence route can keep the current in-pool route", () => {
	clearAaMatchCache();
	const current = model({ provider: "openrouter", id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" });
	const aaModels = [aa({ slug: "deepseek-v4-flash-non-reasoning", name: "DeepSeek V4 Flash (Non-reasoning)", shortName: "DeepSeek Flash", creatorName: "DeepSeek" })];
	const profile = { ...simpleProfile, uncertain: true };
	const config = cloneConfig({ strategy: { minAaMatch: 0.35, minRouteConfidence: 0.99 } });
	const result = chooseRoute([current], aaModels, buildStats(aaModels), profile, config, current, "off", false);

	assert.equal(result?.best.piModel.id, current.id);
	assert.equal(result?.topCandidates[0], result?.best);
	assert.equal(result?.topCandidates.filter((candidate) => candidate.piModel.id === current.id).length, 1);
	assert.ok((result?.best.confidence?.overall ?? 1) < config.strategy.minRouteConfidence);
});

/*
 * Verifies that confidence fallback inserts a current route excluded from the Pareto ranking at the
 * head of topCandidates without duplicating it.
 */
test("top candidates start with the selected current route after confidence fallback", () => {
	clearAaMatchCache();
	const current = model({ provider: "openrouter", id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", cost: { input: 3, output: 6, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000 });
	const challenger = model({ provider: "openrouter", id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000 });
	const aaModels = [
		aa({ slug: "deepseek-v4-flash-non-reasoning", name: "DeepSeek V4 Flash (Non-reasoning)", shortName: "DeepSeek Flash", creatorName: "DeepSeek", ifbench: 80, priceBlendedPer1M: 4, contextWindowTokens: 128_000, performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: 40, medianEndToEndResponseTime: 10 }] }),
		aa({ slug: "gemini-3-1-flash-lite-non-reasoning", name: "Gemini 3.1 Flash Lite (Non-reasoning)", shortName: "Gemini Flash Lite", creatorName: "Google", ifbench: 90, priceBlendedPer1M: 0.2, contextWindowTokens: 1_000_000, performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: 150, medianEndToEndResponseTime: 2 }] }),
	];
	const config = cloneConfig({ strategy: { minAaMatch: 0.35, minRouteConfidence: 0.99, qualityFloor: 0.3 } });
	const result = chooseRoute([current, challenger], aaModels, buildStats(aaModels), { ...simpleProfile, uncertain: true }, config, current, "off", false);

	assert.equal(result?.best.piModel.id, current.id);
	assert.equal(result?.topCandidates[0], result?.best);
	assert.equal(result?.topCandidates.filter((candidate) => candidate.piModel.id === current.id).length, 1);
});

/*
 * Verifies that long-context prompts treat context size as a hard requirement when a capable model exists.
 */
test("long-context route avoids short-context candidates", () => {
	clearAaMatchCache();
	const shortContext = model({ provider: "openrouter", id: "anthropic/claude-opus-4.5", name: "Claude Opus 4.5", contextWindow: 200_000, cost: { input: 5, output: 25, cacheRead: 0, cacheWrite: 0 } });
	const longContext = model({ provider: "openrouter", id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", contextWindow: 1_000_000, cost: { input: 0.4, output: 0.8, cacheRead: 0, cacheWrite: 0 } });
	const aaModels = [
		aa({ slug: "claude-opus-4-7", name: "Claude Opus 4.7", shortName: "Opus", creatorName: "Anthropic", lcr: 95, contextWindowTokens: 200_000 }),
		aa({ slug: "deepseek-v4-pro", name: "DeepSeek V4 Pro", shortName: "DeepSeek Pro", creatorName: "DeepSeek", lcr: 75, contextWindowTokens: 1_000_000 }),
	];
	const profile: PromptProfile = {
		...simpleProfile,
		matchedSignals: ["long-context"],
		benchmarkWeights: { ...simpleProfile.benchmarkWeights, ifbench: 0, lcr: 1 },
		priorities: { ...simpleProfile.priorities, contextNeed: 0.9, costSensitivity: 0.4 },
		targetThinkingLevel: "medium",
		routingTier: "standard",
		promptLengthType: "long",
	};
	const config = cloneConfig({ strategy: { objective: "cheapest", minAaMatch: 0.35 } });
	const result = chooseRoute([shortContext, longContext], aaModels, buildStats(aaModels), profile, config, undefined, "off", false);

	assert.equal(result?.best.piModel.id, "deepseek/deepseek-v4-pro");
});

/*
 * Verifies that StarRouter abstains when every candidate misses the declared long-context floor,
 * rather than treating the floor as a best-effort preference.
 */
test("long-context route abstains when no model meets the context floor", () => {
	clearAaMatchCache();
	const shortContext = model({ provider: "openrouter", id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", contextWindow: 200_000 });
	const aaModels = [aa({ slug: "deepseek-v4-flash-non-reasoning", name: "DeepSeek V4 Flash (Non-reasoning)", shortName: "DeepSeek Flash", creatorName: "DeepSeek", lcr: 80, contextWindowTokens: 200_000 })];
	const profile: PromptProfile = {
		...simpleProfile,
		matchedSignals: ["long-context"],
		benchmarkWeights: { ...simpleProfile.benchmarkWeights, ifbench: 0, lcr: 1 },
		priorities: { ...simpleProfile.priorities, contextNeed: 0.9 },
		promptLengthType: "long",
	};
	const config = cloneConfig({ strategy: { minAaMatch: 0.35 } });

	assert.equal(chooseRoute([shortContext], aaModels, buildStats(aaModels), profile, config, undefined, "off", false), undefined);
});

/*
 * Verifies exact weak Pareto dominance: a material gain cannot erase a candidate that is even
 * slightly better on another observed dimension.
 */
test("Pareto frontier preserves small real trade-offs", () => {
	const mostlyBetter = { ...fakeCandidateForPareto("mostly-better"), benchmarkScore: 0.99, economicScore: 1, speedScore: 1, latencyScore: 1, contextScore: 1 };
	const qualityEdge = { ...fakeCandidateForPareto("quality-edge"), benchmarkScore: 1, economicScore: 0.9, speedScore: 1, latencyScore: 1, contextScore: 1 };
	assert.deepEqual(paretoFrontierCandidates([mostlyBetter, qualityEdge]).map((candidate) => candidate.piModel.id), ["mostly-better", "quality-edge"]);
});

/*
 * Verifies alias pins retain creator/reasoning/slug gates. Aggregators can consume a mismatched
 * hosted row only as model-only evidence; unhosted API rows still fail closed.
 */
test("AA overrides retain identity and evidence-scope gates", () => {
	const piModel = model({ provider: "openrouter", id: "openai/gpt-5.1-codex", name: "GPT-5.1 Codex" });
	const baseConfig = cloneConfig({ strategy: { minAaMatch: 0.35 }, modelOverrides: { "openrouter/openai/gpt-5.1-codex@off": "target" } });
	const incompatibleRows: AaModel[] = [
		aa({ slug: "target", name: "Claude Sonnet 5.1 (Non-reasoning)", shortName: "Claude", creatorName: "Anthropic" }),
		aa({ slug: "target", name: "GPT-5.1 Codex", shortName: "GPT-5.1", creatorName: "OpenAI", reasoningModel: true }),
	];
	for (const row of incompatibleRows) {
		clearAaMatchCache();
		assert.equal(pickAaMatchForPiModel(piModel, [row], "off", baseConfig), undefined);
	}

	clearAaMatchCache();
	const otherHost = aa({ slug: "target", name: "GPT-5.1 Codex (Non-reasoning)", shortName: "GPT-5.1", creatorName: "OpenAI", hostLabel: "OpenAI", hostSlug: "openai" });
	const aggregatorMatch = pickAaMatchForPiModel(piModel, [otherHost], "off", baseConfig);
	assert.equal(aggregatorMatch?.evidenceScope, "model-only");
	assert.equal(aggregatorMatch?.overrideApplied, true);

	clearAaMatchCache();
	const hostSlugOnly = aa({ slug: "different", name: "GPT-5.1 Codex (Non-reasoning)", shortName: "GPT-5.1", creatorName: "OpenAI", hostSlug: "target", hostLabel: "OpenRouter" });
	const hostSlugMatch = pickAaMatchForPiModel(piModel, [hostSlugOnly], "off", baseConfig);
	assert.equal(hostSlugMatch?.overrideApplied, false);
	assert.equal(hostSlugMatch?.aaModel.slug, "different");

	clearAaMatchCache();
	const pageRow = aa({ sourceMode: "page-scrape", slug: "target", name: "GPT-5.1 Codex (Non-reasoning)", shortName: "GPT-5.1", creatorName: "OpenAI", hostLabel: undefined, hostSlug: undefined });
	const pageMatch = pickAaMatchForPiModel(piModel, [pageRow], "off", baseConfig);
	assert.equal(pageMatch?.evidenceScope, "model-only");
	assert.equal(pageMatch?.overrideApplied, true);
	const degradedConfig = cloneConfig({ strategy: { minAaMatch: 0.35, minRouteConfidence: 0 }, modelOverrides: { "openrouter/openai/gpt-5.1-codex@off": "target" } });
	const degradedRoute = chooseRoute([piModel], [pageRow], buildStats([pageRow]), simpleProfile, degradedConfig, undefined, "off", false);
	assert.ok(degradedRoute?.best.reasonBits.includes("AA model-only evidence"));
	assert.ok(degradedRoute?.best.confidence?.notes.includes("model-only-host-unverified"));

	clearAaMatchCache();
	const hostedPreferenceConfig = cloneConfig({
		strategy: { minAaMatch: 0.35 },
		modelOverrides: {
			"openrouter/openai/gpt-5.1-codex@off": "page-target",
			"openrouter/openai/gpt-5.1-codex": "hosted-target",
		},
	});
	const pageAlternative = { ...pageRow, slug: "page-target" };
	const hostedAlternative = aa({ slug: "hosted-target", name: "GPT-5.1 Codex (Non-reasoning)", shortName: "GPT-5.1", creatorName: "OpenAI" });
	assert.equal(pickAaMatchForPiModel(piModel, [pageAlternative, hostedAlternative], "off", hostedPreferenceConfig)?.aaModel.slug, "hosted-target");

	clearAaMatchCache();
	const apiRow = { ...pageRow, sourceMode: "api" as const };
	assert.equal(pickAaMatchForPiModel(piModel, [apiRow], "off", baseConfig), undefined);
});

/*
 * Verifies direct providers cannot certify a related but distinct host, while an aggregator's
 * broad gateway name never turns model-only evidence into host-verified evidence.
 */
test("direct providers reject cross-host aliases", () => {
	const cases = [
		{
			pi: model({ provider: "google", id: "google/gemini-3.1-flash", name: "Gemini 3.1 Flash" }),
			row: aa({ slug: "gemini-3-1-flash-non-reasoning", name: "Gemini 3.1 Flash (Non-reasoning)", shortName: "Gemini", creatorName: "Google", hostLabel: "Google Vertex", hostSlug: "google-vertex" }),
		},
		{
			pi: model({ provider: "google-vertex", id: "google/gemini-3.1-flash", name: "Gemini 3.1 Flash" }),
			row: aa({ slug: "gemini-3-1-flash-non-reasoning", name: "Gemini 3.1 Flash (Non-reasoning)", shortName: "Gemini", creatorName: "Google", hostLabel: "Google", hostSlug: "google" }),
		},
		{
			pi: model({ provider: "azure-openai-responses", id: "openai/gpt-5.1-codex", name: "GPT-5.1 Codex" }),
			row: aa({ slug: "gpt-5-1-codex-non-reasoning", name: "GPT-5.1 Codex (Non-reasoning)", shortName: "GPT", creatorName: "OpenAI", hostLabel: "OpenAI", hostSlug: "openai" }),
		},
	];
	for (const item of cases) {
		clearAaMatchCache();
		assert.equal(pickAaMatchForPiModel(item.pi, [item.row], "off", cloneConfig({ strategy: { minAaMatch: 0.2 } })), undefined);
	}

	clearAaMatchCache();
	const cloudflare = model({ provider: "cloudflare-ai-gateway", id: "openai/gpt-5.1-codex", name: "GPT-5.1 Codex" });
	const vercel = aa({ slug: "gpt-5-1-codex-non-reasoning", name: "GPT-5.1 Codex (Non-reasoning)", shortName: "GPT", creatorName: "OpenAI", hostLabel: "Vercel AI Gateway", hostSlug: "vercel-ai-gateway" });
	assert.equal(pickAaMatchForPiModel(cloudflare, [vercel], "off", cloneConfig({ strategy: { minAaMatch: 0.2 } }))?.evidenceScope, "model-only");
});

/*
 * Verifies model API identifiers cannot certify host evidence: Azure-hosted DeepSeek remains
 * incompatible with the direct DeepSeek provider, and a Vertex row cannot verify OpenAI.
 */
test("host API model ids never certify host scope", () => {
	const deepseek = model({ provider: "deepseek", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" });
	const azureRow = aa({
		slug: "deepseek-v4-pro-non-reasoning",
		name: "DeepSeek V4 Pro (Non-reasoning)",
		shortName: "DeepSeek V4 Pro",
		creatorName: "DeepSeek",
		hostLabel: "Azure",
		hostSlug: "azure",
		hostApiId: "DeepSeek-V4-Pro",
		performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: 999, medianEndToEndResponseTime: 0.01 }],
	});
	clearAaMatchCache();
	assert.equal(pickAaMatchForPiModel(deepseek, [azureRow], "off", cloneConfig({ strategy: { minAaMatch: 0.2 } })), undefined);
	assert.equal(chooseRoute([deepseek], [azureRow], buildStats([azureRow]), simpleProfile, cloneConfig({ strategy: { minAaMatch: 0.2, minRouteConfidence: 0 } }), undefined, "off", false), undefined);

	const openai = model({ provider: "openai", id: "openai/gpt-oss-20b", name: "GPT OSS 20B" });
	const vertexRow = aa({ slug: "gpt-oss-20b-non-reasoning", name: "GPT OSS 20B (Non-reasoning)", shortName: "GPT OSS", creatorName: "OpenAI", hostLabel: "Google Vertex", hostSlug: "google-vertex", hostApiId: "openai/gpt-oss-20b" });
	clearAaMatchCache();
	assert.equal(pickAaMatchForPiModel(openai, [vertexRow], "off", cloneConfig({ strategy: { minAaMatch: 0.2 } })), undefined);
});

/*
 * Verifies aggregator fallback uses only model-quality evidence. Pi-declared economics/context are
 * retained, AA host speed/latency/price/context/token-burn are suppressed, and named objectives
 * abstain when their primary evidence is absent.
 */
test("model-only evidence suppresses host metrics and abstains by objective", () => {
	const priced = model({
		provider: "openrouter",
		id: "openai/gpt-5.1-codex",
		name: "GPT-5.1 Codex",
		contextWindow: 128_000,
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
	});
	const unpriced = model({ ...priced, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
	const otherHost = aa({
		slug: "gpt-5-1-codex-non-reasoning",
		name: "GPT-5.1 Codex (Non-reasoning)",
		shortName: "GPT",
		creatorName: "OpenAI",
		hostLabel: "OpenAI",
		hostSlug: "openai",
		priceBlendedPer1M: 0.01,
		contextWindowTokens: 1_000_000,
		tokenBurn: 999,
		performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: 999, medianEndToEndResponseTime: 0.01, medianTimeToFirstAnswerToken: 0.001 }],
	});
	const route = (piModel: Model<Api>, objective: RouterConfig["strategy"]["objective"]) => chooseRoute(
		[piModel], [otherHost], buildStats([otherHost]), simpleProfile,
		cloneConfig({ strategy: { objective, minAaMatch: 0.2, minRouteConfidence: 0, qualityFloor: 0.3 }, modelOverrides: {} }),
		undefined, "off", false,
	);
	for (const objective of ["balanced", "quality"] as const) {
		const result = route(priced, objective);
		assert.equal(result?.best.aaEvidenceScope, "model-only");
		assert.equal(result?.best.speed, undefined);
		assert.equal(result?.best.latency, undefined);
		assert.equal(result?.best.ttft, undefined);
		assert.equal(result?.best.tokenBurn, undefined);
		assert.equal(result?.best.contextWindow, 128_000);
		assert.ok(Number.isFinite(result?.best.price));
		assert.notEqual(result?.best.price, otherHost.priceBlendedPer1M);
	}
	assert.equal(route(unpriced, "cheapest"), undefined);
	assert.equal(route(priced, "fastest"), undefined);
	assert.ok(route(priced, "cheapest"));
	const unpricedQuality = route(unpriced, "quality")!;
	const tradeoff = buildWinnerReasonLines(unpricedQuality.best, simpleProfile, "routing provider openrouter", ["IFBench"])
		.find((line) => line.startsWith("Trade-off:")) ?? "";
	assert.match(tradeoff, /cost n\/a/);
	assert.match(tradeoff, /speed n\/a/);
	assert.match(tradeoff, /latency n\/a/);
	assert.doesNotMatch(tradeoff, /speed 0|latency 0/);
});

/*
 * Verifies newly named GPT/Claude product lines stay exact: a Sol route cannot borrow Luna, Pro
 * cannot borrow base, and Fable cannot borrow Opus even when generation tokens overlap.
 */
test("AA matching preserves current product subfamilies and variants", () => {
	const config = cloneConfig({ strategy: { minAaMatch: 0.2 } });
	const gptSol = model({ provider: "openrouter", id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol", reasoning: true });
	const lunaOff = aa({ slug: "gpt-5-6-luna-non-reasoning", name: "GPT-5.6 Luna (Non-reasoning)", shortName: "GPT Luna", creatorName: "OpenAI", hostLabel: "OpenAI", hostSlug: "openai" });
	const solLow = aa({ slug: "gpt-5-6-sol-low", name: "GPT-5.6 Sol (low)", shortName: "GPT Sol", creatorName: "OpenAI", hostLabel: "OpenAI", hostSlug: "openai", reasoningModel: true });
	clearAaMatchCache();
	assert.equal(pickAaMatchForPiModel(gptSol, [lunaOff], "off", config), undefined);
	clearAaMatchCache();
	assert.equal(pickAaMatchForPiModel(gptSol, [lunaOff, solLow], "low", config)?.aaModel.slug, "gpt-5-6-sol-low");

	const gptSolPro = model({ provider: "openrouter", id: "openai/gpt-5.6-sol-pro", name: "GPT-5.6 Sol Pro", reasoning: true });
	clearAaMatchCache();
	assert.equal(pickAaMatchForPiModel(gptSolPro, [solLow], "low", config), undefined);

	const fable = model({ provider: "openrouter", id: "anthropic/claude-fable-5", name: "Claude Fable 5" });
	const opus = aa({ slug: "claude-opus-5-non-reasoning", name: "Claude Opus 5 (Non-reasoning)", shortName: "Opus", creatorName: "Anthropic", hostLabel: "Anthropic", hostSlug: "anthropic" });
	clearAaMatchCache();
	assert.equal(pickAaMatchForPiModel(fable, [opus], "off", config), undefined);
});

/*
 * Verifies minor-version extraction for Mistral models instead of accidentally treating a parameter
 * count as the model generation.
 */
test("AA matching rejects Mistral minor-version drift", () => {
	clearAaMatchCache();
	const config = cloneConfig({ strategy: { minAaMatch: 0.35 } });
	const piModel = model({ provider: "openrouter", id: "mistralai/mistral-small-3.1-24b", name: "Mistral Small 3.1 24B" });
	const wrong = aa({ slug: "mistral-small-3-2-24b-non-reasoning", name: "Mistral Small 3.2 24B (Non-reasoning)", shortName: "Mistral Small 3.2", creatorName: "Mistral" });
	assert.equal(pickAaMatchForPiModel(piModel, [wrong], "off", config), undefined);
});

/*
 * Verifies default DeepSeek reasoning routes never reuse the non-reasoning row for minimal/low.
 */
test("DeepSeek minimal and low routes use reasoning AA evidence", () => {
	const piModel = model({ provider: "openrouter", id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true });
	const rows = [
		aa({ slug: "deepseek-v4-flash-non-reasoning", name: "DeepSeek V4 Flash (Non-reasoning)", shortName: "Flash", creatorName: "DeepSeek" }),
		aa({ slug: "deepseek-v4-flash", name: "DeepSeek V4 Flash", shortName: "Flash", creatorName: "DeepSeek", reasoningModel: true }),
	];
	const config = cloneConfig({ strategy: { minAaMatch: 0.35 } });
	for (const level of ["minimal", "low"] as const) {
		clearAaMatchCache();
		const match = pickAaMatchForPiModel(piModel, rows, level, config);
		assert.equal(match?.aaModel.slug, "deepseek-v4-flash");
		assert.notEqual(match?.variantLevel, "off");
	}
});

/*
 * Verifies latency evidence uses one pool-wide basis: E2E wins when present anywhere, and TTFT is
 * normalized only when no route has E2E measurements.
 */
test("latency fallback is pool-wide and never mixes TTFT with E2E", () => {
	const models = [
		model({ provider: "openrouter", id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" }),
		model({ provider: "openrouter", id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" }),
	];
	const e2e = aa({ slug: "deepseek-v4-flash-non-reasoning", name: "DeepSeek V4 Flash (Non-reasoning)", shortName: "DeepSeek Flash", creatorName: "DeepSeek", ifbench: 50, priceBlendedPer1M: 0.2, performanceByPromptLength: [{ promptLengthType: "medium", medianEndToEndResponseTime: 10, medianTimeToFirstAnswerToken: 1 }] });
	const ttft = aa({ slug: "gemini-3-1-flash-lite-non-reasoning", name: "Gemini 3.1 Flash Lite (Non-reasoning)", shortName: "Gemini Flash Lite", creatorName: "Google", ifbench: 60, priceBlendedPer1M: 2, performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: 150, medianTimeToFirstAnswerToken: 0.1 }] });
	const config = cloneConfig({ strategy: { minAaMatch: 0.2, minRouteConfidence: 0, qualityFloor: 0.3 } });
	clearAaMatchCache();
	const mixed = chooseRoute(models, [e2e, ttft], buildStats([e2e, ttft]), simpleProfile, config, undefined, "off", false);
	assert.ok(mixed);
	for (const candidate of mixed!.topCandidates) assert.equal(candidate.latencyBasis, "end-to-end");
	assert.equal(mixed!.topCandidates.find((candidate) => candidate.piModel.id === "google/gemini-3.1-flash-lite")?.latencyScore, 0);

	const ttftSlow = aa({ ...e2e, performanceByPromptLength: [{ promptLengthType: "medium", medianTimeToFirstAnswerToken: 0.5 }] });
	clearAaMatchCache();
	const fallback = chooseRoute(models, [ttftSlow, ttft], buildStats([ttftSlow, ttft]), simpleProfile, config, undefined, "off", false);
	assert.ok(fallback);
	for (const candidate of fallback!.topCandidates) assert.equal(candidate.latencyBasis, "ttft");
	assert.ok(fallback!.topCandidates.some((candidate) => candidate.reasonBits.includes("TTFT fallback pool")));
});

/*
 * Verifies lexical vision intent is itself a hard capability requirement even when attachment
 * metadata is absent at routing time.
 */
test("lexical vision intent excludes text-only candidates", () => {
	clearAaMatchCache();
	const textOnly = model({ provider: "openrouter", id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", input: ["text"] });
	const vision = model({ provider: "openrouter", id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", input: ["text", "image"] });
	const rows = [
		aa({ slug: "deepseek-v4-flash-non-reasoning", name: "DeepSeek V4 Flash (Non-reasoning)", shortName: "DeepSeek", creatorName: "DeepSeek", inputModalityImage: false }),
		aa({ slug: "gemini-3-1-flash-lite-non-reasoning", name: "Gemini 3.1 Flash Lite (Non-reasoning)", shortName: "Gemini", creatorName: "Google", inputModalityImage: true }),
	];
	const profile = { ...simpleProfile, matchedSignals: ["vision"], priorities: { ...simpleProfile.priorities, visionNeed: 1 }, promptLengthType: "vision_single_image" as const };
	const result = chooseRoute([textOnly, vision], rows, buildStats(rows), profile, cloneConfig({ strategy: { minAaMatch: 0.2, minRouteConfidence: 0 } }), undefined, "off", false);
	assert.equal(result?.best.piModel.id, "google/gemini-3.1-flash-lite");
});

/*
 * Verifies every ranking path has a stable identity tie-break independent of input order.
 */
test("objective ranking ties are deterministic", () => {
	const a = { ...fakeCandidateForPareto("a"), benchmarkScore: 0.5, economicScore: 0.5, speedScore: 0.5, latencyScore: 0.5, contextScore: 0.5, composite: 0.5, price: 1 };
	const b = { ...a, piModel: model({ provider: "openrouter", id: "b", name: "b" }), aaModel: aa({ slug: "b", name: "b", shortName: "b" }) };
	for (const objective of ["balanced", "quality", "cheapest", "fastest"] as const) {
		assert.equal(rankCandidatesForObjective([b, a], objective)[0]?.piModel.id, "a");
	}
});
