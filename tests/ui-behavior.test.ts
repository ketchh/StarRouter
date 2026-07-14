import test from "node:test";
import assert from "node:assert/strict";
import type { Api, Model } from "@earendil-works/pi-ai";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import {
	RouteChoiceComponent,
	buildRouteChoiceOptions,
	buildRouteDecisionWidgetLines,
	createRouteDecisionWidget,
	openRouteChoice,
	type RouteChoiceRequest,
} from "../src/route-choice-screen.ts";
import { ModelFiltersScreen, type RouterModelFilters } from "../src/model-filters-screen.ts";
import { SettingsTreeScreen } from "../src/settings-screen.ts";
import type { Candidate, RouteDecisionSummary } from "../src/router-core.ts";

initTheme("dark", false);

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	strikethrough: (text: string) => text,
} as any;

const keybindings = {
	matches(data: string, id: string) {
		const values: Record<string, string[]> = {
			"tui.select.up": ["UP", "\x1b[A"],
			"tui.select.down": ["DOWN", "\x1b[B"],
			"tui.select.pageUp": ["PAGEUP", "\x1b[5~"],
			"tui.select.pageDown": ["PAGEDOWN", "\x1b[6~"],
			"tui.select.confirm": ["ENTER", "\r", "\n"],
			"tui.select.cancel": ["ESC", "\x1b"],
		};
		return values[id]?.includes(data) ?? false;
	},
} as KeybindingsManager;

function fakeTui(rows: number, columns = 120): TUI & { renders: number } {
	return {
		terminal: { rows, columns },
		renders: 0,
		requestRender() {
			this.renders += 1;
		},
	} as any;
}

function model(provider: string, id: string): Model<Api> {
	return {
		api: "openai-completions",
		baseUrl: "https://example.test/v1",
		provider,
		id,
		name: id,
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	} as Model<Api>;
}

function candidate(provider: string, id: string, thinkingLevel: Candidate["candidateThinkingLevel"] = "off"): Candidate {
	return {
		piModel: model(provider, id),
		candidateThinkingLevel: thinkingLevel,
		requestedThinkingLevel: thinkingLevel,
		aaModel: {
			sourceMode: "api",
			slug: id.replaceAll("/", "-"),
			name: id,
			shortName: id,
			reasoningModel: thinkingLevel !== "off",
			inputModalityImage: false,
			performanceByPromptLength: [],
		},
		aaMatchScore: 1,
		aaVariantLevel: thinkingLevel,
		aaEvidenceScope: "host-verified",
		benchmarkScore: 1.7,
		price: 0.2,
		speed: 100,
		latency: 2,
		contextWindow: 128_000,
		economicScore: -0.4,
		speedScore: 1.4,
		latencyScore: 0.8,
		contextScore: 2,
		scoreBreakdown: { quality: 0.5, cost: 0.2, speed: 0.1, latency: 0.1, context: 0.1, match: 1 },
		confidence: { overall: 1.3, match: 1, constraints: 1, cost: 1, notes: [] },
		reasonBits: ["good cost", "fast"],
		composite: 1.8,
	} as Candidate;
}

function decision(provider: string, id: string, thinkingLevel: RouteDecisionSummary["thinkingLevel"] = "off"): RouteDecisionSummary {
	return {
		timestamp: Date.now(),
		changedModel: true,
		changedThinkingLevel: false,
		provider,
		providerScopeMode: "configured-provider",
		providerScopeLabel: `routing provider ${provider}`,
		availableModelCount: 3,
		availableRouteCount: 3,
		dataSourceLabel: "test",
		objectiveUsed: "balanced",
		modelId: id,
		modelName: id,
		requestedThinkingLevel: thinkingLevel,
		thinkingLevel,
		aaSlug: id,
		aaName: id,
		benchmarkSummary: ["IFBench"],
		profileSummary: "simple",
		confidence: { overall: 0.83, match: 0.9, constraints: 0.8, cost: 1, notes: [] },
		reasonLines: ["Scope: test", "Trade-off: fit 90 · cost 80"],
		shortSummary: ["Selected the best route.", "It wins on fit and cost without wasting reasoning."],
		topCandidates: [],
	};
}

function requestFor(recommended: Candidate, current?: Model<Api>, currentThinkingLevel: Candidate["candidateThinkingLevel"] = "off"): RouteChoiceRequest {
	return {
		decision: decision(String(recommended.piModel.provider), recommended.piModel.id, recommended.candidateThinkingLevel),
		candidates: [recommended, candidate("openrouter", "alternative-model", "low")],
		currentModel: current,
		currentThinkingLevel,
	};
}

/*
 * Verifies that a recommendation equal to the current provider/model/thinking route is represented
 * by the current option, focused initially, and confirmed as an intentional keep-current action.
 */
test("current recommended route is focused and Enter keeps current", () => {
	const current = candidate("openrouter", "same-model", "medium");
	const request = requestFor(current, current.piModel, "medium");
	const options = buildRouteChoiceOptions(request);
	const results: Array<Parameters<ConstructorParameters<typeof RouteChoiceComponent>[4]>[0]> = [];
	const component = new RouteChoiceComponent(fakeTui(24), theme, keybindings, request, (value) => results.push(value));

	assert.equal(options[0]?.type, "current");
	assert.equal(options[0]?.recommended, true);
	assert.equal(options.filter((option) => option.key === options[0]?.key).length, 1);
	component.handleInput("ENTER");
	assert.equal(results.length, 1);
	assert.equal(results[0]?.action, "current");
	assert.equal(results[0]?.action === "current" ? results[0].candidate : undefined, current);
});

/*
 * Verifies that candidate confirmation uses the focused provider/model/thinking route directly,
 * with no secondary Space-mark state.
 */
test("focused candidate is selected with Enter", () => {
	const recommended = candidate("openrouter", "winner", "high");
	const request = requestFor(recommended, model("openrouter", "current"), "off");
	let selected: Parameters<ConstructorParameters<typeof RouteChoiceComponent>[4]>[0] | undefined;
	const component = new RouteChoiceComponent(fakeTui(24), theme, keybindings, request, (value) => { selected = value; });

	component.handleInput("ENTER");
	assert.equal(selected?.action, "candidate");
	assert.equal(selected?.action === "candidate" ? selected.candidate : undefined, recommended);
});

/*
 * Verifies that Escape always keeps the current route, even when a candidate is focused.
 */
test("route confirmation Escape keeps current", () => {
	const recommended = candidate("openrouter", "winner", "high");
	const request = requestFor(recommended, model("openrouter", "current"), "off");
	let calls = 0;
	let selected: Parameters<ConstructorParameters<typeof RouteChoiceComponent>[4]>[0] | undefined;
	const component = new RouteChoiceComponent(fakeTui(24), theme, keybindings, request, (value) => {
		calls += 1;
		selected = value;
	});

	component.handleInput("ESC");
	assert.equal(calls, 1);
	assert.equal(selected?.action, "cancel");
});

/*
 * Verifies route identity includes provider and thinking level, so equal model ids on different
 * providers or at different reasoning levels remain distinct options.
 */
test("route options use provider model and thinking identity", () => {
	const primary = candidate("openrouter", "shared-id", "off");
	const request: RouteChoiceRequest = {
		decision: decision("openrouter", "shared-id", "off"),
		candidates: [primary, candidate("github-copilot", "shared-id", "off"), candidate("openrouter", "shared-id", "high")],
	};

	assert.equal(buildRouteChoiceOptions(request).length, 3);
});

/*
 * Verifies the compact route overlay respects both width and available terminal-height budgets
 * across wide, normal, narrow, and very small terminal matrices.
 */
test("route confirmation renders responsively within terminal budgets", () => {
	const recommended = candidate("openrouter", "a-very-long-recommended-model-name", "high");
	const request = requestFor(recommended, model("openrouter", "current-model-with-a-long-name"), "off");
	for (const [width, rows] of [[120, 40], [80, 24], [60, 16], [40, 10], [40, 6]] as const) {
		const component = new RouteChoiceComponent(fakeTui(rows, width), theme, keybindings, request, () => {});
		const lines = component.render(width);
		const maxRows = Math.max(1, Math.min(Math.max(1, rows - 4), Math.floor(rows * 0.86)));
		assert.ok(lines.length <= maxRows, `${width}x${rows}: ${lines.length} > ${maxRows}`);
		assert.ok(lines.every((line) => visibleWidth(line) <= width), `${width}x${rows}: line overflow`);
		if (rows > 6) assert.match(lines[0] ?? "", /StarRouter/);
		assert.ok(lines.some((line) => /winner|recommended|a-very-long/.test(line)), `${width}x${rows}: route missing`);
		if (rows >= 10 || rows === 6) {
			assert.match(lines.at(-1) ?? "", /choose/);
			assert.match(lines.at(-1) ?? "", /keep/);
		}
	}
});

/*
 * Verifies candidate metrics shown to users are clamped to meaningful percentages instead of
 * leaking negative values or scores above one hundred.
 */
test("route descriptions clamp percentages", () => {
	const recommended = candidate("openrouter", "winner", "high");
	const option = buildRouteChoiceOptions(requestFor(recommended))[0];
	assert.match(option?.description ?? "", /task fit 100%/);
	assert.match(option?.description ?? "", /cost 0%/);
	assert.doesNotMatch(option?.description ?? "", /170|180|200|-/);
});

/*
 * Verifies missing host economics are described as unavailable instead of a measured zero score.
 */
test("route descriptions label missing economics as n/a", () => {
	const modelOnly = { ...candidate("openrouter", "winner"), price: Number.POSITIVE_INFINITY, latency: undefined, aaEvidenceScope: "model-only" as const };
	const option = buildRouteChoiceOptions(requestFor(modelOnly))[0];
	assert.match(option?.description ?? "", /cost n\/a/);
	assert.match(option?.description ?? "", /latency n\/a/);
});

/*
 * Verifies model-only and pin disclosures lead both the focused candidate description and the Why
 * explanation, so narrow one-line budgets cannot truncate trust information behind generic metrics.
 */
test("route confirmation prioritizes model-only trust disclosure", () => {
	const modelOnly = {
		...candidate("openrouter", "winner"),
		price: Number.POSITIVE_INFINITY,
		latency: undefined,
		aaEvidenceScope: "model-only" as const,
		reasonBits: ["thinking off", "AA model-only evidence", "explicit AA alias pin"],
	};
	const request = requestFor(modelOnly);
	request.decision.reasonLines = [
		"Scope: test",
		"Trade-off: fit 90 · cost n/a · speed n/a · latency n/a",
		"Model-only evidence: host performance unavailable.",
	];
	for (const [width, rows] of [[80, 24], [60, 16]] as const) {
		const component = new RouteChoiceComponent(fakeTui(rows, width), theme, keybindings, request, () => {});
		const rendered = component.render(width).join("\n");
		assert.match(rendered, /model-only evidence/i, `${width}x${rows}: candidate trust disclosure missing`);
		assert.match(rendered, /host performance unavailable/i, `${width}x${rows}: prioritized Why disclosure missing`);
	}
});

/*
 * Verifies RPC mode uses the extension UI select protocol and deterministically maps the selected
 * label back to the candidate object.
 */
test("route confirmation maps RPC selection to candidate", async () => {
	const recommended = candidate("openrouter", "winner", "high");
	const request = requestFor(recommended, model("openrouter", "current"), "off");
	let offered: string[] = [];
	const ctx = {
		hasUI: true,
		mode: "rpc",
		ui: {
			async select(_title: string, options: string[]) {
				offered = options;
				return options.find((option) => option.includes("winner"));
			},
		},
	} as any;

	const result = await openRouteChoice(ctx, request);
	assert.equal(result.action, "candidate");
	assert.equal(result.action === "candidate" ? result.candidate : undefined, recommended);
	assert.ok(offered.some((option) => option.includes("recommended")));
	assert.ok(offered.some((option) => option.includes("task fit") && option.includes("confidence")));
});

/*
 * Verifies print/JSON/no-UI modes do not silently auto-accept a route when confirmation is required.
 */
test("route confirmation is safe without interactive confirmation", async () => {
	const recommended = candidate("openrouter", "winner", "high");
	const request = requestFor(recommended);
	for (const ctx of [
		{ hasUI: false, mode: "print" },
		{ hasUI: false, mode: "json" },
		{ hasUI: true, mode: "print" },
	] as const) {
		assert.equal((await openRouteChoice(ctx as any, request)).action, "cancel");
	}
});

/*
 * Verifies the persistent decision widget remains ambient and compact at four lines or fewer.
 */
test("decision widget is compact and width safe", () => {
	const routeDecision = decision("openrouter", "winner", "high");
	routeDecision.reasonLines = ["Model-only evidence: host performance unavailable."];
	const widget = createRouteDecisionWidget(routeDecision)(fakeTui(24), theme);
	for (const width of [120, 60, 40]) {
		const lines = widget.render(width);
		const plainLines = buildRouteDecisionWidgetLines(routeDecision, width);
		assert.ok(lines.length <= 4);
		assert.ok(plainLines.length <= 4);
		assert.ok(lines.every((line) => visibleWidth(line) <= width));
		assert.ok(plainLines.every((line) => visibleWidth(line) <= width));
		assert.match(plainLines.at(-1) ?? "", /Model-only evidence/i);
	}
});

/*
 * Verifies SettingsTree exposes a real focus target for IME positioning and routes Ctrl+S/Escape
 * to explicit Save/Cancel callbacks rather than conflating close with persistence.
 */
test("settings screen exposes IME cursor and explicit Save Cancel", () => {
	let saved = 0;
	let cancelled = 0;
	const component = new SettingsTreeScreen(fakeTui(24), theme, keybindings, {
		title: "Settings",
		items: [{ id: "enabled", label: "General › Enabled", currentValue: "off", values: ["off", "on"] }],
		onChange: () => {},
		onSave: () => { saved += 1; },
		onClose: () => { cancelled += 1; },
		isDirty: () => true,
		enableSearch: true,
	});
	component.focused = true;

	assert.ok(component.render(80).some((line) => line.includes(CURSOR_MARKER)));
	assert.match(component.render(80)[0] ?? "", /\*/);
	for (const width of [80, 40]) {
		const lines = component.render(width);
		assert.ok(lines.length <= 22);
		assert.ok(lines.every((line) => visibleWidth(line) <= width));
	}
	component.handleInput("\x13");
	component.handleInput("ESC");
	assert.equal(saved, 1);
	assert.equal(cancelled, 1);
});

/*
 * Verifies settings preserve the title, one focused actionable row, and explicit Save/Cancel footer
 * across the release terminal matrix, including the 40x6 emergency layout.
 */
test("settings render matrix preserves action and commit controls", () => {
	for (const [width, rows] of [[120, 40], [80, 24], [60, 16], [40, 10], [40, 6]] as const) {
		const component = new SettingsTreeScreen(fakeTui(rows, width), theme, keybindings, {
			title: "Settings",
			items: [{ id: "enabled", label: "General › Enabled", currentValue: "off", values: ["off", "on"] }],
			onChange: () => {},
			onSave: () => {},
			onClose: () => {},
			enableSearch: true,
		});
		const lines = component.render(width);
		assert.ok(lines.length <= Math.max(1, rows - 2), `${width}x${rows}: height`);
		assert.ok(lines.every((line) => visibleWidth(line) <= width), `${width}x${rows}: width`);
		assert.ok(lines.some((line) => line.includes("Settings")), `${width}x${rows}: title`);
		assert.ok(lines.some((line) => line.includes("→")), `${width}x${rows}: focused row`);
		assert.ok(lines.some((line) => line.includes("save")), `${width}x${rows}: save footer`);
		assert.ok(lines.some((line) => line.includes("cancel")), `${width}x${rows}: cancel footer`);
	}
});

/*
 * Verifies long unicode searches keep the IME marker visible without overflowing the terminal.
 */
test("settings search keeps the IME cursor visible for long unicode input", () => {
	const component = new SettingsTreeScreen(fakeTui(16), theme, keybindings, {
		title: "Settings",
		items: [{ id: "enabled", label: "General › Enabled", currentValue: "off", values: ["off", "on"] }],
		onChange: () => {},
		onSave: () => {},
		onClose: () => {},
		enableSearch: true,
	});
	component.focused = true;
	for (const char of "impostazione-非常に-lunga-".repeat(8)) component.handleInput(char);
	const lines = component.render(40);
	assert.ok(lines.some((line) => line.includes(CURSOR_MARKER)));
	assert.ok(lines.every((line) => visibleWidth(line) <= 40));
});

/*
 * Verifies focus is propagated from SettingsTree to an active focusable submenu, which is required
 * for the numeric Input wrappers used by advanced settings.
 */
test("settings screen propagates focus to submenus", () => {
	let childFocused = false;
	const child: Component & { focused: boolean } = {
		get focused() { return childFocused; },
		set focused(value: boolean) { childFocused = value; },
		render: () => [childFocused ? CURSOR_MARKER : ""],
		invalidate() {},
		handleInput() {},
	};
	const component = new SettingsTreeScreen(fakeTui(24), theme, keybindings, {
		title: "Settings",
		items: [{ id: "value", label: "General › Value", currentValue: "1", submenu: (_value, _done) => child }],
		onChange: () => {},
		onSave: () => {},
		onClose: () => {},
	});
	component.focused = true;
	component.handleInput("DOWN");
	component.handleInput("ENTER");

	assert.equal(childFocused, true);
	assert.ok(component.render(80).some((line) => line.includes(CURSOR_MARKER)));
});

function filterTabs() {
	return [{ id: "routing", label: "Routing", provider: "openrouter", models: [model("openrouter", "alpha"), model("openrouter", "beta")] }];
}

/*
 * Verifies model-filter edits stay in a private copy: Escape discards them, while Ctrl+S returns
 * an applied snapshot to the parent settings draft.
 */
test("model filters cancel or apply their draft explicitly", () => {
	const initial: RouterModelFilters = { providers: { openrouter: { preset: "none", disabledFamilies: [], disabledModels: [] } } };
	let cancelledValue: RouterModelFilters | undefined = initial;
	const cancelled = new ModelFiltersScreen(fakeTui(24), theme, keybindings, filterTabs(), initial, (value) => { cancelledValue = value; });
	cancelled.handleInput("ENTER");
	cancelled.handleInput("ESC");
	assert.equal(cancelledValue, undefined);
	assert.deepEqual(initial.providers.openrouter?.disabledFamilies, []);

	let applied: RouterModelFilters | undefined;
	const saved = new ModelFiltersScreen(fakeTui(24), theme, keybindings, filterTabs(), initial, (value) => { applied = value; });
	saved.handleInput("ENTER");
	saved.handleInput("\x13");
	assert.ok((applied?.providers.openrouter?.disabledFamilies.length ?? 0) > 0);
});

/*
 * Verifies model-filter search and preset-name modes expose CURSOR_MARKER, and saving a preset via
 * Ctrl+Shift+S neither applies nor closes the filter draft implicitly.
 */
test("model filters support IME and non-closing preset saves", () => {
	const initial: RouterModelFilters = { providers: { openrouter: { preset: "none", disabledFamilies: [], disabledModels: [] } } };
	let doneCalls = 0;
	let savedName = "";
	const component = new ModelFiltersScreen(fakeTui(18), theme, keybindings, filterTabs(), initial, () => { doneCalls += 1; }, {
		onSavePreset(name) { savedName = name; },
	});
	component.focused = true;
	assert.ok(component.render(60).some((line) => line.includes(CURSOR_MARKER)));
	component.handleInput("\x1b[115;6u");
	component.handleInput("t");
	component.handleInput("e");
	component.handleInput("a");
	component.handleInput("m");
	assert.ok(component.render(60).some((line) => line.includes(CURSOR_MARKER)));
	component.handleInput("ENTER");

	assert.equal(savedName, "team");
	assert.equal(doneCalls, 0);
	assert.ok(component.render(60).some((line) => line.includes("Saved preset")));
});

/*
 * Verifies model-filter list height follows terminal rows and every rendered line remains width-safe.
 */
test("model filter render is terminal-height and width safe", () => {
	const initial: RouterModelFilters = { providers: { openrouter: { preset: "none", disabledFamilies: [], disabledModels: [] } } };
	for (const [width, rows] of [[120, 40], [80, 24], [60, 16], [40, 10], [40, 6]] as const) {
		const component = new ModelFiltersScreen(fakeTui(rows), theme, keybindings, filterTabs(), initial, () => {});
		const lines = component.render(width);
		assert.ok(lines.length <= Math.max(1, rows - 2), `${width}x${rows}: height`);
		assert.ok(lines.every((line) => visibleWidth(line) <= width), `${width}x${rows}: width`);
		assert.ok(lines.some((line) => line.includes("Model Filters")), `${width}x${rows}: title`);
		assert.ok(lines.some((line) => line.includes("→")), `${width}x${rows}: focused row`);
		assert.ok(lines.some((line) => line.includes("apply")), `${width}x${rows}: apply footer`);
		assert.ok(lines.some((line) => line.includes("cancel")), `${width}x${rows}: cancel footer`);
	}
});

/*
 * Verifies long unicode search and preset names retain the IME marker without overflowing.
 */
test("model filter long inputs keep a visible IME cursor", () => {
	const initial: RouterModelFilters = { providers: { openrouter: { preset: "none", disabledFamilies: [], disabledModels: [] } } };
	const component = new ModelFiltersScreen(fakeTui(16), theme, keybindings, filterTabs(), initial, () => {}, {
		onSavePreset() {},
	});
	component.focused = true;
	for (const char of "modello-非常に-lungo-".repeat(8)) component.handleInput(char);
	let lines = component.render(40);
	assert.ok(lines.some((line) => line.includes(CURSOR_MARKER)));
	assert.ok(lines.every((line) => visibleWidth(line) <= 40));

	component.handleInput("\x1b[115;6u");
	for (const char of "preset-非常に-lungo-".repeat(8)) component.handleInput(char);
	lines = component.render(40);
	assert.ok(lines.some((line) => line.includes(CURSOR_MARKER)));
	assert.ok(lines.every((line) => visibleWidth(line) <= 40));
});
