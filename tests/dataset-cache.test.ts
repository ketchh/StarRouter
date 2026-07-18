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
	return {
		fetchedAt: Date.now() - 86_400_000,
		sourceKey,
		sourceLabel: "test cache",
		models: [{
			sourceMode: "api",
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
		{ ...valid.models[0], performanceByPromptLength: [{ promptLengthType: "tiny", medianOutputSpeed: 10 }] },
		{ ...valid.models[0], performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: "fast" }] },
	];
	for (const invalidModel of invalidModels) {
		assert.equal(isUsableAaDataset({ ...valid, models: [invalidModel] }, sourceKey), false);
	}

	const validProfile = {
		...valid.models[0],
		codingIndex: 75,
		performanceByPromptLength: [{ promptLengthType: "medium", medianOutputSpeed: 100 }],
	};
	assert.equal(isUsableAaDataset({ ...valid, models: [validProfile] }, sourceKey), true);
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
	const dataset = cachedDataset(buildDataSourceCacheKey(config()));
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
		await assert.rejects(fetchAaModelsViaApi(config(), Date.now()), /no usable models/);
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
	const routerConfig = config();
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
		const dataset = await fetchAaModels(config(), cacheFile, { forceRefresh: true, shouldPersist: () => false });
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
	const routerConfig = config();
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
		await assert.rejects(fetchAaModelsViaApi(config(), Date.now()), /exceeds/);
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
