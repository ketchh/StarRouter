import test from "node:test";
import assert from "node:assert/strict";
import { inferPromptProfileSmart } from "../src/prompt-understanding.ts";

const heuristicConfig = { classifier: { mode: "heuristic" as const } };

/*
 * Verifies that mechanical code transformation tasks are classified as booster routes with thinking off,
 * avoiding unnecessarily expensive frontier models.
 */
test("mechanical code transforms route to booster/off", async () => {
	const profile = await inferPromptProfileSmart(heuristicConfig, "convert var to const in this file and sort imports", false);

	assert.equal(profile.routingTier, "booster");
	assert.equal(profile.targetThinkingLevel, "off");
	assert.ok(profile.matchedSignals.includes("mechanical-transform"));
	assert.ok(profile.priorities.costSensitivity >= 0.4);
});

/*
 * Verifies that extraction and JSON-only output are recognized as simple structured-output work,
 * so the router can prefer inexpensive models that still preserve format reliability.
 */
test("simple JSON extraction is structured-output with low or off thinking", async () => {
	const profile = await inferPromptProfileSmart(heuristicConfig, "extract name, email, and total and return valid JSON only", false);

	assert.ok(profile.matchedSignals.includes("structured-output"));
	assert.ok(["booster", "simple"].includes(profile.routingTier ?? ""));
	assert.ok(["off", "minimal", "low"].includes(profile.targetThinkingLevel));
	assert.ok(profile.priorities.formatReliabilityNeed >= 0.8);
});

/*
 * Verifies that debugging and root-cause prompts over code are elevated to at least standard/complex
 * with medium-or-higher thinking.
 */
test("debugging code prompts request medium-or-higher thinking", async () => {
	const profile = await inferPromptProfileSmart(
		heuristicConfig,
		"debug a flaky timeout in src/server.ts, inspect the stack trace, and explain the root cause",
		false,
	);

	assert.ok(profile.matchedSignals.includes("coding"));
	assert.ok(profile.matchedSignals.includes("debugging"));
	assert.ok(["standard", "complex", "frontier"].includes(profile.routingTier ?? ""));
	assert.ok(["medium", "high", "xhigh"].includes(profile.targetThinkingLevel));
});

/*
 * Verifies that architecture and security prompts are treated as high-complexity problems
 * with quality/reasoning benchmark emphasis and high thinking.
 */
test("architecture and security prompts route to high complexity", async () => {
	const profile = await inferPromptProfileSmart(
		heuristicConfig,
		"design a multi-tenant OAuth2 architecture with RBAC, threat model, trade-offs and scalability constraints",
		false,
	);

	assert.ok(profile.matchedSignals.includes("architecture"));
	assert.ok(profile.matchedSignals.includes("security"));
	assert.ok(["complex", "frontier"].includes(profile.routingTier ?? ""));
	assert.ok(["high", "xhigh"].includes(profile.targetThinkingLevel));
});

/*
 * Verifies generically that regulated/distributed critical systems are not underestimated:
 * multiple different prompts must trigger architecture, critical-system signals, and high thinking.
 */
test("critical distributed systems route to complex-or-frontier", async () => {
	const prompts = [
		"Plan a global active-active ledger service with regional failover, idempotent writes, consistency trade-offs, compliance boundaries, and migration phases from a legacy service.",
		"Design a regulated financial event-driven settlement workflow with exactly-once processing, disaster recovery, auditability, and a phased monolith decomposition strategy.",
		"Propose a multi-region transaction platform with payment reconciliation, PCI-DSS boundaries, replay-safe event handling, and operational rollout steps.",
	];

	for (const prompt of prompts) {
		const profile = await inferPromptProfileSmart(heuristicConfig, prompt, false);

		assert.ok(profile.matchedSignals.includes("architecture"), prompt);
		assert.ok(profile.matchedSignals.includes("critical-system"), prompt);
		assert.ok((profile.complexityScore ?? 0) >= 0.68, `${prompt} -> ${profile.complexityScore}`);
		assert.ok(["complex", "frontier"].includes(profile.routingTier ?? ""), prompt);
		assert.ok(["high", "xhigh"].includes(profile.targetThinkingLevel), prompt);
	}
});

/*
 * Verifies that prompts with images or screenshots activate the vision profile and matching AA prompt-length bucket.
 */
test("vision prompts select the vision prompt-length profile", async () => {
	const profile = await inferPromptProfileSmart(heuristicConfig, "read this screenshot and extract the invoice fields", true);

	assert.ok(profile.matchedSignals.includes("vision"));
	assert.equal(profile.promptLengthType, "vision_single_image");
	assert.equal(profile.priorities.visionNeed, 1);
});

/*
 * Verifies that long-context and many-file prompts increase context need and AA-LCR benchmark weight.
 */
test("long-context prompts emphasize context and LCR", async () => {
	const profile = await inferPromptProfileSmart(
		heuristicConfig,
		"analyze the entire repo, all files and multiple documents, then summarize cross-module dependencies",
		false,
	);

	assert.ok(profile.matchedSignals.includes("long-context"));
	assert.equal(profile.promptLengthType, "long");
	assert.ok(profile.priorities.contextNeed >= 0.7);
	assert.ok(profile.benchmarkWeights.lcr > 0.1);
});

/*
 * Verifies that short ambiguous bug-fix prompts do not look deceptively certain or too cost-insensitive.
 */
test("ambiguous short technical prompts are marked uncertain", async () => {
	const profile = await inferPromptProfileSmart(
		heuristicConfig,
		"Quickly fix this bug if obvious; otherwise explain what info is missing.",
		false,
	);

	assert.ok(profile.matchedSignals.includes("coding"));
	assert.ok(profile.matchedSignals.includes("ambiguous-technical"));
	assert.equal(profile.uncertain, true);
	assert.ok(profile.priorities.costSensitivity >= 0.2);
	assert.ok(["low", "medium"].includes(profile.targetThinkingLevel));
});

/*
 * Verifies that the modular Italian prompt dictionary gives pure-Italian prompts the same guardrails
 * as their English counterparts instead of relying on mixed English technical keywords.
 */
test("pure Italian prompts use localized dictionaries", async () => {
	const cases = [
		{
			prompt: "Sostituisci var con const in questo file, elimina le stampe di debug e riordina le importazioni.",
			signal: "mechanical-transform",
			thinking: ["off", "minimal", "low"],
		},
		{
			prompt: "Indaga un errore intermittente nel servizio, leggi la traccia dello stack, trova la causa radice e proponi una correzione sicura.",
			signal: "debugging",
			thinking: ["medium", "high", "xhigh"],
		},
		{
			prompt: "Progetta un'architettura distribuita multi-regione per pagamenti con tolleranza ai guasti attiva-attiva, idempotenza e migrazione dal monolite.",
			signal: "architecture",
			thinking: ["high", "xhigh"],
		},
		{
			prompt: "Fai una ricerca comparativa sulle prove e sui rischi della migrazione post-quantistica; includi citazioni, incertezza e compromessi.",
			signal: "research",
			thinking: ["high", "xhigh"],
		},
		{
			prompt: "Analizza l'intero archivio, tutti i file e più documenti, poi riassumi dipendenze tra moduli e accoppiamenti rischiosi.",
			signal: "long-context",
			thinking: ["low", "medium", "high", "xhigh"],
			promptLengthType: "long",
		},
	];

	for (const item of cases) {
		const profile = await inferPromptProfileSmart(heuristicConfig, item.prompt, false);
		assert.ok(profile.matchedSignals.includes(item.signal), `${item.prompt} -> ${profile.matchedSignals.join(",")}`);
		assert.ok(item.thinking.includes(profile.targetThinkingLevel), `${item.prompt} -> ${profile.targetThinkingLevel}`);
		if (item.promptLengthType) assert.equal(profile.promptLengthType, item.promptLengthType);
	}
});

/*
 * Verifies that citation/evidence-heavy research gets a conservative reasoning floor instead of medium-only routing.
 */
test("high-stakes research prompts request high thinking", async () => {
	const profile = await inferPromptProfileSmart(
		heuristicConfig,
		"Research and compare recent evidence on post-quantum cryptography migration risks; cite uncertainty and benchmark trade-offs.",
		false,
	);

	assert.ok(profile.matchedSignals.includes("research"));
	assert.ok(profile.analysisNotes?.some((note) => note.includes("high-stakes research")));
	assert.ok(["high", "xhigh"].includes(profile.targetThinkingLevel));
});
