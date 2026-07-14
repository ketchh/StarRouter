import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inferPromptProfileSmart, type RoutingTier, type ThinkingLevel } from "../src/prompt-understanding.ts";

interface GoldenPromptCase {
	id: string;
	category: string;
	prompt: string;
	hasImages?: boolean;
	expected: {
		signalsAll?: string[];
		signalsAny?: string[];
		minThinking?: ThinkingLevel;
		maxThinking?: ThinkingLevel;
		minTier?: RoutingTier;
		promptLengthType?: string;
		uncertain?: boolean;
	};
}

const routerConfig = {};
const thinkingOrder: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const tierOrder: RoutingTier[] = ["booster", "simple", "standard", "complex", "frontier"];
const bank = JSON.parse(readFileSync(new URL("./fixtures/golden-prompts.json", import.meta.url), "utf8")) as { cases: GoldenPromptCase[] };

function thinkingAtLeast(actual: ThinkingLevel, expected: ThinkingLevel): boolean {
	return thinkingOrder.indexOf(actual) >= thinkingOrder.indexOf(expected);
}

function thinkingAtMost(actual: ThinkingLevel, expected: ThinkingLevel): boolean {
	return thinkingOrder.indexOf(actual) <= thinkingOrder.indexOf(expected);
}

function tierAtLeast(actual: string | undefined, expected: RoutingTier): boolean {
	return actual !== undefined && tierOrder.indexOf(actual as RoutingTier) >= tierOrder.indexOf(expected);
}

/*
 * Verifies the versioned golden prompt bank that covers 80 simple, coding, debugging, architecture,
 * research, long-context, vision, agentic, and cost-sensitive prompts.
 */
test("golden prompt bank keeps routing profiles within expected guardrails", async () => {
	assert.equal(bank.cases.length, 80);
	const failures: string[] = [];
	for (const item of bank.cases) {
		const profile = await inferPromptProfileSmart(routerConfig, item.prompt, Boolean(item.hasImages));
		const expected = item.expected;
		if (expected.signalsAll) {
			for (const signal of expected.signalsAll) {
				if (!profile.matchedSignals.includes(signal)) failures.push(`${item.id}: missing signal ${signal}; got ${profile.matchedSignals.join(",")}`);
			}
		}
		if (expected.signalsAny && !expected.signalsAny.some((signal) => profile.matchedSignals.includes(signal))) {
			failures.push(`${item.id}: missing any signal ${expected.signalsAny.join("/")}; got ${profile.matchedSignals.join(",")}`);
		}
		if (expected.minThinking && !thinkingAtLeast(profile.targetThinkingLevel, expected.minThinking)) {
			failures.push(`${item.id}: thinking ${profile.targetThinkingLevel} < ${expected.minThinking}`);
		}
		if (expected.maxThinking && !thinkingAtMost(profile.targetThinkingLevel, expected.maxThinking)) {
			failures.push(`${item.id}: thinking ${profile.targetThinkingLevel} > ${expected.maxThinking}`);
		}
		if (expected.minTier && !tierAtLeast(profile.routingTier, expected.minTier)) {
			failures.push(`${item.id}: tier ${profile.routingTier} < ${expected.minTier}`);
		}
		if (expected.promptLengthType && profile.promptLengthType !== expected.promptLengthType) {
			failures.push(`${item.id}: promptLengthType ${profile.promptLengthType} !== ${expected.promptLengthType}`);
		}
		if (expected.uncertain !== undefined && profile.uncertain !== expected.uncertain) {
			failures.push(`${item.id}: uncertain ${profile.uncertain} !== ${expected.uncertain}`);
		}
	}
	assert.deepEqual(failures, []);
});
