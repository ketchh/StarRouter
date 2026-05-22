import test from "node:test";
import assert from "node:assert/strict";

interface OpenRouterModel {
	id: string;
	name?: string;
	context_length?: number;
	pricing?: Record<string, string>;
}

async function fetchOpenRouterPrices(): Promise<Map<string, OpenRouterModel>> {
	const response = await fetch("https://openrouter.ai/api/v1/models", {
		headers: { accept: "application/json", "user-agent": "pi-star-router-tests/1.0" },
		signal: AbortSignal.timeout(30_000),
	});
	assert.equal(response.ok, true, `OpenRouter models endpoint failed with HTTP ${response.status}`);
	const payload = (await response.json()) as { data?: OpenRouterModel[] };
	assert.ok(Array.isArray(payload.data), "OpenRouter response must contain data[]");
	return new Map(payload.data.map((model) => [model.id, model]));
}

function pricePerMillion(model: OpenRouterModel, field: "prompt" | "completion"): number {
	const raw = model.pricing?.[field];
	assert.equal(typeof raw, "string", `${model.id} must expose pricing.${field}`);
	const value = Number(raw) * 1_000_000;
	assert.ok(Number.isFinite(value), `${model.id} ${field} price must be numeric`);
	return value;
}

function requestCostUsd(model: OpenRouterModel, inputTokens: number, outputTokens: number): number {
	return (inputTokens / 1_000_000) * pricePerMillion(model, "prompt") + (outputTokens / 1_000_000) * pricePerMillion(model, "completion");
}

function savingsPercent(routerCost: number, baselineCost: number): number {
	return ((baselineCost - routerCost) / baselineCost) * 100;
}

/*
 * Verifies that the economic review uses live OpenRouter prices rather than invented or local fixture data.
 */
test("downloads a broad live OpenRouter price catalog", async () => {
	const prices = await fetchOpenRouterPrices();

	assert.ok(prices.size >= 100, `expected a broad model catalog, got ${prices.size}`);
	for (const id of ["anthropic/claude-haiku-4.5", "anthropic/claude-sonnet-4.5", "openai/gpt-5.1-codex", "deepseek/deepseek-v4-flash"]) {
		assert.ok(prices.has(id), `expected OpenRouter model ${id}`);
	}
});

/*
 * Verifies that efficient models used in the economic comparisons are materially cheaper than frontier baselines,
 * making router savings realistic for simple tasks.
 */
test("efficient route models are materially cheaper than frontier baselines", async () => {
	const prices = await fetchOpenRouterPrices();
	const flash = prices.get("deepseek/deepseek-v4-flash")!;
	const haiku = prices.get("anthropic/claude-haiku-4.5")!;
	const sonnet = prices.get("anthropic/claude-sonnet-4.5")!;
	const opus = prices.get("anthropic/claude-opus-4.5")!;

	assert.ok(pricePerMillion(flash, "prompt") < pricePerMillion(sonnet, "prompt"));
	assert.ok(pricePerMillion(flash, "completion") < pricePerMillion(sonnet, "completion"));
	assert.ok(pricePerMillion(haiku, "prompt") < pricePerMillion(opus, "prompt"));
	assert.ok(pricePerMillion(haiku, "completion") < pricePerMillion(opus, "completion"));
});

/*
 * Verifies the savings claim for a simple JSON extraction task where the router can choose DeepSeek V4 Flash
 * instead of Claude Sonnet 4.5 for a small interactive token budget.
 */
test("simple JSON extraction scenario saves more than 90 percent versus Sonnet baseline", async () => {
	const prices = await fetchOpenRouterPrices();
	const router = prices.get("deepseek/deepseek-v4-flash")!;
	const baseline = prices.get("anthropic/claude-sonnet-4.5")!;
	const routerCost = requestCostUsd(router, 4_000, 1_000);
	const baselineCost = requestCostUsd(baseline, 4_000, 1_000);

	assert.ok(savingsPercent(routerCost, baselineCost) >= 90);
});

/*
 * Verifies the savings claim for routine coding work where a coder/budget model can be cheaper
 * than GPT-5.1 Codex while quality routing remains available for hard prompts.
 */
test("routine coding scenario saves more than 40 percent versus GPT-5.1 Codex baseline", async () => {
	const prices = await fetchOpenRouterPrices();
	const router = prices.get("qwen/qwen3-coder-plus")!;
	const baseline = prices.get("openai/gpt-5.1-codex")!;
	const routerCost = requestCostUsd(router, 12_000, 3_000);
	const baselineCost = requestCostUsd(baseline, 12_000, 3_000);

	assert.ok(savingsPercent(routerCost, baselineCost) >= 40);
});

/*
 * Verifies the savings claim for long-context triage where the router can choose a cheaper large-context model
 * instead of a more expensive pro baseline.
 */
test("long-context triage scenario saves more than 60 percent versus Gemini Pro baseline", async () => {
	const prices = await fetchOpenRouterPrices();
	const router = prices.get("deepseek/deepseek-v4-pro")!;
	const baseline = prices.get("google/gemini-3.1-pro-preview")!;
	const routerCost = requestCostUsd(router, 80_000, 6_000);
	const baselineCost = requestCostUsd(baseline, 80_000, 6_000);

	assert.ok(savingsPercent(routerCost, baselineCost) >= 60);
});
