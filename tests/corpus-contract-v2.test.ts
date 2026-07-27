import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as any;
const plan = fixture("profile-corpus-v2-plan.json");
const schema = fixture("profile-corpus-v2.schema.json");
const legacy = fixture("golden-prompts.json");

/*
 * Verifies the ≥200 expansion target is a real partition contract: bucket counts sum to 240,
 * legacy characterization remains exactly 80, and held-out cases stay separate from tuning data.
 */
test("profile corpus v2 capacity plan is internally consistent", () => {
	assert.equal(plan.schemaVersion, 2);
	assert.equal(plan.baselineCommit, "3c4c1470bc7aba852a7738c04afc63461cd8dc7d");
	assert.ok(plan.singleTurnSpecification.targetCases >= 200);
	assert.ok(plan.heldOutEvaluation.targetCases >= 80);
	assert.ok(plan.conversationSpecification.targetSequences >= 60);
	assert.ok(plan.conversationSpecification.minimumTurns >= 200);

	const buckets = plan.singleTurnSpecification.buckets as Array<{ id: string; count: number; purpose: string }>;
	assert.equal(buckets.reduce((total, bucket) => total + bucket.count, 0), plan.singleTurnSpecification.targetCases);
	assert.equal(new Set(buckets.map((bucket) => bucket.id)).size, buckets.length);
	assert.ok(buckets.every((bucket) => bucket.count > 0 && bucket.purpose.length > 20));
	assert.equal(buckets.find((bucket) => bucket.id === "legacy-characterization")?.count, legacy.cases.length);
	assert.equal(legacy.cases.length, 80);

	const relationCounts = Object.values(plan.conversationSpecification.relations) as number[];
	assert.equal(relationCounts.reduce((total, count) => total + count, 0), plan.conversationSpecification.targetSequences);
	assert.ok(plan.heldOutEvaluation.rules.some((rule: string) => rule.includes("No tuning")));
});

/*
 * Verifies the machine-readable case schema exposes every expectation axis needed by profiler,
 * context, attribution, uncertainty, and end-to-end route evaluation before corpus population.
 */
test("profile corpus v2 schema covers the planned evaluation axes", () => {
	assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
	assert.equal(schema.properties.schemaVersion.const, 2);
	assert.deepEqual(schema.properties.suite.enum, ["characterization", "specification", "held-out"]);

	const expectationProperties = schema.$defs.expectation.properties as Record<string, unknown>;
	for (const axis of plan.requiredExpectationAxes as string[]) {
		assert.ok(axis in expectationProperties, `missing expectation axis: ${axis}`);
	}
	assert.deepEqual(
		[...schema.$defs.relation.enum].sort(),
		Object.keys(plan.conversationSpecification.relations).sort(),
	);
	assert.ok(schema.$defs.case.oneOf.length === 2);
	assert.equal(schema.$defs.case.additionalProperties, false);
	assert.equal(schema.$defs.expectation.additionalProperties, false);
});
