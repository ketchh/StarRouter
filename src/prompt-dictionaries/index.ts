import { ENGLISH_PROMPT_PATTERNS } from "./en.ts";
import { ITALIAN_PROMPT_PATTERNS } from "./it.ts";
import { mergePromptPatternDictionaries } from "./types.ts";
export type { PromptPatternCategory, PromptPatternDictionary } from "./types.ts";

export const PROMPT_PATTERNS = mergePromptPatternDictionaries([
	ENGLISH_PROMPT_PATTERNS,
	ITALIAN_PROMPT_PATTERNS,
]);

export const AVAILABLE_PROMPT_DICTIONARIES = [
	{ id: "en", label: "English", dictionary: ENGLISH_PROMPT_PATTERNS },
	{ id: "it", label: "Italiano", dictionary: ITALIAN_PROMPT_PATTERNS },
] as const;
