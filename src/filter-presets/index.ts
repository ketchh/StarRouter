export type ModelFilterPresetId = "none" | "benchmark-safe" | "frontier-safe" | "coding-safe" | "budget-safe";

export interface ModelFilterPreset {
	id: ModelFilterPresetId;
	label: string;
	description: string;
	allowedFamilies?: string[];
	blockedModelPatterns?: RegExp[];
}

export const BENCHMARK_SAFE_FAMILIES = [
	"claude-haiku",
	"claude-sonnet",
	"claude-opus",
	"gemini-flash",
	"gemini-pro",
	"gemini-lite",
	"gpt-5",
	"gpt-5-codex",
	"gpt-4o",
	"gpt-4.1",
	"openai-o-series",
	"grok-code",
	"grok",
	"deepseek",
	"qwen",
	"mistral",
	"kimi",
	"llama",
	"gemma",
	"nova",
	"glm",
];

export const MODEL_FILTER_PRESETS: Record<ModelFilterPresetId, ModelFilterPreset> = {
	none: {
		id: "none",
		label: "All available",
		description: "No preset template. Clear preset-applied family/model disables for this provider.",
	},
	"benchmark-safe": {
		id: "benchmark-safe",
		label: "Benchmark-safe",
		description: "Large-provider default. Keeps model families that usually map cleanly to Artificial Analysis records and starts from a safer catalog.",
		allowedFamilies: BENCHMARK_SAFE_FAMILIES,
		blockedModelPatterns: [/:free($|[:/])/, /(^|\/)auto$/],
	},
	"frontier-safe": {
		id: "frontier-safe",
		label: "Frontier-safe",
		description: "High-capability families for hard prompts and quality-oriented routing.",
		allowedFamilies: ["claude-sonnet", "claude-opus", "gemini-pro", "gpt-5", "gpt-5-codex", "openai-o-series", "grok", "deepseek", "qwen", "kimi", "glm"],
		blockedModelPatterns: [/:free($|[:/])/, /(^|\/)auto$/],
	},
	"coding-safe": {
		id: "coding-safe",
		label: "Coding-safe",
		description: "Families that tend to be useful for coding-agent tasks while avoiding long-tail ambiguous model IDs.",
		allowedFamilies: ["claude-sonnet", "gemini-pro", "gemini-flash", "gpt-5", "gpt-5-codex", "grok-code", "deepseek", "qwen", "kimi", "mistral", "glm"],
		blockedModelPatterns: [/:free($|[:/])/, /(^|\/)auto$/],
	},
	"budget-safe": {
		id: "budget-safe",
		label: "Budget-safe",
		description: "Cost-sensitive but still benchmark-recognizable families; avoids unknown/free endpoints that often create noisy matches.",
		allowedFamilies: ["gemini-flash", "gemini-lite", "deepseek", "qwen", "mistral", "kimi", "llama", "gemma", "glm", "gpt-5", "gpt-5-codex"],
		blockedModelPatterns: [/:free($|[:/])/, /(^|\/)auto$/],
	},
};

export const MODEL_FILTER_PRESET_IDS = Object.keys(MODEL_FILTER_PRESETS) as ModelFilterPresetId[];

export function normalizeModelFilterPreset(value: unknown): ModelFilterPresetId {
	return MODEL_FILTER_PRESET_IDS.includes(value as ModelFilterPresetId) ? (value as ModelFilterPresetId) : "none";
}

export function getModelFilterPreset(value: unknown): ModelFilterPreset {
	return MODEL_FILTER_PRESETS[normalizeModelFilterPreset(value)];
}
