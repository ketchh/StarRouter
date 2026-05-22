import test from "node:test";
import assert from "node:assert/strict";
import { openRouteChoice } from "../src/route-choice-screen.ts";
import type { Candidate, RouteDecisionSummary } from "../src/router-core.ts";

const fakeCandidate = {
	piModel: {
		api: "openai-completions",
		baseUrl: "https://openrouter.ai/api/v1",
		provider: "openrouter",
		id: "deepseek/deepseek-v4-flash",
		name: "DeepSeek V4 Flash",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.14, output: 0.28, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 384_000,
	},
	candidateThinkingLevel: "off",
	requestedThinkingLevel: "off",
	aaModel: {
		sourceMode: "api",
		slug: "deepseek-v4-flash",
		name: "DeepSeek V4 Flash",
		shortName: "DeepSeek Flash",
		reasoningModel: true,
		inputModalityImage: false,
		performanceByPromptLength: [],
	},
	aaMatchScore: 1,
	aaVariantLevel: "off",
	benchmarkScore: 0.8,
	price: 0.2,
	speed: 100,
	latency: 2,
	contextWindow: 1_048_576,
	economicScore: 1,
	speedScore: 1,
	latencyScore: 1,
	contextScore: 1,
	scoreBreakdown: { quality: 0.5, cost: 0.2, speed: 0.1, latency: 0.1, context: 0.1, match: 1 },
	reasonBits: ["good cost", "fast"],
	composite: 0.9,
} as unknown as Candidate;

const fakeDecision = {
	timestamp: Date.now(),
	changedModel: true,
	changedThinkingLevel: false,
	provider: "openrouter",
	providerScopeMode: "configured-provider",
	providerScopeLabel: "routing provider openrouter",
	availableModelCount: 1,
	availableRouteCount: 1,
	dataSourceLabel: "test",
	objectiveUsed: "balanced",
	modelId: "deepseek/deepseek-v4-flash",
	modelName: "DeepSeek V4 Flash",
	requestedThinkingLevel: "off",
	thinkingLevel: "off",
	aaSlug: "deepseek-v4-flash",
	aaName: "DeepSeek V4 Flash",
	benchmarkSummary: ["IFBench"],
	profileSummary: "simple",
	reasonLines: ["Scope: routing provider openrouter"],
	shortSummary: ["Selected DeepSeek V4 Flash for simple prompt."],
	topCandidates: [],
} as RouteDecisionSummary;

/*
 * Verifies that no-UI mode does not auto-accept a route when configuration requires explicit confirmation.
 */
test("route confirmation returns undefined without UI instead of silently auto-accepting", async () => {
	const ctx = { hasUI: false } as Parameters<typeof openRouteChoice>[0];
	const selected = await openRouteChoice(ctx, {
		decision: fakeDecision,
		candidates: [fakeCandidate],
	});

	assert.equal(selected, undefined);
});
