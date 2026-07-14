#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inferPromptProfileSmart } from "../src/prompt-understanding.ts";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "tests", "fixtures", "golden-prompts.json");
const output = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
const bank = JSON.parse(fs.readFileSync(file, "utf8"));
const routerConfig = {};
const thinkingOrder = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const tierOrder = ["booster", "simple", "standard", "complex", "frontier"];
const atLeast = (order, actual, expected) => order.indexOf(actual) >= order.indexOf(expected);
const atMost = (order, actual, expected) => order.indexOf(actual) <= order.indexOf(expected);
const failures = [];
const rows = [];
for (const item of bank.cases ?? []) {
	const profile = await inferPromptProfileSmart(routerConfig, item.prompt, Boolean(item.hasImages));
	const expected = item.expected ?? {};
	const itemFailures = [];
	for (const signal of expected.signalsAll ?? []) {
		if (!profile.matchedSignals.includes(signal)) itemFailures.push(`missing ${signal}`);
	}
	if (expected.signalsAny && !expected.signalsAny.some((signal) => profile.matchedSignals.includes(signal))) {
		itemFailures.push(`missing any ${expected.signalsAny.join("/")}`);
	}
	if (expected.minThinking && !atLeast(thinkingOrder, profile.targetThinkingLevel, expected.minThinking)) itemFailures.push(`thinking ${profile.targetThinkingLevel}<${expected.minThinking}`);
	if (expected.maxThinking && !atMost(thinkingOrder, profile.targetThinkingLevel, expected.maxThinking)) itemFailures.push(`thinking ${profile.targetThinkingLevel}>${expected.maxThinking}`);
	if (expected.minTier && !atLeast(tierOrder, profile.routingTier, expected.minTier)) itemFailures.push(`tier ${profile.routingTier}<${expected.minTier}`);
	if (expected.promptLengthType && profile.promptLengthType !== expected.promptLengthType) itemFailures.push(`length ${profile.promptLengthType}!=${expected.promptLengthType}`);
	if (itemFailures.length > 0) failures.push({ id: item.id, category: item.category, failures: itemFailures, profile });
	rows.push({ id: item.id, category: item.category, ok: itemFailures.length === 0, profile });
}
const summary = {
	file,
	generatedAt: new Date().toISOString(),
	cases: rows.length,
	passed: rows.filter((row) => row.ok).length,
	failed: failures.length,
	passRate: rows.length ? rows.filter((row) => row.ok).length / rows.length : 0,
	failures,
};
if (output) fs.writeFileSync(output, `${JSON.stringify({ summary, rows }, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
process.exitCode = failures.length > 0 ? 1 : 0;
