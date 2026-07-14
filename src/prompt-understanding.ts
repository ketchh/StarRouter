import { PROMPT_PATTERNS } from "./prompt-dictionaries/index.ts";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type PromptLengthType = "medium" | "medium_coding" | "long" | "vision_single_image" | "100k";
export type BenchmarkKey =
	| "intelligence_index"
	| "agentic_index"
	| "coding_index"
	| "gdpval_normalized"
	| "tau2"
	| "terminalbench_hard"
	| "scicode"
	| "livecodebench"
	| "ifbench"
	| "omniscience"
	| "gpqa"
	| "hle"
	| "critpt"
	| "lcr";

export type RoutingTier = "booster" | "simple" | "standard" | "complex" | "frontier";

export interface PromptProfileLike {
	summary: string;
	matchedSignals: string[];
	benchmarkWeights: Record<BenchmarkKey, number>;
	priorities: {
		costSensitivity: number;
		speedSensitivity: number;
		reasoningNeed: number;
		contextNeed: number;
		visionNeed: number;
		toolUseNeed: number;
		formatReliabilityNeed: number;
	};
	targetThinkingLevel: ThinkingLevel;
	promptLengthType: PromptLengthType;
	complexityScore?: number;
	routingTier?: RoutingTier;
	analysisNotes?: string[];
	uncertain?: boolean;
	classifierSource?: string;
}

export type RouterConfigLike = Record<string, unknown>;

const MECHANICAL_PATTERNS = PROMPT_PATTERNS.mechanical;
const CODING_PATTERNS = PROMPT_PATTERNS.coding;
const DEBUG_PATTERNS = PROMPT_PATTERNS.debugging;
const ARCHITECTURE_PATTERNS = PROMPT_PATTERNS.architecture;
const SECURITY_PATTERNS = PROMPT_PATTERNS.security;
const AGENTIC_PATTERNS = PROMPT_PATTERNS.agentic;
const FORMAT_PATTERNS = PROMPT_PATTERNS.format;
const RESEARCH_PATTERNS = PROMPT_PATTERNS.research;
const LONG_CONTEXT_PATTERNS = PROMPT_PATTERNS.longContext;
const IMAGE_PATTERNS = PROMPT_PATTERNS.image;
const SIMPLE_TASK_PATTERNS = PROMPT_PATTERNS.simpleTask;
const SPEED_PATTERNS = PROMPT_PATTERNS.speed;
const CHEAP_PATTERNS = PROMPT_PATTERNS.cheap;
const THINK_CAREFULLY_PATTERNS = PROMPT_PATTERNS.thinkCarefully;
const AMBIGUOUS_TECHNICAL_PATTERNS = PROMPT_PATTERNS.ambiguousTechnical;
const HIGH_STAKES_RESEARCH_PATTERNS = PROMPT_PATTERNS.highStakesResearch;
const CRITICAL_SYSTEM_PATTERNS = PROMPT_PATTERNS.criticalSystem;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function anyPattern(patterns: RegExp[], text: string): boolean {
	return patterns.some((pattern) => pattern.test(text));
}

function countMatches(patterns: RegExp[], text: string): number {
	return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function normalizeWeightMap<T extends string>(weights: Record<T, number>): Record<T, number> {
	const cleaned = { ...weights };
	let total = 0;
	for (const key of Object.keys(cleaned) as T[]) {
		const value = clamp(Number(cleaned[key] ?? 0), 0, 1000);
		cleaned[key] = value;
		total += value;
	}
	if (total <= 0) {
		const keys = Object.keys(cleaned) as T[];
		const even = keys.length > 0 ? 1 / keys.length : 0;
		for (const key of keys) cleaned[key] = even;
		return cleaned;
	}
	for (const key of Object.keys(cleaned) as T[]) {
		cleaned[key] = cleaned[key] / total;
	}
	return cleaned;
}

function scoreToThinking(score: number, hardFloor: ThinkingLevel = "off"): ThinkingLevel {
	let level: ThinkingLevel = "off";
	if (score >= 0.88) level = "xhigh";
	else if (score >= 0.72) level = "high";
	else if (score >= 0.52) level = "medium";
	else if (score >= 0.3) level = "low";
	const order: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	return order.indexOf(level) < order.indexOf(hardFloor) ? hardFloor : level;
}

function detectPromptLengthType(text: string, signals: { needsVision: boolean; isCoding: boolean; isLongContext: boolean }): PromptLengthType {
	if (signals.needsVision) return "vision_single_image";
	if (signals.isLongContext) return "long";
	if (signals.isCoding) return "medium_coding";
	return "medium";
}

function countCodeBlocks(text: string): number {
	return (text.match(/```/g) || []).length / 2;
}

function countFileMentions(text: string): number {
	const matches = text.match(/\b[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8}\b/g) || [];
	return new Set(matches).size;
}

function countListItems(text: string): number {
	return (text.match(/(^|\n)\s*(?:[-*]|\d+[.)])\s+/g) || []).length;
}

function inferPromptProfileHeuristic(prompt: string, hasImages: boolean): PromptProfileLike {
	const text = prompt.trim();
	const wordCount = text.split(/\s+/).filter(Boolean).length;
	const codeBlocks = countCodeBlocks(text);
	const fileMentions = countFileMentions(text);
	const listItems = countListItems(text);
	const hasPaths = /\b(?:src|app|lib|server|client|tests?|packages?)\//i.test(text);

	const hasMechanicalPattern = anyPattern(MECHANICAL_PATTERNS, text) && wordCount < 220;
	const hasDebugSignal = anyPattern(DEBUG_PATTERNS, text);
	const mechanicalDebugNoise = /\b(?:remove|delete|strip|clean(?:\s*up)?|elimina\w*|rimuovi\w*|pulisci\w*)\b[^.!?\n]{0,48}\b(?:debug\s+logs?|console(?:\.log)?|stampe?\s+di\s+debug)\b/i.test(text);
	const strongDebugSignal = /\b(?:root\s+cause|stack\s+trace|traceback|investigat\w*|diagnos\w*|crash|timeout|deadlock|memory\s+leak|flaky|non[- ]determin\w*|causa\s+radice|indaga\w*|traccia\s+(?:dello\s+)?stack|errore\s+intermittente|perdita\s+di\s+memoria)\b/i.test(text);
	const diagnosticDebugSignal = /\b(?:debug|diagnos\w*|investigat\w*|indaga\w*)\b[^.!?\n]{0,24}\b(?:why|how|perch[eé]|come)\b|\b(?:why|perch[eé])\b[^.!?\n]{0,80}\b(?:break\w*|fail\w*|romp\w*|fallisc\w*)\b/i.test(text);
	const isDebugging = hasDebugSignal && (!mechanicalDebugNoise || strongDebugSignal || diagnosticDebugSignal);
	const isArchitecture = anyPattern(ARCHITECTURE_PATTERNS, text);
	const isSecurity = anyPattern(SECURITY_PATTERNS, text);
	const isResearch = anyPattern(RESEARCH_PATTERNS, text);
	const mechanicalIntent = hasMechanicalPattern && !isDebugging && !isArchitecture && !isSecurity && !isResearch;
	const isCoding = hasMechanicalPattern || anyPattern(CODING_PATTERNS, text) || codeBlocks > 0 || fileMentions > 0 || hasPaths;
	const isAgentic = anyPattern(AGENTIC_PATTERNS, text);
	const isFormatHeavy = anyPattern(FORMAT_PATTERNS, text);
	const isLongContext = anyPattern(LONG_CONTEXT_PATTERNS, text) || wordCount > 900 || text.length > 6_500 || fileMentions >= 4;
	const needsVision = hasImages || anyPattern(IMAGE_PATTERNS, text);
	const isSimpleOutputTask = anyPattern(SIMPLE_TASK_PATTERNS, text) && wordCount < 180 && !isArchitecture && !isDebugging && !isSecurity;
	const speedSensitive = anyPattern(SPEED_PATTERNS, text);
	const costSensitive = anyPattern(CHEAP_PATTERNS, text) || (isSimpleOutputTask && !isArchitecture && !isDebugging);
	const carefulThinking = anyPattern(THINK_CAREFULLY_PATTERNS, text);
	const ambiguousTechnical = isCoding && anyPattern(AMBIGUOUS_TECHNICAL_PATTERNS, text) && wordCount < 140;
	const highStakesResearch = isResearch && anyPattern(HIGH_STAKES_RESEARCH_PATTERNS, text);
	const criticalSystemSignalCount = countMatches(CRITICAL_SYSTEM_PATTERNS, text);
	const taskFanout = Math.max(0, listItems - 1) + (/(?:\band\b|\balso\b|\bthen\b|\bpoi\b|\binfine\b)/i.test(text) ? 1 : 0);

	const weights: Record<BenchmarkKey, number> = {
		intelligence_index: 0,
		agentic_index: 0,
		coding_index: 0,
		gdpval_normalized: 0,
		tau2: 0,
		terminalbench_hard: 0,
		scicode: 0,
		livecodebench: 0,
		ifbench: 0,
		omniscience: 0,
		gpqa: 0,
		hle: 0,
		critpt: 0,
		lcr: 0,
	};
	const matchedSignals: string[] = [];
	const analysisNotes: string[] = [];
	const bump = (key: BenchmarkKey, amount: number) => {
		weights[key] += amount;
	};

	let complexity = 0.08;
	if (mechanicalIntent) {
		matchedSignals.push("mechanical-transform");
		analysisNotes.push("ruflo-tier1-like mechanical transform");
		complexity -= 0.16;
		bump("ifbench", 1.15);
	}
	if (isCoding) {
		matchedSignals.push("coding");
		complexity += 0.18;
		bump("coding_index", 1.55);
		bump("terminalbench_hard", 1.25);
		bump("scicode", 0.85);
		bump("livecodebench", 0.75);
		bump("agentic_index", 0.2);
	}
	if (isDebugging) {
		matchedSignals.push("debugging");
		analysisNotes.push("debug/root-cause signals");
		complexity += 0.22;
		bump("terminalbench_hard", 0.55);
		bump("coding_index", 0.45);
		bump("intelligence_index", 0.35);
	}
	if (isArchitecture) {
		matchedSignals.push("architecture");
		analysisNotes.push("high-tier architecture signals");
		complexity += 0.3;
		bump("gdpval_normalized", 1.1);
		bump("tau2", 1.0);
		bump("intelligence_index", 0.8);
		bump("lcr", 0.25);
	}
	if (isSecurity) {
		matchedSignals.push("security");
		analysisNotes.push("security/audit signals");
		complexity += 0.24;
		bump("intelligence_index", 0.7);
		bump("tau2", 0.7);
		bump("gdpval_normalized", 0.6);
		bump("gpqa", 0.35);
	}
	if (isAgentic) {
		matchedSignals.push("agentic/tool-use");
		complexity += 0.12;
		bump("agentic_index", 1.25);
		bump("gdpval_normalized", 1.05);
		bump("tau2", 0.95);
		bump("ifbench", 0.2);
	}
	if (criticalSystemSignalCount >= 2) {
		matchedSignals.push("critical-system");
		analysisNotes.push(`critical-system signals:${criticalSystemSignalCount}`);
		complexity += Math.min(0.12, criticalSystemSignalCount * 0.018);
		bump("gdpval_normalized", 0.55);
		bump("tau2", 0.45);
		bump("agentic_index", 0.25);
		bump("intelligence_index", 0.25);
	}
	if (isFormatHeavy) {
		matchedSignals.push("structured-output");
		bump("ifbench", 1.2);
		bump("lcr", 0.12);
		if (!isArchitecture && !isSecurity && !isDebugging) complexity -= 0.03;
	}
	if (isResearch) {
		matchedSignals.push("research");
		complexity += highStakesResearch ? 0.28 : 0.18;
		if (highStakesResearch) analysisNotes.push("high-stakes research / citation uncertainty");
		bump("intelligence_index", highStakesResearch ? 1.2 : 1.0);
		bump("omniscience", highStakesResearch ? 1.15 : 0.95);
		bump("gpqa", highStakesResearch ? 0.85 : 0.7);
		bump("critpt", highStakesResearch ? 0.75 : 0.55);
		bump("hle", highStakesResearch ? 0.6 : 0.45);
	}
	if (isLongContext) {
		matchedSignals.push("long-context");
		complexity += 0.16;
		analysisNotes.push("long-context / many-files");
		bump("lcr", 1.45);
		bump("gdpval_normalized", 0.25);
	}
	if (needsVision) {
		matchedSignals.push("vision");
		complexity += 0.08;
		bump("intelligence_index", 0.25);
	}
	if (isSimpleOutputTask) {
		matchedSignals.push("simple-output");
		analysisNotes.push("cheap/simple rewrite or extraction task");
		complexity -= 0.12;
		bump("ifbench", 0.8);
	}
	if (!isCoding && !isAgentic && !isFormatHeavy && !isResearch && !isArchitecture && !isSecurity) {
		matchedSignals.push("general");
		bump("intelligence_index", isSimpleOutputTask ? 0.22 : 0.6);
		bump("omniscience", isSimpleOutputTask ? 0.05 : 0.25);
	}

	complexity += Math.min(0.08, codeBlocks * 0.04);
	complexity += Math.min(0.1, fileMentions * 0.025);
	complexity += Math.min(0.1, taskFanout * 0.035);
	if (carefulThinking) complexity += 0.1;
	if (wordCount > 250) complexity += 0.05;
	if (wordCount > 700) complexity += 0.08;
	if (ambiguousTechnical) {
		matchedSignals.push("ambiguous-technical");
		analysisNotes.push("short ambiguous technical request: missing context possible");
		complexity += 0.08;
	}
	if (speedSensitive) complexity -= 0.02;
	if (costSensitive) complexity -= 0.04;
	if (isSimpleOutputTask && wordCount < 80 && !carefulThinking) complexity -= 0.06;
	complexity = clamp(complexity, 0, 1);

	let routingTier: RoutingTier = "simple";
	if (mechanicalIntent && complexity < 0.22) routingTier = "booster";
	else if (complexity >= 0.82) routingTier = "frontier";
	else if (complexity >= 0.62) routingTier = "complex";
	else if (complexity >= 0.32) routingTier = "standard";
	else routingTier = "simple";

	const hardFloor: ThinkingLevel = mechanicalIntent
		? "off"
		: isArchitecture || isSecurity || highStakesResearch
			? "high"
			: isDebugging || (isCoding && (codeBlocks > 0 || fileMentions > 1)) || isResearch
				? "medium"
				: isCoding || isLongContext
					? "low"
					: "off";
	let targetThinkingLevel = scoreToThinking(complexity, hardFloor);
	if (routingTier === "booster") targetThinkingLevel = "off";
	if (isSimpleOutputTask && !isCoding && !isResearch && !isAgentic && !isArchitecture && !isLongContext) {
		targetThinkingLevel = costSensitive ? "off" : "low";
	}

	const priorities = {
		costSensitivity: clamp(0.22 + (costSensitive ? 0.38 : 0) + (isSimpleOutputTask ? 0.22 : 0) + (routingTier === "booster" ? 0.25 : 0) + (ambiguousTechnical ? 0.08 : 0) - complexity * 0.18, 0, 1),
		speedSensitivity: clamp(0.2 + (speedSensitive ? 0.4 : 0) + (isSimpleOutputTask ? 0.12 : 0) + (routingTier === "booster" ? 0.22 : 0), 0, 1),
		reasoningNeed: clamp(complexity + (carefulThinking ? 0.08 : 0) + (isArchitecture ? 0.1 : 0), 0, 1),
		contextNeed: clamp((isLongContext ? 0.72 : 0.05) + Math.min(0.18, fileMentions * 0.04), 0, 1),
		visionNeed: needsVision ? 1 : 0,
		toolUseNeed: clamp((isAgentic ? 0.72 : 0.05) + (isCoding ? 0.1 : 0), 0, 1),
		formatReliabilityNeed: clamp((isFormatHeavy ? 0.82 : 0.08), 0, 1),
	};
	const promptLengthType = detectPromptLengthType(text, { needsVision, isCoding, isLongContext });
	const benchmarkWeights = normalizeWeightMap(weights);
	const uncertain = ambiguousTechnical || (complexity >= 0.42 && complexity <= 0.62) || ((isSimpleOutputTask || mechanicalIntent) && (isArchitecture || isDebugging || isSecurity));
	if (uncertain) analysisNotes.push("uncertain-middle-band");

	const summaryBits = [
		`tier:${routingTier}`,
		`complexity:${Math.round(complexity * 100)}%`,
		matchedSignals.slice(0, 3).join(", "),
		`think:${targetThinkingLevel}`,
	].filter(Boolean);

	return {
		summary: summaryBits.join(" • "),
		matchedSignals: [...new Set(matchedSignals)],
		benchmarkWeights,
		priorities,
		targetThinkingLevel,
		promptLengthType,
		complexityScore: complexity,
		routingTier,
		analysisNotes,
		uncertain,
		classifierSource: "heuristic",
	};
}

export async function inferPromptProfileSmart(_config: RouterConfigLike, prompt: string, hasImages: boolean): Promise<PromptProfileLike> {
	/* The V1 router uses the same input every time and returns the same profile
	 * every time.  That determinism is a product feature: users can understand a
	 * routing decision without guessing which hidden classifier model was called. */
	return inferPromptProfileHeuristic(prompt, hasImages);
}
