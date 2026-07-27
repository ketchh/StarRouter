#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DECISION_TRACE_MAX_BYTES,
	formatDecisionTraceV1,
	isDecisionTraceV1,
} from "../src/decision-trace.ts";
import {
	isRouteReplayBundleV1,
	replayRouteBundleV1,
	type RouteReplayBundleV1,
} from "../src/route-replay.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = join(root, "tests", "fixtures", "replays");
const samplesPerFixture = positiveInteger(process.env.STARROUTER_PERF_SAMPLES, 20);
const replayP95BudgetMs = positiveNumber(process.env.STARROUTER_REPLAY_P95_BUDGET_MS, 75);
const traceP95BudgetMs = positiveNumber(process.env.STARROUTER_TRACE_P95_BUDGET_MS, 5);

function positiveInteger(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1_000) throw new Error("STARROUTER_PERF_SAMPLES must be an integer from 1 to 1000");
	return parsed;
}

function positiveNumber(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Performance budgets must be positive finite numbers");
	return parsed;
}

function percentile(values: number[], quantile: number): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))]!;
}

function summary(values: number[]) {
	return {
		samples: values.length,
		p50Ms: percentile(values, 0.5),
		p95Ms: percentile(values, 0.95),
		maxMs: Math.max(...values),
	};
}

function timed<T>(operation: () => T): { durationMs: number; value: T } {
	const startedAt = performance.now();
	const value = operation();
	return { durationMs: performance.now() - startedAt, value };
}

const fixtureFiles = readdirSync(fixtureDirectory)
	.filter((name) => name.endsWith(".json"))
	.sort();
assert.ok(fixtureFiles.length >= 9, "observability performance corpus must contain at least nine replay fixtures");

const bundles = fixtureFiles.map((name) => {
	const value: unknown = JSON.parse(readFileSync(join(fixtureDirectory, name), "utf8"));
	assert.ok(isRouteReplayBundleV1(value), `${name} is not a valid replay bundle`);
	return { name, bundle: value as RouteReplayBundleV1 };
});

// Warm both JIT and deterministic match paths before collecting release evidence.
for (let iteration = 0; iteration < 3; iteration += 1) {
	for (const { name, bundle } of bundles) {
		const result = replayRouteBundleV1(bundle);
		assert.equal(result.matches, true, `${name} produced a replay delta during warmup`);
	}
}

const replayDurations: number[] = [];
const traceDurations: number[] = [];
for (let iteration = 0; iteration < samplesPerFixture; iteration += 1) {
	for (const { name, bundle } of bundles) {
		const replay = timed(() => replayRouteBundleV1(bundle));
		assert.equal(replay.value.matches, true, `${name} produced a replay delta`);
		replayDurations.push(replay.durationMs);

		const trace = timed(() => {
			assert.equal(isDecisionTraceV1(bundle.trace), true);
			const formatted = formatDecisionTraceV1(bundle.trace);
			assert.ok(formatted.length > 0);
			assert.ok(Buffer.byteLength(JSON.stringify(bundle.trace), "utf8") <= DECISION_TRACE_MAX_BYTES);
		});
		traceDurations.push(trace.durationMs);
	}
}

const replaySummary = summary(replayDurations);
const traceSummary = summary(traceDurations);
const report = {
	fixtureCount: bundles.length,
	samplesPerFixture,
	budgets: {
		replayVerifyP95Ms: replayP95BudgetMs,
		traceValidateFormatP95Ms: traceP95BudgetMs,
	},
	observed: {
		replayVerify: replaySummary,
		traceValidateFormat: traceSummary,
	},
};

console.log(JSON.stringify(report, null, 2));
assert.ok(replaySummary.p95Ms <= replayP95BudgetMs, `replay verify p95 ${replaySummary.p95Ms.toFixed(3)} ms exceeds ${replayP95BudgetMs} ms`);
assert.ok(traceSummary.p95Ms <= traceP95BudgetMs, `trace validate/format p95 ${traceSummary.p95Ms.toFixed(3)} ms exceeds ${traceP95BudgetMs} ms`);
