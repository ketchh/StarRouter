export type PromptPatternCategory =
	| "mechanical"
	| "coding"
	| "debugging"
	| "architecture"
	| "security"
	| "agentic"
	| "format"
	| "research"
	| "longContext"
	| "image"
	| "simpleTask"
	| "speed"
	| "cheap"
	| "thinkCarefully"
	| "ambiguousTechnical"
	| "highStakesResearch"
	| "criticalSystem";

export type PromptPatternDictionary = Record<PromptPatternCategory, RegExp[]>;

export function definePromptPatternDictionary(dictionary: PromptPatternDictionary): PromptPatternDictionary {
	return dictionary;
}

export function mergePromptPatternDictionaries(dictionaries: PromptPatternDictionary[]): PromptPatternDictionary {
	const categories: PromptPatternCategory[] = [
		"mechanical",
		"coding",
		"debugging",
		"architecture",
		"security",
		"agentic",
		"format",
		"research",
		"longContext",
		"image",
		"simpleTask",
		"speed",
		"cheap",
		"thinkCarefully",
		"ambiguousTechnical",
		"highStakesResearch",
		"criticalSystem",
	];
	return Object.fromEntries(categories.map((category) => [category, dictionaries.flatMap((dictionary) => dictionary[category])])) as PromptPatternDictionary;
}
