import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_CONFIG,
	buildDataSourceCacheKey,
	fetchAaModels,
	fetchAaModelsViaApi,
	fetchAaModelsViaPage,
	isUsableAaDataset,
	normalizeRouterConfig,
	parsePromptSpeedProfiles,
	saveCache,
	type AaDataset,
	type RouterConfig,
} from "../src/router-core.ts";

function config(): RouterConfig {
	return normalizeRouterConfig(structuredClone(DEFAULT_CONFIG) as RouterConfig);
}

function legacyApiConfig(): RouterConfig {
	const value = config();
	value.dataSource.mode = "api";
	value.dataSource.apiPath = "/test/host-models";
	return value;
}

function tempCache(t: test.TestContext): string {
	const dir = mkdtempSync(join(tmpdir(), "star-router-cache-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return join(dir, "cache.json");
}

function silenceExpectedRouterErrors(t: test.TestContext): void {
	const original = console.error;
	console.error = () => {};
	t.after(() => { console.error = original; });
}

function cachedDataset(sourceKey: string): AaDataset {
	const descriptor = (() => { try { return JSON.parse(sourceKey) as { modelOnlyEvidence?: boolean }; } catch { return {}; } })();
	return {
		fetchedAt: Date.now() - 86_400_000,
		sourceKey,
		sourceLabel: "test cache",
		models: [{
			sourceMode: descriptor.modelOnlyEvidence === true ? "page-scrape" : "api",
			slug: "test-model",
			name: "Test Model",
			shortName: "Test",
			reasoningModel: false,
			inputModalityImage: false,
			performanceByPromptLength: [],
		}],
	};
}

/*
 * Verifies that structurally empty datasets and caches from a different source configuration are
 * rejected before they can influence routing.
 */
test("dataset validation rejects empty and source-mismatched caches", () => {
	const expectedKey = buildDataSourceCacheKey(config());
	assert.equal(isUsableAaDataset({ fetchedAt: Date.now(), sourceKey: expectedKey, sourceLabel: "empty", models: [] }, expectedKey), false);
	assert.equal(isUsableAaDataset(cachedDataset("different-source"), expectedKey), false);
	assert.equal(isUsableAaDataset(cachedDataset(expectedKey), expectedKey), true);
});

/*
 * Verifies that cache validation rejects future timestamps and malformed required AA model fields,
 * enums, booleans, optional metrics, and prompt-speed profiles.
 */
test("dataset validation rejects future timestamps and malformed model data", () => {
	const sourceKey = buildDataSourceCacheKey(config());
	const valid = cachedDataset(sourceKey);
	assert.equal(isUsableAaDataset({ ...valid, fetchedAt: Date.now() + 6 * 60_000 }, sourceKey), false);

	const invalidModels: unknown[] = [
		{ ...valid.models[0], sourceMode: "remote" },
		{ ...valid.models[0], shortName: undefined },
		{ ...valid.models[0], reasoningModel: "false" },
		{ ...valid.models[0], inputModalityImage: 0 },
		{ ...valid.models[0], codingIndex: Number.NaN },
		{ ...valid.models[0], codingIndex: 201 },
		{ ...valid.models[0], modelUrl: "evil\u001b[2J" },
		{ ...valid.models[0], contextWindowTokens: 0 },
		{ ...valid.models[0], priceInputPer1M: -1 },
		{ ...valid.models[0], performanceByPromptLength: [{ promptLengthType: "tiny", medianOutputSpeed: 10 }] },
		{ ...valid.models[0], performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: "fast" }] },
		{ ...valid.models[0], performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: -1 }] },
		{ ...valid.models[0], hostLabel: valid.models[0]?.sourceMode === "page-scrape" ? "OpenRouter" : undefined },
	];
	for (const invalidModel of invalidModels) {
		assert.equal(isUsableAaDataset({ ...valid, models: [invalidModel] }, sourceKey), false);
	}

	const apiSourceKey = buildDataSourceCacheKey(legacyApiConfig());
	const apiValid = cachedDataset(apiSourceKey);
	const validProfile = {
		...apiValid.models[0],
		codingIndex: 75,
		performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: 100 }],
	};
	assert.equal(isUsableAaDataset({ ...apiValid, models: [validProfile] }, apiSourceKey), true);

	for (const apiPath of [
		DEFAULT_CONFIG.dataSource.apiPath,
		"api/v2/language/models",
		"https://artificialanalysis.ai/api/v2/language/models",
	]) {
		const v2Config = config();
		v2Config.dataSource.mode = "api";
		v2Config.dataSource.apiPath = apiPath;
		const v2SourceKey = buildDataSourceCacheKey(v2Config);
		const v2Valid = cachedDataset(v2SourceKey);
		assert.equal(isUsableAaDataset(v2Valid, v2SourceKey), true);
		assert.equal(isUsableAaDataset({
			...v2Valid,
			models: [{ ...v2Valid.models[0], sourceMode: "api", hostLabel: "OpenRouter", priceInputPer1M: 1 }],
		}, v2SourceKey), false);
	}
});

/*
 * Verifies new optional AA prompt buckets are ignored without invalidating recognized routing
 * profiles or widening StarRouter's supported prompt-length union.
 */
test("AA profile parsing ignores unknown optional buckets", () => {
	const profiles = parsePromptSpeedProfiles([
		{ prompt_length_type: "medium_parallel", median_output_speed: 999 },
		{ prompt_length_type: "medium", median_output_speed: 100, median_end_to_end_response_time: 5 },
	]);
	assert.deepEqual(profiles.map((profile) => profile.promptLengthType), ["medium"]);
	assert.deepEqual(parsePromptSpeedProfiles(Array.from({ length: 33 }, () => ({ prompt_length_type: "medium" }))), []);
	const dataset = cachedDataset(buildDataSourceCacheKey(legacyApiConfig()));
	dataset.models[0]!.performanceByPromptLength = profiles;
	assert.equal(isUsableAaDataset(dataset, dataset.sourceKey), true);
});

/*
 * Verifies that a successful AA response containing no usable rows is treated as an invalid dataset
 * rather than cached as a valid but route-empty success.
 */
test("AA API rejects empty model datasets", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({ hostModels: [] }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
	try {
		await assert.rejects(fetchAaModelsViaApi(legacyApiConfig(), Date.now()), /no usable models/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/*
 * Current AA Flight includes an identity-only models array before the full camelCase rows.
 */
test("current AA leaderboard rows parse only full model-quality evidence", async () => {
	const identityOnly = {
		slug: "navigation-row", name: "Navigation Row", deprecated: false, isReasoning: false,
		creator: { name: "Example" },
	};
	const full = {
		id: "model-1", slug: "current-model", name: "Current Model", shortName: "Current",
		deprecated: false, isReasoning: true, inputModalityImage: true, modelCreatorName: "Example",
		codingIndex: 0.81, terminalbenchHard: 0.42, price1mInputTokens: 99,
		medianOutputTokensPerSecond: 999, contextWindowTokens: 1_000_000, hostLabel: "Untrusted Host",
	};
	const noQuality = { ...full, id: "model-2", slug: "no-quality", codingIndex: null, terminalbenchHard: null };
	const decoded = `prefix "models":${JSON.stringify([identityOnly])} middle "models":${JSON.stringify([full, noQuality])} suffix`;
	const html = `<script>self.__next_f.push([1,${JSON.stringify(decoded)}])</script>`;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (_input, init) => {
		assert.equal(init?.redirect, "error");
		return new Response(html, { status: 200 });
	};
	try {
		const dataset = await fetchAaModelsViaPage(config(), Date.now());
		assert.equal(dataset.models.length, 1);
		assert.deepEqual(dataset.models[0], {
			sourceMode: "page-scrape",
			slug: "current-model",
			name: "Current Model",
			shortName: "Current",
			creatorName: "Example",
			modelUrl: undefined,
			intelligenceIndex: undefined,
			agenticIndex: undefined,
			codingIndex: 0.81,
			gdpvalNormalized: undefined,
			tau2: undefined,
			terminalbenchHard: 0.42,
			scicode: undefined,
			livecodebench: undefined,
			ifbench: undefined,
			omniscience: undefined,
			gpqa: undefined,
			hle: undefined,
			critpt: undefined,
			lcr: undefined,
			reasoningModel: true,
			inputModalityImage: true,
			performanceByPromptLength: [],
		});
		assert.match(dataset.sourceLabel, /model-only/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/*
 * The supported V2 collection is paginated and remains model-only without deployment identity.
 */
test("AA V2 pages are joined and downgraded to model-only evidence", async () => {
	const routerConfig = config();
	routerConfig.dataSource.mode = "api";
	const rows = [
		{ slug: "v2-one", name: "V2 One", model_creator: { name: "Example" }, reasoning_model: true, evaluations: { artificial_analysis_coding_index: 0.7 } },
		{ slug: "v2-two", name: "V2 Two", model_creator: { name: "Example" }, reasoning_model: false, input_modality_image: true, evaluations: { artificial_analysis_intelligence_index: 42 } },
	];
	let calls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input) => {
		calls += 1;
		const page = Number(new URL(String(input)).searchParams.get("page"));
		return new Response(JSON.stringify({
			pagination: { page, page_size: 1, total_pages: 2, has_more: page === 1 },
			data: [rows[page - 1]],
		}), { status: 200, headers: { "content-type": "application/json" } });
	};
	try {
		const dataset = await fetchAaModelsViaApi(routerConfig, Date.now());
		assert.equal(calls, 2);
		assert.deepEqual(dataset.models.map((model) => [model.slug, model.sourceMode]), [
			["v2-one", "page-scrape"], ["v2-two", "page-scrape"],
		]);
		assert.ok(dataset.models.every((model) => model.hostLabel === undefined
			&& model.priceInputPer1M === undefined && model.performanceByPromptLength.length === 0));
		assert.match(dataset.sourceLabel, /V2 model-only/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/*
 * Explicit V2 auth/entitlement failures must not be disguised as a successful page fallback.
 */
test("AA V2 access denial fails closed without scraping", async (t) => {
	const routerConfig = config();
	routerConfig.dataSource.mode = "api";
	let calls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => { calls += 1; return new Response("denied", { status: 401 }); };
	try {
		await assert.rejects(fetchAaModels(routerConfig, tempCache(t), { forceRefresh: true }), /HTTP 401/);
		assert.equal(calls, 1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/*
 * V2 parser selection is endpoint-bound and requires explicit reasoning/modality identity.
 */
test("AA V2 rejects legacy host envelopes and incomplete identity", async () => {
	const routerConfig = config();
	routerConfig.dataSource.mode = "api";
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async () => new Response(JSON.stringify({ hostModels: [{ host_label: "OpenRouter" }] }), { status: 200 });
		await assert.rejects(fetchAaModelsViaApi(routerConfig, Date.now()), /data\[\] and pagination/);
		globalThis.fetch = async () => new Response(JSON.stringify({
			pagination: { page: 1, page_size: 1, total_pages: 1, has_more: false },
			data: [{ slug: "ambiguous", name: "Ambiguous", model_creator: { name: "Example" }, evaluations: { artificial_analysis_intelligence_index: 42 } }],
		}), { status: 200 });
		await assert.rejects(fetchAaModelsViaApi(routerConfig, Date.now()), /no usable models/);
		globalThis.fetch = async () => new Response(JSON.stringify({
			pagination: { page: 1, page_size: 1, total_pages: 1, has_more: false },
			data: [{ slug: "outlier", name: "Outlier", model_creator: { name: "Example" }, reasoning_model: false, evaluations: { artificial_analysis_coding_index: 1_000_000_000 } }],
		}), { status: 200 });
		await assert.rejects(fetchAaModelsViaApi(routerConfig, Date.now()), /no usable models/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/*
 * Verifies that stale-cache recovery refuses a structurally valid cache produced for a different
 * source key when both the API and page fallback fail.
 */
test("fetch does not reuse stale cache from a different source", async (t) => {
	silenceExpectedRouterErrors(t);
	const cacheFile = tempCache(t);
	writeFileSync(cacheFile, JSON.stringify(cachedDataset("different-source")), "utf8");
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => { throw new Error("offline"); };
	try {
		await assert.rejects(fetchAaModels(config(), cacheFile), /offline/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/*
 * Verifies that API-to-page fallback persists the configured API cache key, so a successful fallback
 * remains reusable for the configured TTL instead of forcing a fetch on every new session.
 */
test("API page fallback keeps the requested cache key", async (t) => {
	silenceExpectedRouterErrors(t);
	const cacheFile = tempCache(t);
	const routerConfig = legacyApiConfig();
	const rawModel = {
		slug: "fallback-model",
		name: "Fallback Model",
		short_name: "Fallback",
		reasoning_model: false,
		input_modality_image: false,
	};
	const decoded = `prefix \"defaultData\":${JSON.stringify([rawModel])} suffix`;
	const html = `<script>self.__next_f.push([1,${JSON.stringify(decoded)}])</script>`;
	let calls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		calls += 1;
		if (calls === 1) return new Response("api unavailable", { status: 503 });
		return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
	};
	try {
		const dataset = await fetchAaModels(routerConfig, cacheFile);
		const persisted = JSON.parse(readFileSync(cacheFile, "utf8")) as AaDataset;
		const expectedKey = buildDataSourceCacheKey(routerConfig);

		assert.equal(calls, 2);
		assert.equal(dataset.sourceKey, expectedKey);
		assert.match(dataset.sourceLabel, /API fallback/);
		assert.equal(persisted.sourceKey, expectedKey);
		assert.equal(persisted.models.length, 1);
		assert.equal(persisted.models[0]?.hostSlug, undefined);
		assert.equal(persisted.provenance, undefined);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/*
 * Verifies that a valid stale cache for the exact source remains the final offline fallback when
 * both network acquisition modes fail.
 */
test("fetch reuses only compatible stale cache after network failure", async (t) => {
	silenceExpectedRouterErrors(t);
	const cacheFile = tempCache(t);
	const routerConfig = config();
	const sourceKey = buildDataSourceCacheKey(routerConfig);
	writeFileSync(cacheFile, JSON.stringify(cachedDataset(sourceKey)), "utf8");
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => { throw new Error("offline"); };
	try {
		const dataset = await fetchAaModels(routerConfig, cacheFile);
		assert.equal(dataset.sourceKey, sourceKey);
		assert.equal(dataset.models[0]?.slug, "test-model");
		assert.equal(dataset.provenance, "stale-fallback");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/*
 * Source-compatible cache data still expires as a fallback after the bounded stale window.
 */
test("fetch rejects excessively old stale cache", async (t) => {
	silenceExpectedRouterErrors(t);
	const cacheFile = tempCache(t);
	const routerConfig = config();
	const sourceKey = buildDataSourceCacheKey(routerConfig);
	const cached = cachedDataset(sourceKey);
	cached.fetchedAt = Date.now() - 31 * 24 * 60 * 60_000;
	writeFileSync(cacheFile, JSON.stringify(cached), "utf8");
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => { throw new Error("offline"); };
	try {
		await assert.rejects(fetchAaModels(routerConfig, cacheFile), /offline/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/*
 * Verifies an explicit refresh bypasses a still-fresh disk cache and records network provenance.
 */
test("forced refresh bypasses fresh cache", async (t) => {
	const cacheFile = tempCache(t);
	const routerConfig = config();
	routerConfig.dataSource.mode = "page-scrape";
	const sourceKey = buildDataSourceCacheKey(routerConfig);
	writeFileSync(cacheFile, JSON.stringify({ ...cachedDataset(sourceKey), fetchedAt: Date.now() }), "utf8");
	const rawModel = { slug: "network-model", name: "Network Model", short_name: "Network", reasoning_model: false, input_modality_image: false };
	const decoded = `prefix \"defaultData\":${JSON.stringify([rawModel])} suffix`;
	const html = `<script>self.__next_f.push([1,${JSON.stringify(decoded)}])</script>`;
	let calls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => { calls += 1; return new Response(html, { status: 200 }); };
	try {
		const dataset = await fetchAaModels(routerConfig, cacheFile, { forceRefresh: true });
		assert.equal(calls, 1);
		assert.equal(dataset.models[0]?.slug, "network-model");
		assert.equal(dataset.provenance, "network");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/*
 * Verifies an obsolete dataset generation can finish for its caller without overwriting a newer
 * cache snapshot when the runtime persistence guard turns false.
 */
test("obsolete dataset generations do not persist cache writes", async (t) => {
	const cacheFile = tempCache(t);
	const rawModel = { slug: "network-model", name: "Network Model", short_name: "Network", reasoning_model: false, input_modality_image: false };
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({ hostModels: [{ ...rawModel, host_label: "OpenRouter", host: { slug: "openrouter" } }] }), { status: 200 });
	try {
		const dataset = await fetchAaModels(legacyApiConfig(), cacheFile, { forceRefresh: true, shouldPersist: () => false });
		assert.equal(dataset.provenance, "network");
		assert.equal(existsSync(cacheFile), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/*
 * Verifies a cache rename failure cannot discard already validated network data, replace an older
 * valid snapshot, or leave a temporary file behind.
 */
test("cache persistence failure keeps fresh network data authoritative", async (t) => {
	silenceExpectedRouterErrors(t);
	const cacheFile = tempCache(t);
	const routerConfig = legacyApiConfig();
	const sourceKey = buildDataSourceCacheKey(routerConfig);
	writeFileSync(cacheFile, JSON.stringify(cachedDataset(sourceKey)), "utf8");
	const rawModel = { slug: "network-model", name: "Network Model", short_name: "Network", reasoning_model: false, input_modality_image: false };
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({ hostModels: [{ ...rawModel, host_label: "OpenRouter", host: { slug: "openrouter" } }] }), { status: 200 });
	let temporaryPath = "";
	try {
		const dataset = await fetchAaModels(routerConfig, cacheFile, {
			forceRefresh: true,
			cacheWriteOperations: {
				write(path, content, mode) {
					temporaryPath = path;
					writeFileSync(path, content, { encoding: "utf8", mode });
				},
				rename() { throw new Error("simulated cache rename failure"); },
				remove(path) { unlinkSync(path); },
			},
		});
		const persisted = JSON.parse(readFileSync(cacheFile, "utf8")) as AaDataset;
		assert.equal(dataset.provenance, "network");
		assert.equal(dataset.models[0]?.slug, "network-model");
		assert.equal(persisted.models[0]?.slug, "test-model");
		assert.equal(existsSync(temporaryPath), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

/*
 * Verifies response/cache size guards reject declared oversized responses and ignore oversized cache
 * files before parsing them.
 */
test("dataset acquisition bounds response and cache bytes", async (t) => {
	silenceExpectedRouterErrors(t);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response("{}", { status: 200, headers: { "content-length": String(64 * 1024 * 1024) } });
	try {
		await assert.rejects(fetchAaModelsViaApi(legacyApiConfig(), Date.now()), /exceeds/);
	} finally {
		globalThis.fetch = originalFetch;
	}

	const cacheFile = tempCache(t);
	writeFileSync(cacheFile, "x");
	truncateSync(cacheFile, 41 * 1024 * 1024);
	globalThis.fetch = async () => { throw new Error("network attempted after oversized cache"); };
	try {
		await assert.rejects(fetchAaModels(config(), cacheFile), /network attempted/);
	} finally {
		globalThis.fetch = originalFetch;
	}

	writeFileSync(cacheFile, "original", "utf8");
	assert.throws(() => saveCache(cacheFile, { payload: "x".repeat(32) }, undefined, 16), /cache exceeds/);
	assert.equal(readFileSync(cacheFile, "utf8"), "original");
});

/*
 * Verifies external strings/control bytes and pathological model/profile counts cannot enter the
 * trusted routing dataset.
 */
test("dataset validation bounds external strings and collection counts", () => {
	const sourceKey = buildDataSourceCacheKey(config());
	const valid = cachedDataset(sourceKey);
	assert.equal(isUsableAaDataset({ ...valid, models: [{ ...valid.models[0], name: "evil\u001b[2J" }] }, sourceKey), false);
	assert.equal(isUsableAaDataset({ ...valid, models: [{ ...valid.models[0], performanceByPromptLength: Array.from({ length: 33 }, () => ({ promptLengthType: "medium" })) }] }, sourceKey), false);
	assert.equal(isUsableAaDataset({ ...valid, models: Array.from({ length: 20_001 }, () => valid.models[0]) }, sourceKey), false);
});
