import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CONFIG, inferPromptProfile, isContextDependentFollowUp } from "../src/router-core.ts";

interface FollowUpCase {
	id: string;
	priorTask: string;
	followUp: string;
	currentDisposition: "keep-current-route" | "route-local-only";
	desiredRelation: "continuation" | "refinement" | "escalation" | "narrowing" | "new-task" | "ambiguous";
}

interface FollowUpCharacterization {
	schemaVersion: number;
	baselineCommit: string;
	description: string;
	cases: FollowUpCase[];
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/follow-up-characterization-v1.json", import.meta.url), "utf8")) as FollowUpCharacterization;

/*
 * Freezes the 1.1.1 dispatch boundary: exact acknowledgements keep the active route while every
 * context-bearing follow-up is independently profiled from its local text. These are observed
 * semantics, not approval of the current limitation.
 */
test("follow-up characterization matches the 1.1.1 dispatch boundary", async () => {
	assert.equal(fixture.schemaVersion, 1);
	assert.equal(fixture.baselineCommit, "3c4c1470bc7aba852a7738c04afc63461cd8dc7d");
	assert.match(fixture.description, /not desired semantics/);
	assert.ok(fixture.cases.length >= 20);
	assert.equal(new Set(fixture.cases.map((entry) => entry.id)).size, fixture.cases.length);

	for (const entry of fixture.cases) {
		const skipped = isContextDependentFollowUp(entry.followUp);
		assert.equal(skipped, entry.currentDisposition === "keep-current-route", entry.id);
		if (!skipped) {
			const localProfile = await inferPromptProfile(DEFAULT_CONFIG, entry.followUp, false);
			assert.ok(localProfile.summary.length > 0, entry.id);
			assert.equal("contextRelation" in localProfile, false, entry.id);
			assert.equal("inheritedSignals" in localProfile, false, entry.id);
		}
	}
});

/*
 * Ensures the corpus names every relation needed by the future task-context envelope and includes
 * multilingual/context-bearing examples instead of allowing exact English acknowledgements to
 * masquerade as complete multi-turn coverage.
 */
test("follow-up characterization exposes the future relation gap", () => {
	const desired = new Set(fixture.cases.map((entry) => entry.desiredRelation));
	assert.deepEqual([...desired].sort(), ["ambiguous", "continuation", "escalation", "narrowing", "new-task", "refinement"]);
	assert.ok(fixture.cases.some((entry) => entry.id.startsWith("italian-")));
	assert.ok(fixture.cases.some((entry) => entry.id === "code-switch-follow-up"));
	assert.ok(fixture.cases.some((entry) => entry.currentDisposition === "route-local-only" && entry.desiredRelation === "continuation"));
	assert.ok(fixture.cases.some((entry) => entry.currentDisposition === "route-local-only" && entry.desiredRelation === "new-task"));
});
