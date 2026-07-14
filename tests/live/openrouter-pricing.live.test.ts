import test from "node:test";
import assert from "node:assert/strict";

interface OpenRouterModel {
	id: string;
	name?: string;
	context_length?: number;
	pricing?: Record<string, string>;
}

/*
 * This suite is intentionally live and opt-in. It checks the shape and selected invariants of the
 * current OpenRouter catalog; catalog membership and prices can change independently of releases.
 */
const catalogPromise: Promise<Map<string, OpenRouterModel>> = (async () => {
	const response = await fetch("https://openrouter.ai/api/v1/models", {
		headers: { accept: "application/json", "user-agent": "pi-star-router-live-tests/1.1" },
		signal: AbortSignal.timeout(30_000),
	});
	assert.equal(response.ok, true, `live OpenRouter endpoint returned HTTP ${response.status}`);
	const payload = (await response.json()) as { data?: OpenRouterModel[] };
	assert.ok(Array.isArray(payload.data), "live OpenRouter response must contain data[]");
	return new Map(payload.data.map((model) => [model.id, model]));
})();

function pricePerMillion(model: OpenRouterModel, field: "prompt" | "completion"): number {
	const raw = model.pricing?.[field];
	assert.equal(typeof raw, "string", `${model.id} must currently expose pricing.${field}`);
	const value = Number(raw) * 1_000_000;
	assert.ok(Number.isFinite(value) && value >= 0, `${model.id} ${field} price must be a non-negative number`);
	return value;
}

function requestCostUsd(model: OpenRouterModel, inputTokens: number, outputTokens: number): number {
	return (inputTokens / 1_000_000) * pricePerMillion(model, "prompt") + (outputTokens / 1_000_000) * pricePerMillion(model, "completion");
}

/*
 * Verifies the opt-in endpoint still exposes a broad catalog. This is operational evidence, not a
 * release guarantee about any model, price, or provider availability.
 */
test("live OpenRouter catalog remains broad", async () => {
	const prices = await catalogPromise;
	assert.ok(prices.size >= 100, `expected at least 100 live catalog rows, got ${prices.size}`);
});

/*
 * Verifies representative model IDs used by matching examples still exist. A failure means docs or
 * examples may need review; it does not make the deterministic offline release suite fail.
 */
test("representative live model identities remain discoverable", async () => {
	const prices = await catalogPromise;
	for (const id of ["anthropic/claude-haiku-4.5", "anthropic/claude-sonnet-4.5", "openai/gpt-5.1-codex", "deepseek/deepseek-v4-flash"]) {
		assert.ok(prices.has(id), `representative OpenRouter model is absent: ${id}`);
	}
});

/*
 * Verifies representative prompt prices remain parseable and non-negative without asserting a
 * universal savings percentage or comparing a synthetic monthly workload.
 */
test("representative live prompt prices are parseable", async () => {
	const prices = await catalogPromise;
	for (const id of ["deepseek/deepseek-v4-flash", "anthropic/claude-sonnet-4.5", "openai/gpt-5.1-codex"]) {
		pricePerMillion(prices.get(id)!, "prompt");
	}
});

/*
 * Verifies representative completion prices remain parseable and non-negative. Price changes are
 * expected; consumers must record catalog time, token mix, and model IDs for any comparison.
 */
test("representative live completion prices are parseable", async () => {
	const prices = await catalogPromise;
	for (const id of ["deepseek/deepseek-v4-flash", "anthropic/claude-sonnet-4.5", "openai/gpt-5.1-codex"]) {
		pricePerMillion(prices.get(id)!, "completion");
	}
});

/*
 * Verifies the documented per-token calculation produces a finite current-catalog estimate. It is
 * deliberately not a savings claim: workloads, cache discounts, provider fees, and prices vary.
 */
test("live catalog supports an explicit token-budget estimate", async () => {
	const prices = await catalogPromise;
	const model = prices.get("deepseek/deepseek-v4-flash")!;
	const estimate = requestCostUsd(model, 4_000, 1_000);
	assert.ok(Number.isFinite(estimate) && estimate >= 0, `current request estimate must be non-negative, got ${estimate}`);
});
