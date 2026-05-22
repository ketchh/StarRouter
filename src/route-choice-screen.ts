import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import type { Candidate, RouteDecisionSummary, ThinkingLevel } from "./router-core.ts";

type RouteChoiceOption =
	| {
			type: "current";
			label: string;
			description: string;
		}
	| {
			type: "candidate";
			candidate: Candidate;
			label: string;
			description: string;
		};

export interface RouteChoiceRequest {
	decision: RouteDecisionSummary;
	candidates: Candidate[];
	currentModel?: Model<Api>;
	currentThinkingLevel?: ThinkingLevel;
}

function routeKeyForCandidate(candidate: Candidate): string {
	return `${candidate.piModel.provider}/${candidate.piModel.id}@${candidate.candidateThinkingLevel}`;
}

function currentRouteLabel(model: Model<Api> | undefined, thinkingLevel: ThinkingLevel | undefined): string {
	if (!model) return "none";
	return `${model.provider}/${model.id}${thinkingLevel ? ` @ ${thinkingLevel}` : ""}`;
}

function candidateDescription(candidate: Candidate): string {
	const reasons = candidate.reasonBits.length > 0 ? ` · ${candidate.reasonBits.slice(0, 4).join(", ")}` : "";
	const confidence = candidate.confidence ? ` · conf ${Math.round(candidate.confidence.overall * 100)}` : "";
	return `fit ${Math.round(candidate.benchmarkScore * 100)} · score ${Math.round(candidate.composite * 100)} · cost ${Math.round(candidate.economicScore * 100)} · latency ${Math.round(candidate.latencyScore * 100)} · ctx ${Math.round(candidate.contextScore * 100)}${confidence}${reasons}`;
}

function buildOptions(request: RouteChoiceRequest): RouteChoiceOption[] {
	const options: RouteChoiceOption[] = [];
	const seen = new Set<string>();
	if (request.currentModel) {
		const currentKey = `${request.currentModel.provider}/${request.currentModel.id}@${request.currentThinkingLevel ?? "off"}`;
		seen.add(currentKey);
		options.push({
			type: "current",
			label: `Keep current · ${currentRouteLabel(request.currentModel, request.currentThinkingLevel)}`,
			description: "Continue without changing the active route.",
		});
	}
	for (const candidate of request.candidates) {
		const key = routeKeyForCandidate(candidate);
		if (seen.has(key)) continue;
		seen.add(key);
		options.push({
			type: "candidate",
			candidate,
			label: `${candidate.piModel.id} @ ${candidate.candidateThinkingLevel}`,
			description: candidateDescription(candidate),
		});
	}
	return options;
}

function boundedLines(lines: string[], width: number, maxLines: number): string[] {
	const out: string[] = [];
	for (const line of lines) {
		for (const wrapped of wrapTextWithAnsi(line, Math.max(24, width))) {
			out.push(wrapped);
			if (out.length >= maxLines) {
				out[out.length - 1] = truncateToWidth(`${out[out.length - 1]} …`, Math.max(24, width));
				return out;
			}
		}
	}
	return out;
}

function decisionWhyLines(decision: RouteDecisionSummary): string[] {
	const lines: string[] = [];
	for (const line of decision.shortSummary ?? []) lines.push(line);
	for (const line of decision.reasonLines ?? []) {
		if (line.startsWith("Scope:")) continue;
		if (lines.includes(line)) continue;
		lines.push(line);
	}
	return lines.length > 0 ? lines : ["No explanation available for this route."];
}

class RouteChoiceComponent implements Component {
	private options: RouteChoiceOption[];
	private focusedIndex = 0;
	private selectedIndex = 0;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
		private readonly request: RouteChoiceRequest,
		private readonly done: (candidate: Candidate | undefined) => void,
	) {
		this.options = buildOptions(request);
		const recommendedIndex = this.options.findIndex((option) => option.type === "candidate" && option.candidate.piModel.id === request.decision.modelId && option.candidate.candidateThinkingLevel === request.decision.thinkingLevel);
		this.focusedIndex = recommendedIndex >= 0 ? recommendedIndex : Math.min(1, Math.max(0, this.options.length - 1));
		this.selectedIndex = this.focusedIndex;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const innerWidth = Math.max(48, width - 4);
		const maxRows = Math.max(16, Math.min(this.tui.terminal.rows - 6, Math.floor(this.tui.terminal.rows * 0.86)));
		const lines: string[] = [];
		lines.push(this.theme.fg("accent", this.theme.bold("StarRouter · Confirm route")));
		lines.push(this.theme.fg("muted", `Current: ${currentRouteLabel(this.request.currentModel, this.request.currentThinkingLevel)}`));
		lines.push(this.theme.fg("success", `Recommended: ${this.request.decision.provider}/${this.request.decision.modelId} @ ${this.request.decision.thinkingLevel}`));
		lines.push("");
		lines.push(this.theme.fg("accent", "Why this route:"));
		for (const line of boundedLines(decisionWhyLines(this.request.decision), innerWidth, Math.max(4, Math.min(8, Math.floor(maxRows * 0.28))))) {
			lines.push(`  ${line}`);
		}
		lines.push("");
		lines.push(this.theme.fg("accent", "Select model:"));
		const optionLines: string[][] = this.options.map((option, index) => {
			const focused = index === this.focusedIndex;
			const selected = index === this.selectedIndex;
			const cursor = focused ? this.theme.fg("accent", "→") : " ";
			const marker = selected ? this.theme.fg("success", "●") : this.theme.fg("dim", "○");
			const tag = option.type === "candidate" && option.candidate.piModel.id === this.request.decision.modelId && option.candidate.candidateThinkingLevel === this.request.decision.thinkingLevel
				? this.theme.fg("success", " recommended")
				: option.type === "current"
					? this.theme.fg("muted", " current")
					: "";
			const label = `${cursor} ${marker} ${option.label}${tag}`;
			const rendered = [truncateToWidth(focused ? this.theme.bold(label) : label, innerWidth)];
			for (const wrapped of boundedLines([`    ${option.description}`], innerWidth, focused ? 3 : 1)) {
				rendered.push(this.theme.fg("muted", wrapped));
			}
			return rendered;
		});
		const usedRows = lines.length + 2;
		const optionBudget = Math.max(4, maxRows - usedRows);
		let startIndex = 0;
		let consumedBeforeFocus = 0;
		for (let index = 0; index < this.focusedIndex; index += 1) consumedBeforeFocus += optionLines[index]?.length ?? 0;
		if (consumedBeforeFocus >= optionBudget - 3) {
			let rows = 0;
			for (let index = this.focusedIndex; index >= 0; index -= 1) {
				rows += optionLines[index]?.length ?? 0;
				if (rows >= optionBudget - 3) {
					startIndex = Math.min(this.focusedIndex, index + 1);
					break;
				}
			}
		}
		let optionRows = 0;
		if (startIndex > 0) lines.push(this.theme.fg("dim", `  ↑ ${startIndex} more option${startIndex === 1 ? "" : "s"}`));
		for (let index = startIndex; index < optionLines.length; index += 1) {
			const rendered = optionLines[index]!;
			if (optionRows + rendered.length > optionBudget) {
				lines.push(this.theme.fg("dim", `  ↓ ${optionLines.length - index} more option${optionLines.length - index === 1 ? "" : "s"}`));
				break;
			}
			lines.push(...rendered);
			optionRows += rendered.length;
		}
		lines.push("");
		lines.push(this.theme.fg("dim", "↑↓ focus · Space mark · Enter choose focused · Esc keep current"));
		return lines.slice(0, maxRows).map((line) => truncateToWidth(line, width));
	}

	handleInput(data: string): void {
		const kb = this.keybindings;
		if (kb.matches(data, "tui.select.cancel")) {
			this.done(undefined);
			return;
		}
		if (kb.matches(data, "tui.select.up")) {
			this.focusedIndex = this.focusedIndex === 0 ? this.options.length - 1 : this.focusedIndex - 1;
			this.tui.requestRender();
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			this.focusedIndex = this.focusedIndex === this.options.length - 1 ? 0 : this.focusedIndex + 1;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "space")) {
			this.selectedIndex = this.focusedIndex;
			this.tui.requestRender();
			return;
		}
		if (kb.matches(data, "tui.select.confirm")) {
			this.selectedIndex = this.focusedIndex;
			const option = this.options[this.focusedIndex];
			this.done(option?.type === "candidate" ? option.candidate : undefined);
		}
	}
}

export async function openRouteChoice(ctx: ExtensionContext, request: RouteChoiceRequest): Promise<Candidate | undefined> {
	if (!ctx.hasUI) return undefined;
	return ctx.ui.custom<Candidate | undefined>((tui, theme, keybindings, done) => new RouteChoiceComponent(tui, theme, keybindings, request, done), {
		overlay: true,
		overlayOptions: {
			anchor: "center",
			width: "92%",
			minWidth: 72,
			maxHeight: "92%",
			margin: 1,
		},
	});
}

export function createRouteDecisionWidget(decision: RouteDecisionSummary): (tui: unknown, theme: Theme) => Component {
	return (_tui: unknown, theme: Theme) => ({
		invalidate() {},
		render(width: number) {
			const lines: string[] = [];
			const innerWidth = Math.max(30, width - 2);
			lines.push(theme.fg("accent", theme.bold("StarRouter decision")));
			lines.push(theme.fg("success", `${decision.provider}/${decision.modelId} @ ${decision.thinkingLevel}`));
			if (decision.confidence) {
				lines.push(theme.fg("muted", `confidence ${Math.round(decision.confidence.overall * 100)} · objective ${decision.objectiveUsed}`));
			}
			for (const line of boundedLines(decisionWhyLines(decision), innerWidth, 10)) {
				lines.push(`  ${line}`);
			}
			return lines.map((line) => truncateToWidth(line, width));
		},
	});
}
