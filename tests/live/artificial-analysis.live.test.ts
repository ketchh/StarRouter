import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	DEFAULT_CONFIG,
	buildDataSourceCacheKey,
	clearAaMatchCache,
	fetchAaModels,
	isUsableAaDataset,
	normalizeAaModelsForRouting,
	normalizeKey,
	normalizeRouterConfig,
	pickAaMatchForPiModel,
	variantLevelFromAaModel,
	type RouterConfig,
} from "../../src/router-core.ts";

const supportedPromptLengths = new Set(["medium", "medium_coding", "long", "vision_single_image", "100k"]);
const config = normalizeRouterConfig({
	...structuredClone(DEFAULT_CONFIG),
	strategy: { ...structuredClone(DEFAULT_CONFIG.strategy), routingProvider: "openrouter" },
	modelOverrides: {},
} as RouterConfig);

/* One shared default acquisition for this opt-in file. The persistence callback prevents the live
 * observation from changing the user's normal StarRouter cache. */
const datasetPromise = fetchAaModels(config, join(tmpdir(), `star-router-aa-live-${process.pid}-${Date.now()}.json`), {
	forceRefresh: true,
	shouldPersist: () => false,
});

/*
 * Verifies the current default AA acquisition trims and validates a non-empty dataset. This is an
 * external schema observation, not a frozen row-count or benchmark claim.
 */
test("live Artificial Analysis dataset remains parseable", async () => {
	const dataset = await datasetPromise;
	assert.equal(dataset.provenance, "network");
	assert.ok(dataset.models.length > 0);
	assert.equal(isUsableAaDataset(dataset, buildDataSourceCacheKey(config)), true);
});

/*
 * Verifies current rows retain only routing-supported prompt profiles and that the host-model API
 * still supplies host metadata on at least one row.
 */
test("live Artificial Analysis profiles and host metadata remain usable", async () => {
	const dataset = await datasetPromise;
	assert.ok(dataset.models.every((model) => model.performanceByPromptLength.every((profile) => supportedPromptLengths.has(profile.promptLengthType))));
	assert.ok(dataset.models.some((model) => [model.hostLabel, model.hostSlug].some((value) => typeof value === "string" && value.length > 0)));
});

/*
 * Verifies at least one current identity-compatible OpenRouter route can use a non-OpenRouter AA
 * host row explicitly as model-only evidence, never as verified host economics.
 */
test("live OpenRouter matching falls back to model-only AA evidence", async () => {
	const rows = normalizeAaModelsForRouting((await datasetPromise).models);
	let observed: { model: Model<Api>; slug: string } | undefined;
	for (const row of rows) {
		if (!row.creatorName || /(^|-)(latest|auto|default|free)($|-)/.test(normalizeKey(row.slug))) continue;
		const vendor = normalizeKey(row.creatorName);
		const model = {
			api: "openai-completions",
			provider: "openrouter",
			id: `${vendor}/${row.slug}`,
			name: row.name,
			reasoning: row.reasoningModel,
			input: ["text"],
			cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
			contextWindow: row.contextWindowTokens ?? 128_000,
			maxTokens: 16_384,
		} as Model<Api>;
		clearAaMatchCache();
		const match = pickAaMatchForPiModel(model, rows, variantLevelFromAaModel(row), config);
		if (match?.evidenceScope === "model-only") {
			observed = { model, slug: match.aaModel.slug };
			break;
		}
	}
	assert.ok(observed, "expected at least one current identity-compatible model-only OpenRouter match");
	assert.ok(observed.model.id.length > 0 && observed.slug.length > 0);
});
