import type { Api, Model } from "@earendil-works/pi-ai";
import { keyHint, keyText, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import type { Candidate, RouteDecisionSummary, ThinkingLevel } from "./router-core.ts";

export type RouteChoiceOption =
	| {
			type: "current";
			key: string;
			candidate?: Candidate;
			label: string;
			description: string;
			recommended: boolean;
		}
	| {
			type: "candidate";
			key: string;
			candidate: Candidate;
			label: string;
			description: string;
			recommended: boolean;
		};

export interface RouteChoiceRequest {
	decision: RouteDecisionSummary;
	candidates: Candidate[];
	currentModel?: Model<Api>;
	currentThinkingLevel?: ThinkingLevel;
}

export type RouteChoiceResult =
	| { action: "cancel" }
	| { action: "current"; candidate?: Candidate }
	| { action: "candidate"; candidate: Candidate };

function routeKey(provider: string, modelId: string, thinkingLevel: ThinkingLevel): string {
	return `${provider}/${modelId}@${thinkingLevel}`;
}

function routeKeyForCandidate(candidate: Candidate): string {
	return routeKey(String(candidate.piModel.provider), candidate.piModel.id, candidate.candidateThinkingLevel);
}

function decisionRouteKey(decision: RouteDecisionSummary): string {
	return routeKey(decision.provider, decision.modelId, decision.thinkingLevel);
}

function currentRouteLabel(model: Model<Api> | undefined, thinkingLevel: ThinkingLevel | undefined): string {
	if (!model) return "none";
	return `${model.provider}/${model.id} @ ${thinkingLevel ?? "off"}`;
}

function percent(value: number | undefined): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(100, Math.round(Number(value) * 100)));
}

function candidateDescription(candidate: Candidate): string {
	const metrics = [
		`task fit ${percent(candidate.benchmarkScore)}%`,
		Number.isFinite(candidate.price) ? `cost ${percent(candidate.economicScore)}%` : "cost n/a",
		Number.isFinite(candidate.latency) ? `latency ${percent(candidate.latencyScore)}%` : "latency n/a",
		`context ${percent(candidate.contextScore)}%`,
	];
	if (candidate.confidence) metrics.push(`confidence ${percent(candidate.confidence.overall)}%`);
	const isTrustReason = (reason: string) => /model-only|moving-alias pin|AA alias pin|host unverified/i.test(reason);
	const trustReasons = candidate.reasonBits.filter(isTrustReason);
	const otherReasons = candidate.reasonBits.filter((reason) => !isTrustReason(reason));
	const reasons = [...trustReasons, ...otherReasons].slice(0, 3);
	return reasons.length > 0 ? `${reasons.join(", ")} · ${metrics.join(" · ")}` : metrics.join(" · ");
}

export function buildRouteChoiceOptions(request: RouteChoiceRequest): RouteChoiceOption[] {
	const options: RouteChoiceOption[] = [];
	const seen = new Set<string>();
	const recommendedKey = decisionRouteKey(request.decision);
	if (request.currentModel) {
		const key = routeKey(String(request.currentModel.provider), request.currentModel.id, request.currentThinkingLevel ?? "off");
		seen.add(key);
		options.push({
			type: "current",
			key,
			candidate: request.candidates.find((candidate) => routeKeyForCandidate(candidate) === key),
			label: `Keep current · ${currentRouteLabel(request.currentModel, request.currentThinkingLevel)}`,
			description: "Continue without changing the active model or thinking level.",
			recommended: key === recommendedKey,
		});
	}
	for (const candidate of request.candidates) {
		const key = routeKeyForCandidate(candidate);
		if (seen.has(key)) continue;
		seen.add(key);
		options.push({
			type: "candidate",
			key,
			candidate,
			label: `${candidate.piModel.provider}/${candidate.piModel.id} @ ${candidate.candidateThinkingLevel}`,
			description: candidateDescription(candidate),
			recommended: key === recommendedKey,
		});
	}
	return options;
}

function boundedLines(lines: string[], width: number, maxLines: number): string[] {
	if (maxLines <= 0) return [];
	const safeWidth = Math.max(1, width);
	const out: string[] = [];
	for (const line of lines) {
		for (const wrapped of wrapTextWithAnsi(line, safeWidth)) {
			out.push(wrapped);
			if (out.length >= maxLines) {
				out[out.length - 1] = truncateToWidth(`${out[out.length - 1]} …`, safeWidth);
				return out;
			}
		}
	}
	return out;
}

function decisionWhyLines(decision: RouteDecisionSummary): string[] {
	const lines: string[] = [];
	const reasonLines = (decision.reasonLines ?? []).filter((line) => !line.startsWith("Scope:"));
	const isTrustLine = (line: string) => /model-only|moving-alias pin|AA alias pin|host unverified/i.test(line);
	for (const line of reasonLines.filter(isTrustLine)) lines.push(line);
	for (const line of decision.shortSummary ?? []) {
		if (!lines.includes(line)) lines.push(line);
	}
	for (const line of reasonLines) {
		if (!lines.includes(line)) lines.push(line);
	}
	return lines.length > 0 ? lines : ["No explanation available for this route."];
}

function routeChoiceHint(width: number): string {
	const movement = `${keyText("tui.select.up")}/${keyText("tui.select.down")}`;
	const choose = keyHint("tui.select.confirm", "choose");
	const cancel = keyHint("tui.select.cancel", "keep current");
	const firstKey = (id: "tui.select.confirm" | "tui.select.cancel") => keyText(id).split("/")[0] ?? "";
	const text = width >= 70
		? `${movement} focus · ${choose} · ${cancel}`
		: `${firstKey("tui.select.confirm")} choose · ${firstKey("tui.select.cancel")} keep · ${movement}`;
	return truncateToWidth(text, Math.max(1, width));
}

export class RouteChoiceComponent implements Component {
	private readonly options: RouteChoiceOption[];
	private focusedIndex = 0;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
		private readonly request: RouteChoiceRequest,
		private readonly done: (result: RouteChoiceResult) => void,
	) {
		this.options = buildRouteChoiceOptions(request);
		const recommendedIndex = this.options.findIndex((option) => option.recommended);
		this.focusedIndex = recommendedIndex >= 0 ? recommendedIndex : 0;
	}

	invalidate(): void {}

	private maxRows(): number {
		const terminalRows = Math.max(1, this.tui.terminal.rows);
		return Math.max(1, Math.min(Math.max(1, terminalRows - 4), Math.floor(terminalRows * 0.86)));
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const innerWidth = Math.max(1, safeWidth - 2);
		const maxRows = this.maxRows();
		const lines: string[] = [];
		const push = (line: string) => lines.push(truncateToWidth(line, safeWidth, "", true));

		if (maxRows <= 2) {
			const option = this.options[this.focusedIndex];
			if (option) push(this.theme.bold(`→ ${option.label}`));
			else push(this.theme.fg("warning", "No route is available."));
			if (maxRows === 2) push(this.theme.fg("dim", routeChoiceHint(safeWidth)));
			return lines.slice(0, maxRows);
		}

		push(this.theme.fg("accent", this.theme.bold("✦ StarRouter · Confirm route")));
		if (maxRows >= 9) {
			push(this.theme.fg("muted", `Current · ${currentRouteLabel(this.request.currentModel, this.request.currentThinkingLevel)}`));
			push(this.theme.fg("success", `Recommended · ${this.request.decision.provider}/${this.request.decision.modelId} @ ${this.request.decision.thinkingLevel}`));
		} else if (maxRows >= 7) {
			push(this.theme.fg("success", `Recommended · ${this.request.decision.provider}/${this.request.decision.modelId} @ ${this.request.decision.thinkingLevel}`));
		}

		const whyBudget = maxRows >= 18 ? 3 : maxRows >= 13 ? 2 : maxRows >= 10 ? 1 : 0;
		if (whyBudget > 0) {
			push(this.theme.fg("accent", "Why"));
			for (const line of boundedLines(decisionWhyLines(this.request.decision), innerWidth, whyBudget)) {
				push(this.theme.fg("muted", ` ${line}`));
			}
		}
		if (maxRows >= 8) push(this.theme.fg("accent", "Choose route"));

		const footerRows = maxRows >= 4 ? 1 : 0;
		let optionBudget = Math.max(0, maxRows - lines.length - footerRows);
		if (optionBudget > 0) {
			if (this.options.length === 0) {
				push(this.theme.fg("warning", "No route is available."));
			} else {
				const showDescription = optionBudget >= 3 && maxRows >= 10;
				const optionSlots = Math.max(1, optionBudget - (showDescription ? 1 : 0));
				const start = Math.max(0, Math.min(this.focusedIndex - Math.floor(optionSlots / 2), this.options.length - optionSlots));
				const end = Math.min(this.options.length, start + optionSlots);
				for (let index = start; index < end && optionBudget > 0; index += 1) {
					const option = this.options[index]!;
					const focused = index === this.focusedIndex;
					const cursor = focused ? this.theme.fg("accent", "→") : " ";
					const badges = [option.recommended ? this.theme.fg("success", "recommended") : "", option.type === "current" ? this.theme.fg("muted", "current") : ""]
						.filter(Boolean)
						.join(" · ");
					const suffix = badges ? ` · ${badges}` : "";
					const row = `${cursor} ${option.label}${suffix}`;
					push(focused ? this.theme.bold(row) : row);
					optionBudget -= 1;
					if (focused && showDescription && optionBudget > 0) {
						const [description] = boundedLines([option.description], Math.max(1, innerWidth - 2), 1);
						push(this.theme.fg("muted", `  ${description ?? ""}`));
						optionBudget -= 1;
					}
				}
			}
		}

		if (footerRows > 0 && lines.length < maxRows) {
			const position = this.options.length > 1 ? ` · ${this.focusedIndex + 1}/${this.options.length}` : "";
			push(this.theme.fg("dim", `${routeChoiceHint(safeWidth)}${position}`));
		}
		return lines.slice(0, maxRows);
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.done({ action: "cancel" });
			return;
		}
		if (this.options.length === 0) return;
		if (this.keybindings.matches(data, "tui.select.up")) {
			this.focusedIndex = this.focusedIndex === 0 ? this.options.length - 1 : this.focusedIndex - 1;
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.select.down")) {
			this.focusedIndex = this.focusedIndex === this.options.length - 1 ? 0 : this.focusedIndex + 1;
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.select.confirm")) {
			const option = this.options[this.focusedIndex];
			if (!option) return;
			this.done(option.type === "candidate"
				? { action: "candidate", candidate: option.candidate }
				: { action: "current", candidate: option.candidate });
		}
	}
}

export async function openRouteChoice(ctx: ExtensionContext, request: RouteChoiceRequest): Promise<RouteChoiceResult> {
	if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) return { action: "cancel" };
	if (ctx.mode === "rpc") {
		const options = buildRouteChoiceOptions(request);
		const labels = options.map((option, index) => {
			const rationale = option.type === "candidate"
				? candidateDescription(option.candidate)
				: option.candidate
					? candidateDescription(option.candidate)
					: option.description;
			return truncateToWidth(`${index + 1}. ${option.label}${option.recommended ? " · recommended" : ""} — ${rationale}`, 180);
		});
		const selected = await ctx.ui.select("StarRouter · Confirm route", labels);
		const index = selected ? labels.indexOf(selected) : -1;
		const option = index >= 0 ? options[index] : undefined;
		if (!option) return { action: "cancel" };
		return option.type === "candidate"
			? { action: "candidate", candidate: option.candidate }
			: { action: "current", candidate: option.candidate };
	}
	return ctx.ui.custom<RouteChoiceResult>((tui, theme, keybindings, done) => new RouteChoiceComponent(tui, theme, keybindings, request, done), {
		overlay: true,
		overlayOptions: {
			anchor: "center",
			width: "92%",
			maxHeight: "92%",
			margin: 1,
		},
	});
}

export function buildRouteDecisionWidgetLines(decision: RouteDecisionSummary, width = 120): string[] {
	const safeWidth = Math.max(1, width);
	const confidence = decision.confidence ? ` · confidence ${percent(decision.confidence.overall)}%` : "";
	const trustExplanation = decision.reasonLines?.find((line) => /model-only|moving-alias pin|AA alias pin|host unverified/i.test(line));
	const explanation = trustExplanation ?? decision.shortSummary?.[1] ?? decision.shortSummary?.[0] ?? decision.reasonLines?.find((line) => !line.startsWith("Scope:"));
	const lines = [
		"✦ StarRouter",
		`${decision.provider}/${decision.modelId} @ ${decision.thinkingLevel}`,
		`objective ${decision.objectiveUsed}${confidence}`,
	];
	if (explanation) lines.push(explanation);
	return lines.slice(0, 4).map((line) => truncateToWidth(line, safeWidth, "", true));
}

export function createRouteDecisionWidget(decision: RouteDecisionSummary): (tui: unknown, theme: Theme) => Component {
	return (_tui: unknown, theme: Theme) => ({
		invalidate() {},
		render(width: number) {
			return buildRouteDecisionWidgetLines(decision, width).map((line, index) => {
				if (index === 0) return theme.fg("accent", theme.bold(line));
				if (index === 1) return theme.fg("success", line);
				return theme.fg("muted", line);
			});
		},
	});
}
