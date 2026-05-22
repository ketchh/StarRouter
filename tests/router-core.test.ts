import test from "node:test";
import assert from "node:assert/strict";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	DEFAULT_CONFIG,
	buildStats,
	chooseRoute,
	clearAaMatchCache,
	getProviderScopedModels,
	getSupportedThinkingLevelsForModel,
	isContextDependentFollowUp,
	normalizeAaModelsForRouting,
	normalizeRouterConfig,
	paretoFrontierCandidates,
	pickAaMatchForPiModel,
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
		thinkingLevelMap: { minimal: null, low: null, xhigh: "max" },
	});

	assert.deepEqual(getSupportedThinkingLevelsForModel(nonReasoning), ["off"]);
	assert.deepEqual(getSupportedThinkingLevelsForModel(reasoning), ["off", "medium", "high", "xhigh"]);
});

/*
 * Verifies that short context-dependent follow-ups do not trigger unnecessary automatic routing.
 */
test("context-dependent follow-ups are detected", () => {
	assert.equal(isContextDependentFollowUp("continue"), true);
	assert.equal(isContextDependentFollowUp("retry"), true);
	assert.equal(isContextDependentFollowUp("design a new architecture"), false);
});

/*
 * Verifies that duplicate AA host rows are normalized into one benchmark row with best quality,
 * cheapest price, fastest latency, and largest context before scoring.
 */
test("AA normalization deduplicates host rows", () => {
	const normalized = normalizeAaModelsForRouting([
		aa({ slug: "same-model", name: "Same Model", shortName: "Same", codingIndex: 70, priceBlendedPer1M: 2, contextWindowTokens: 100_000, performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: 50, medianEndToEndResponseTime: 8 }] }),
		aa({ slug: "same-model", name: "Same Model", shortName: "Same", codingIndex: 82, priceBlendedPer1M: 1, contextWindowTokens: 1_000_000, performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: 90, medianEndToEndResponseTime: 3 }] }),
	]);

	assert.equal(normalized.length, 1);
	assert.equal(normalized[0]?.codingIndex, 82);
	assert.equal(normalized[0]?.priceBlendedPer1M, 1);
	assert.equal(normalized[0]?.contextWindowTokens, 1_000_000);
	assert.equal(normalized[0]?.performanceByPromptLength[0]?.medianOutputSpeed, 90);
	assert.equal(normalized[0]?.performanceByPromptLength[0]?.medianEndToEndResponseTime, 3);
});

/*
 * Verifies that the Pareto frontier removes candidates that are strictly dominated on quality,
 * economics, latency, and context before objective tie-breaking.
 */
test("Pareto frontier removes dominated candidates", () => {
	const strong = { ...fakeCandidateForPareto("strong"), benchmarkScore: 0.9, economicScore: 0.9, latencyScore: 0.9, contextScore: 0.9 };
	const dominated = { ...fakeCandidateForPareto("dominated"), benchmarkScore: 0.82, economicScore: 0.8, latencyScore: 0.83, contextScore: 0.84 };
	const frontier = paretoFrontierCandidates([strong, dominated]);

	assert.deepEqual(frontier.map((candidate) => candidate.piModel.id), ["strong"]);
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
	assert.equal(match?.matchScore, 1.25);
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
 * Verifies that preferCurrentWithin prevents route flapping when the current model is nearly equivalent to the winner.
 */
test("preferCurrentWithin keeps current route when scores are close", () => {
	clearAaMatchCache();
	const current = model({ provider: "openrouter", id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", reasoning: true, cost: { input: 1, output: 5, cacheRead: 0, cacheWrite: 0 } });
	const challenger = model({ provider: "openrouter", id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", reasoning: true, cost: { input: 0.14, output: 0.28, cacheRead: 0, cacheWrite: 0 } });
	const aaModels = [
		aa({ slug: "baseline-weak", name: "Baseline Weak", shortName: "Weak", ifbench: 50, priceBlendedPer1M: 1 }),
		aa({ slug: "claude-4-5-haiku", name: "Claude Haiku 4.5", shortName: "Haiku", ifbench: 88, priceBlendedPer1M: 1.8 }),
		aa({ slug: "deepseek-v4-flash", name: "DeepSeek V4 Flash", shortName: "DeepSeek Flash", ifbench: 89, priceBlendedPer1M: 0.2 }),
	];
	const config = cloneConfig({ strategy: { objective: "balanced", minAaMatch: 0.35, preferCurrentWithin: 1 } });
	const result = chooseRoute([current, challenger], aaModels, buildStats(aaModels), simpleProfile, config, current, "off", false);

	assert.equal(result?.best.piModel.id, current.id);
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
 * Verifies that identity gating prevents Claude Sonnet/Opus off routes from borrowing Haiku benchmark rows.
 */
test("AA matching respects Claude subfamilies before variant compatibility", () => {
	clearAaMatchCache();
	const config = cloneConfig({ strategy: { minAaMatch: 0.35 } });
	const piModel = model({ provider: "openrouter", id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" });
	const aaModels = [
		aa({ slug: "claude-4-5-haiku", name: "Claude 4.5 Haiku (Non-reasoning)", shortName: "Haiku", creatorName: "Anthropic", ifbench: 90 }),
		aa({ slug: "claude-sonnet-4-6-non-reasoning", name: "Claude Sonnet 4.6 (Non-reasoning)", shortName: "Sonnet", creatorName: "Anthropic", ifbench: 70 }),
	];

	const match = pickAaMatchForPiModel(piModel, aaModels, "off", config);

	assert.equal(match?.aaModel.slug, "claude-sonnet-4-6-non-reasoning");
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
 * Verifies that same-family generation drift is rejected by default, so benchmarks are not borrowed
 * across materially different model generations unless a user override explicitly opts into it.
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
	const piModel = model({ provider: "openrouter", id: "moonshotai/kimi-latest", name: "MoonshotAI Kimi Latest" });
	const aaModels = [aa({ slug: "kimi-k2-5-non-reasoning", name: "Kimi K2.5 (Non-reasoning)", shortName: "Kimi K2.5", creatorName: "Kimi" })];

	const match = pickAaMatchForPiModel(piModel, aaModels, "off", config);

	assert.equal(match?.aaModel.slug, "kimi-k2-5-non-reasoning");
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
	const order = ["off", "minimal", "low", "medium", "high", "xhigh"];

	assert.ok(order.indexOf(result?.best.candidateThinkingLevel ?? "off") >= order.indexOf("medium"));
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
