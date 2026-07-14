import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	DEFAULT_CONFIG,
	buildAaApiUrl,
	buildAaRequestHeaders,
	getProjectConfigFile,
	loadConfig,
	normalizeRouterConfig,
	saveConfigForScope,
	writeTextFileAtomically,
	type RouterConfig,
} from "../src/router-core.ts";

function tempDir(t: test.TestContext): string {
	const dir = mkdtempSync(join(tmpdir(), "star-router-config-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/*
 * Verifies that project persistence contains only routing policy and never copies privileged
 * network endpoint or environment-secret configuration into a repository-controlled file.
 */
test("project config persistence excludes global-only controls", (t) => {
	const cwd = tempDir(t);
	const config = normalizeRouterConfig({
		...structuredClone(DEFAULT_CONFIG),
		enabled: true,
		dataSource: {
			...structuredClone(DEFAULT_CONFIG.dataSource),
			baseUrl: "https://private.example.test",
			apiKeyEnv: "PRIVATE_AA_TOKEN",
		},
		strategy: { ...structuredClone(DEFAULT_CONFIG.strategy), objective: "quality", routingProvider: "private-provider" },
		ui: { showAdvancedSettings: true, autoAcceptRouting: true },
	} as RouterConfig);

	const path = saveConfigForScope("project", cwd, config);
	const persisted = JSON.parse(readFileSync(path, "utf8"));

	assert.equal("enabled" in persisted, false);
	assert.equal("dataSource" in persisted, false);
	assert.equal("routingProvider" in persisted.strategy, false);
	assert.equal("autoAcceptRouting" in persisted.ui, false);
	assert.equal(persisted.strategy.objective, "quality");
	assert.equal(persisted.ui.showAdvancedSettings, true);
});

/*
 * Verifies that repository-controlled project config cannot override endpoint or secret names,
 * while safe project routing preferences still override the global/default configuration.
 */
test("project config cannot override global-only controls", (t) => {
	const cleanCwd = tempDir(t);
	const projectCwd = tempDir(t);
	const baseline = loadConfig(cleanCwd);
	const projectPath = getProjectConfigFile(projectCwd);
	mkdirSync(dirname(projectPath), { recursive: true });
	writeFileSync(projectPath, JSON.stringify({
		enabled: !baseline.enabled,
		dataSource: {
			baseUrl: "https://attacker.example.test",
			apiPath: "/collect",
			apiKeyEnv: "HOME",
		},
		strategy: { objective: "quality", routingProvider: "attacker-provider" },
		ui: { showAdvancedSettings: true, autoAcceptRouting: !baseline.ui.autoAcceptRouting },
	}), "utf8");

	const loaded = loadConfig(projectCwd);

	assert.equal(loaded.enabled, baseline.enabled);
	assert.deepEqual(loaded.dataSource, baseline.dataSource);
	assert.equal(loaded.strategy.routingProvider, baseline.strategy.routingProvider);
	assert.equal(loaded.ui.autoAcceptRouting, baseline.ui.autoAcceptRouting);
	assert.equal(loaded.strategy.objective, "quality");
	assert.equal(loaded.ui.showAdvancedSettings, true);
});

/*
 * Verifies that AA credentials are attached only to the official HTTPS origin; user-configured
 * global mirrors remain usable but receive no Authorization or x-api-key headers.
 */
test("AA request headers never send secrets to custom origins", () => {
	const previous = process.env.STAR_ROUTER_TEST_AA_KEY;
	process.env.STAR_ROUTER_TEST_AA_KEY = "super-secret";
	try {
		const official = normalizeRouterConfig({
			...structuredClone(DEFAULT_CONFIG),
			dataSource: { ...structuredClone(DEFAULT_CONFIG.dataSource), apiKeyEnv: "STAR_ROUTER_TEST_AA_KEY" },
		} as RouterConfig);
		const custom = normalizeRouterConfig({
			...structuredClone(official),
			dataSource: { ...structuredClone(official.dataSource), baseUrl: "https://mirror.example.test" },
		} as RouterConfig);

		assert.equal(buildAaRequestHeaders(official).authorization, "Bearer super-secret");
		assert.equal(buildAaRequestHeaders(official)["x-api-key"], "super-secret");
		assert.equal(buildAaRequestHeaders(custom).authorization, undefined);
		assert.equal(buildAaRequestHeaders(custom)["x-api-key"], undefined);
	} finally {
		if (previous === undefined) delete process.env.STAR_ROUTER_TEST_AA_KEY;
		else process.env.STAR_ROUTER_TEST_AA_KEY = previous;
	}
});

/*
 * Verifies that hostile absolute, protocol-relative, and backslash apiPath values cannot redirect
 * an official AA request or its credential headers to a different origin.
 */
test("AA apiPath cannot escape its configured origin", () => {
	const hostilePaths = [
		"https://attacker.example.test/collect",
		"//attacker.example.test/collect",
		"\\\\attacker.example.test\\collect",
	];
	for (const apiPath of hostilePaths) {
		const hostile = normalizeRouterConfig({
			...structuredClone(DEFAULT_CONFIG),
			dataSource: { ...structuredClone(DEFAULT_CONFIG.dataSource), apiPath },
		} as RouterConfig);
		assert.throws(() => buildAaApiUrl(hostile), /must stay|backslashes/);
		assert.throws(() => buildAaRequestHeaders(hostile), /must stay|backslashes/);
	}

	const sameOrigin = normalizeRouterConfig({
		...structuredClone(DEFAULT_CONFIG),
		dataSource: {
			...structuredClone(DEFAULT_CONFIG.dataSource),
			apiPath: "https://artificialanalysis.ai/api/data/website/host-models/performance",
		},
	} as RouterConfig);
	assert.equal(new URL(buildAaApiUrl(sameOrigin)).origin, "https://artificialanalysis.ai");
});

/*
 * Verifies atomic persistence preserves the previous file and removes its temporary file when the
 * final rename fails.
 */
test("atomic config writes preserve the previous file and clean temp files on rename failure", (t) => {
	const cwd = tempDir(t);
	const path = join(cwd, "model-router.json");
	writeFileSync(path, "original\n", "utf8");
	let temporaryPath = "";

	assert.throws(() => writeTextFileAtomically(path, "replacement\n", 0o600, {
		write(tempPath, content, mode) {
			temporaryPath = tempPath;
			writeFileSync(tempPath, content, { encoding: "utf8", mode });
		},
		rename(_from, _to) {
			throw new Error("simulated rename failure");
		},
		remove(tempPath) {
			unlinkSync(tempPath);
		},
	}), /simulated rename failure/);

	assert.equal(readFileSync(path, "utf8"), "original\n");
	assert.equal(existsSync(temporaryPath), false);
});

/*
 * Verifies malformed numeric and enum values are clamped or reset conservatively instead of
 * propagating NaN, invalid modes, or unbounded network settings into runtime scoring.
 */
test("config normalization validates enums and numeric ranges", () => {
	const normalized = normalizeRouterConfig({
		...structuredClone(DEFAULT_CONFIG),
		dataSource: {
			...structuredClone(DEFAULT_CONFIG.dataSource),
			mode: "remote" as never,
			cacheTtlMinutes: -10,
			requestTimeoutMs: "not-a-number" as never,
			parallelQueries: 999,
			promptLength: "tiny" as never,
		},
		strategy: {
			...structuredClone(DEFAULT_CONFIG.strategy),
			objective: "random" as never,
			qualityFloor: 5,
			preferCurrentWithin: -1,
			minAaMatch: Number.NaN,
			minRouteConfidence: 3,
		},
	} as RouterConfig);

	assert.equal(normalized.dataSource.mode, DEFAULT_CONFIG.dataSource.mode);
	assert.equal(normalized.dataSource.cacheTtlMinutes, 1);
	assert.equal(normalized.dataSource.requestTimeoutMs, DEFAULT_CONFIG.dataSource.requestTimeoutMs);
	assert.equal(normalized.dataSource.parallelQueries, 32);
	assert.equal(normalized.dataSource.promptLength, DEFAULT_CONFIG.dataSource.promptLength);
	assert.equal(normalized.strategy.objective, DEFAULT_CONFIG.strategy.objective);
	assert.equal(normalized.strategy.qualityFloor, 0.99);
	assert.equal(normalized.strategy.preferCurrentWithin, 0);
	assert.equal(normalized.strategy.minAaMatch, DEFAULT_CONFIG.strategy.minAaMatch);
	assert.equal(normalized.strategy.minRouteConfidence, 1);
});
