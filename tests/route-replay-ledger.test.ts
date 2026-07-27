import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	readRouteReplayBundleV1,
	replayRouteBundleV1,
} from "../src/route-replay.ts";

interface ReplayLedger {
	schemaVersion: number;
	baselineCommit: string;
	description: string;
	cases: Array<{
		id: string;
		file: string;
		objective: string;
		recommendationBasis: string;
		expected: string;
	}>;
}

const fixtureRoot = new URL("./fixtures/", import.meta.url);
const replayRoot = new URL("./fixtures/replays/", import.meta.url);
const ledger = JSON.parse(readFileSync(new URL("route-replay-ledger.json", fixtureRoot), "utf8")) as ReplayLedger;

function routeKey(provider: string, modelId: string, thinkingLevel: string): string {
	return `${provider}/${modelId}@${thinkingLevel}`;
}

/*
 * Verifies every frozen route-kernel characterization bundle is declared exactly once, remains
 * anchored to the approved 1.1.1 baseline, and replays with zero route or score deltas offline.
 */
test("route replay ledger remains complete and delta-free", () => {
	assert.equal(ledger.schemaVersion, 1);
	assert.equal(ledger.baselineCommit, "3c4c1470bc7aba852a7738c04afc63461cd8dc7d");
	assert.ok(ledger.description.includes("Every delta requires an explicit ledger update"));
	assert.ok(ledger.cases.length >= 9);
	assert.deepEqual([...new Set(ledger.cases.map((entry) => entry.objective))].sort(), ["balanced", "cheapest", "fastest", "quality"]);
	assert.ok(ledger.cases.some((entry) => entry.recommendationBasis === "hysteresis"));
	assert.ok(ledger.cases.some((entry) => entry.recommendationBasis === "confidence-fallback"));
	for (const id of ["vision-filter-v1", "reasoning-level-v1", "moving-alias-override-v1"]) {
		assert.ok(ledger.cases.some((entry) => entry.id === id), `missing replay branch: ${id}`);
	}

	const declared = ledger.cases.map((entry) => entry.file).sort();
	const present = readdirSync(replayRoot).filter((file) => file.endsWith(".json")).sort();
	assert.deepEqual(declared, present);
	assert.equal(new Set(ledger.cases.map((entry) => entry.id)).size, ledger.cases.length);

	for (const entry of ledger.cases) {
		const path = join(fileURLToPath(replayRoot), entry.file);
		const bundle = readRouteReplayBundleV1(path);
		const result = replayRouteBundleV1(bundle);
		assert.equal(bundle.trace.decisionId, entry.id);
		assert.equal(bundle.trace.objective, entry.objective);
		assert.equal(bundle.trace.recommendation.basis, entry.recommendationBasis);
		assert.equal(
			routeKey(bundle.trace.recommendation.provider, bundle.trace.recommendation.modelId, bundle.trace.recommendation.thinkingLevel),
			entry.expected,
		);
		assert.equal(result.matches, true, `${entry.id}: ${result.deltas.join("\n")}`);
	}
});

/*
 * Verifies checked-in replay fixtures contain derived profiles and frozen routing inputs only; they
 * must never grow a raw prompt field while becoming the regression corpus for later releases.
 */
test("route replay fixtures contain no raw prompt surface", () => {
	for (const entry of ledger.cases) {
		const raw = readFileSync(new URL(entry.file, replayRoot), "utf8");
		const parsed = JSON.parse(raw) as { trace?: { prompt?: Record<string, unknown> }; input?: Record<string, unknown> };
		assert.deepEqual(Object.keys(parsed.trace?.prompt ?? {}).sort(), ["characters", "contextMode", "followUpDisposition", "hasImages"]);
		assert.equal("prompt" in (parsed.input ?? {}), false);
		assert.equal("promptText" in (parsed.input ?? {}), false);
	}
});
