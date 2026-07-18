import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

initTheme("dark", false);

const agentDir = mkdtempSync(join(tmpdir(), "star-router-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const { default: createExtension } = await import(`../index.ts?settings-runtime=${Date.now()}`);

test.after(() => rmSync(agentDir, { recursive: true, force: true }));

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
			"tui.select.up": ["\x1b[A"],
			"tui.select.down": ["\x1b[B"],
			"tui.select.pageUp": ["\x1b[5~"],
			"tui.select.pageDown": ["\x1b[6~"],
			"tui.select.confirm": ["\r", "\n"],
			"tui.select.cancel": ["\x1b"],
		};
		return values[id]?.includes(data) ?? false;
	},
} as any;

function projectFile(cwd: string): string {
	return join(cwd, ".pi", "model-router.json");
}

function globalFile(): string {
	return join(agentDir, "model-router.json");
}

function writeGlobalConfig(value: unknown): void {
	mkdirSync(dirname(globalFile()), { recursive: true });
	writeFileSync(globalFile(), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function routingModel(id = "openai/gpt-5.5", unitCost = 1) {
	return {
		api: "openai-completions",
		baseUrl: "https://openrouter.ai/api/v1",
		provider: "openrouter",
		id,
		name: id,
		reasoning: false,
		input: ["text"],
		cost: { input: unitCost, output: unitCost * 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	};
}

function makeHistoricalDecision(overrides: Record<string, unknown> = {}) {
	return {
		timestamp: Date.now(),
		changedModel: false,
		changedThinkingLevel: false,
		provider: "openrouter",
		providerScopeMode: "configured-provider",
		providerScopeLabel: "routing provider openrouter",
		availableModelCount: 1,
		availableRouteCount: 1,
		dataSourceLabel: "test dataset",
		objectiveUsed: "balanced",
		modelId: "openai/gpt-5.5",
		modelName: "GPT-5.5",
		requestedThinkingLevel: "off",
		thinkingLevel: "off",
		aaSlug: "gpt-5-5-non-reasoning",
		aaName: "GPT-5.5",
		benchmarkSummary: ["IFBench"],
		profileSummary: "simple",
		reasonLines: ["Scope: openrouter"],
		shortSummary: ["Current route"],
		topCandidates: [{ rank: 1, provider: "openrouter", modelId: "openai/gpt-5.5", thinkingLevel: "off" }],
		...overrides,
	};
}

test.beforeEach(() => {
	rmSync(globalFile(), { force: true });
	rmSync(join(agentDir, "cache"), { recursive: true, force: true });
});

function tempProject(t: test.TestContext): string {
	const cwd = mkdtempSync(join(tmpdir(), "star-router-project-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	mkdirSync(dirname(projectFile(cwd)), { recursive: true });
	writeFileSync(projectFile(cwd), "{}\n", "utf8");
	return cwd;
}

interface HarnessOptions {
	appendEntryError?: Error;
	models?: any[];
	currentModel?: any;
	branch?: any[];
}

function createHarness(cwd: string, drive?: (component: Component & { focused?: boolean }) => void, mode = "tui", options: HarnessOptions = {}) {
	let routerCommand: any;
	const notifications: Array<{ message: string; type: string }> = [];
	const entries: Array<{ type: string; data: unknown }> = [];
	const widgets: Array<{ key: string; content: unknown }> = [];
	const statuses: Array<{ key: string; content: unknown }> = [];
	const handlers = new Map<string, (event: any, ctx: any) => Promise<void> | void>();
	let setModelCalls = 0;
	const pi = {
		registerCommand(name: string, command: unknown) {
			if (name === "router") routerCommand = command;
		},
		on(name: string, handler: (event: any, ctx: any) => Promise<void> | void) { handlers.set(name, handler); },
		appendEntry(type: string, data: unknown) {
			if (options.appendEntryError) throw options.appendEntryError;
			entries.push({ type, data });
		},
		getThinkingLevel() { return "off"; },
		setThinkingLevel() {},
		async setModel() { setModelCalls += 1; return true; },
	} as any;
	createExtension(pi);
	const tui = { terminal: { rows: 30, columns: 100 }, requestRender() {} } as any;
	const ui = {
		theme,
		notify(message: string, type = "info") { notifications.push({ message, type }); },
		setStatus(key: string, content: unknown) { statuses.push({ key, content }); },
		setWidget(key: string, content: unknown) { widgets.push({ key, content }); },
		async custom(factory: any) {
			if (!drive) throw new Error("custom UI must not be called");
			let completed = false;
			let result: unknown;
			const component = factory(tui, theme, keybindings, (value: unknown) => {
				completed = true;
				result = value;
			}) as Component & { focused?: boolean };
			if ("focused" in component) component.focused = true;
			drive(component);
			assert.equal(completed, true, "settings driver did not close the screen");
			return result;
		},
	} as any;
	const ctx = {
		cwd,
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		ui,
		model: options.currentModel,
		modelRegistry: {
			getAll: () => options.models ?? [],
			getAvailable: () => options.models ?? [],
			getProviderAuthStatus: () => ({ configured: false }),
		},
		sessionManager: { getBranch: () => options.branch ?? [] },
	} as any;
	return { routerCommand, ctx, notifications, entries, handlers, widgets, statuses, get setModelCalls() { return setModelCalls; } };
}

function typeSearch(component: Component, text: string): void {
	for (const char of text) component.handleInput?.(char);
}

function chooseNextSubmenuValue(component: Component): void {
	component.handleInput?.("\x1b[B");
	component.handleInput?.("\r");
}

/*
 * Verifies settings edits remain in a draft and Escape leaves the project file byte-for-byte
 * unchanged without emitting a misleading success notification.
 */
test("router settings Escape discards the draft", async (t) => {
	const cwd = tempProject(t);
	const before = readFileSync(projectFile(cwd), "utf8");
	const harness = createHarness(cwd, (component) => {
		typeSearch(component, "objective");
		component.handleInput?.("\x1b[B");
		component.handleInput?.("\r");
		chooseNextSubmenuValue(component);
		component.handleInput?.("\x1b");
	});

	await harness.routerCommand.handler("settings", harness.ctx);
	assert.equal(readFileSync(projectFile(cwd), "utf8"), before);
	assert.equal(harness.notifications.some((item) => item.message.includes("settings saved")), false);
	assert.equal(harness.entries.length, 0);
});

/*
 * Verifies Ctrl+S commits a safe project draft only after the user explicitly saves it.
 */
test("router settings Ctrl+S commits the draft", async (t) => {
	const cwd = tempProject(t);
	const harness = createHarness(cwd, (component) => {
		typeSearch(component, "objective");
		component.handleInput?.("\x1b[B");
		component.handleInput?.("\r");
		chooseNextSubmenuValue(component);
		component.handleInput?.("\x13");
	});

	await harness.routerCommand.handler("settings", harness.ctx);
	const saved = JSON.parse(readFileSync(projectFile(cwd), "utf8"));
	assert.equal(saved.strategy.objective, "quality");
	assert.equal(harness.notifications.some((item) => item.message.includes("settings saved")), true);
	assert.ok(harness.entries.length > 0);
});

/*
 * Verifies global-only controls are visibly inherited and inert in project scope, and project
 * persistence cannot accidentally gain an enabled field after interaction.
 */
test("project settings render global-only controls as read-only", async (t) => {
	const cwd = tempProject(t);
	let inspectedLines: string[] = [];
	const harness = createHarness(cwd, (component) => {
		typeSearch(component, "enabled");
		component.handleInput?.("\x1b[B");
		inspectedLines = component.render(100);
		component.handleInput?.("\r");
		component.handleInput?.("\x13");
	});

	await harness.routerCommand.handler("settings", harness.ctx);
	assert.ok(inspectedLines.some((line) => line.includes("inherited · off")));
	assert.ok(inspectedLines.some((line) => line.includes("Global-only control")));
	const saved = JSON.parse(readFileSync(projectFile(cwd), "utf8"));
	assert.equal("enabled" in saved, false);
});

/*
 * Verifies switching the draft target to global immediately restores editability for controls that
 * are inherited and read-only in project scope, without persisting when the screen is cancelled.
 */
test("global save target restores global-only controls", async (t) => {
	const cwd = tempProject(t);
	let inspectedLines: string[] = [];
	const harness = createHarness(cwd, (component) => {
		typeSearch(component, "target");
		component.handleInput?.("\x1b[B");
		component.handleInput?.("\x1b[B");
		component.handleInput?.("\r");
		const menuLines = component.render(100);
		if (!menuLines.some((line) => line.includes("→ global"))) component.handleInput?.("\x1b[A");
		component.handleInput?.("\r");
		component.handleInput?.("\x0c");
		typeSearch(component, "enabled");
		component.handleInput?.("\x1b[B");
		inspectedLines = component.render(100);
		component.handleInput?.("\x1b");
	});

	await harness.routerCommand.handler("settings", harness.ctx);
	assert.ok(inspectedLines.some((line) => /Enabled · (?:on|off)/.test(line)), inspectedLines.join("\n"));
	assert.equal(inspectedLines.some((line) => line.includes("inherited")), false);
	assert.equal(inspectedLines.some((line) => line.includes("Global-only control")), false);
});

/*
 * Verifies a persistence failure emits no success, appends no session state, and therefore cannot
 * promote the draft to the live settings object.
 */
test("router settings keep the live config when persistence fails", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "star-router-project-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	mkdirSync(projectFile(cwd), { recursive: true });
	const originalError = console.error;
	console.error = () => {};
	t.after(() => { console.error = originalError; });
	const harness = createHarness(cwd, (component) => {
		typeSearch(component, "objective");
		component.handleInput?.("\x1b[B");
		component.handleInput?.("\r");
		chooseNextSubmenuValue(component);
		component.handleInput?.("\x13");
	});

	await harness.routerCommand.handler("settings", harness.ctx);
	assert.equal(harness.notifications.some((item) => item.message.includes("settings saved")), false);
	assert.ok(harness.notifications.some((item) => item.message.includes("live settings were not changed")));
	assert.equal(harness.entries.length, 0);
});

/*
 * Verifies a post-commit session side-effect failure does not claim the file or live config rolled
 * back after the atomic write already succeeded.
 */
test("router settings report saved with warning after post-commit failure", async (t) => {
	const cwd = tempProject(t);
	const harness = createHarness(cwd, (component) => {
		typeSearch(component, "objective");
		component.handleInput?.("\x1b[B");
		component.handleInput?.("\r");
		chooseNextSubmenuValue(component);
		component.handleInput?.("\x13");
	}, "tui", { appendEntryError: new Error("session unavailable") });

	await harness.routerCommand.handler("settings", harness.ctx);
	const saved = JSON.parse(readFileSync(projectFile(cwd), "utf8"));
	assert.equal(saved.strategy.objective, "quality");
	assert.ok(harness.notifications.some((item) => item.message.includes("saved") && item.message.includes("warning")));
	assert.equal(harness.notifications.some((item) => item.message.includes("live settings were not changed")), false);
});

/*
 * Verifies global and effective project drafts remain independent while switching save targets.
 * Explicit global edits persist, but the project override remains the effective live value.
 */
test("scope switching never promotes project overrides into global config", async (t) => {
	writeGlobalConfig({ strategy: { objective: "balanced" } });
	const cwd = tempProject(t);
	writeFileSync(projectFile(cwd), JSON.stringify({ strategy: { objective: "quality" } }), "utf8");
	let invocation = 0;
	let projectLines: string[] = [];
	const harness = createHarness(cwd, (component) => {
		invocation += 1;
		if (invocation === 1) {
			typeSearch(component, "target");
			component.handleInput?.("\x1b[B");
			component.handleInput?.("\x1b[B");
			component.handleInput?.("\r");
			const menuLines = component.render(100);
			if (!menuLines.some((line) => line.includes("→ global"))) component.handleInput?.("\x1b[A");
			component.handleInput?.("\r");
			component.handleInput?.("\x0c");
			typeSearch(component, "objective");
			component.handleInput?.("\x1b[B");
			component.handleInput?.("\r");
			component.handleInput?.("\x1b[B");
			component.handleInput?.("\x1b[B");
			component.handleInput?.("\r");
			component.handleInput?.("\x13");
			return;
		}
		typeSearch(component, "objective");
		component.handleInput?.("\x1b[B");
		projectLines = component.render(100);
		component.handleInput?.("\x1b");
	});

	await harness.routerCommand.handler("settings", harness.ctx);
	assert.equal(JSON.parse(readFileSync(globalFile(), "utf8")).strategy.objective, "cheapest");
	assert.equal(JSON.parse(readFileSync(projectFile(cwd), "utf8")).strategy.objective, "quality");
	await harness.routerCommand.handler("settings", harness.ctx);
	assert.ok(projectLines.some((line) => line.includes("Objective · quality")), projectLines.join("\n"));
});

/*
 * Verifies a missing configured provider stays visibly unavailable and cannot materialize filters
 * for the first unrelated registry provider; global scope still exposes the provider selector.
 */
test("settings preserve strict unavailable-provider state", async (t) => {
	writeGlobalConfig({ strategy: { routingProvider: "missing-provider" } });
	const cwd = tempProject(t);
	const model = routingModel("openai/gpt-5-mini");
	let invocation = 0;
	let projectLines: string[] = [];
	let providerSelectorAvailable = false;
	let providerSelectorDebug = "";
	const harness = createHarness(cwd, (component) => {
		invocation += 1;
		if (invocation === 1) {
			typeSearch(component, "provider");
			component.handleInput?.("\x1b[B");
			projectLines = component.render(100);
			component.handleInput?.("\x1b");
			return;
		}
		typeSearch(component, "target");
		component.handleInput?.("\x1b[B");
		component.handleInput?.("\x1b[B");
		component.handleInput?.("\r");
		const menuLines = component.render(100);
		if (!menuLines.some((line) => line.includes("→ global"))) component.handleInput?.("\x1b[A");
		component.handleInput?.("\r");
		const items = (component as any).options.items as Array<{ id: string; submenu?: unknown }>;
		const providerItem = items.find((item) => item.id === "routing.provider");
		providerSelectorAvailable = typeof providerItem?.submenu === "function";
		providerSelectorDebug = JSON.stringify({ currentValue: (providerItem as any)?.currentValue, ids: items.map((item) => item.id) });
		component.handleInput?.("\x1b");
	}, "tui", { models: [model] });

	await harness.routerCommand.handler("settings", harness.ctx);
	assert.ok(projectLines.some((line) => line.includes("missing-provider (unavailable)")), projectLines.join("\n"));
	assert.equal(projectLines.some((line) => line.includes("openrouter") && line.includes("inherited")), false);
	await harness.routerCommand.handler("settings", harness.ctx);
	assert.equal(providerSelectorAvailable, true, providerSelectorDebug);
});

/*
 * Verifies the settings command refuses RPC/headless custom rendering and reports the supported
 * editing path instead.
 */
test("router settings require TUI mode", async (t) => {
	const cwd = tempProject(t);
	const harness = createHarness(cwd, undefined, "rpc");
	await harness.routerCommand.handler("settings", harness.ctx);

	assert.ok(harness.notifications.some((item) => item.message.includes("require Pi TUI mode")));
});

/*
 * Verifies /router status emits useful text in print mode without relying on no-op UI notifications.
 */
test("router status prints useful output in print mode", async (t) => {
	const cwd = tempProject(t);
	const harness = createHarness(cwd, undefined, "print");
	const output: string[] = [];
	const original = console.log;
	console.log = (...values: unknown[]) => { output.push(values.join(" ")); };
	t.after(() => { console.log = original; });

	await harness.routerCommand.handler("status", harness.ctx);
	assert.deepEqual(output, ["Router status → disabled"]);
});

function aaHostRow(params: {
	slug: string;
	name: string;
	shortName: string;
	creator: string;
	ifbench: number;
	speed?: number;
}) {
	return {
		host_label: "OpenRouter",
		host: { slug: "openrouter", name: "OpenRouter" },
		price_1m_input_tokens: 1,
		price_1m_output_tokens: 2,
		price_1m_blended_0_3_1: 1.5,
		performanceByPromptLength: [{
			prompt_length_type: "medium",
			median_output_speed: params.speed ?? 80,
			median_end_to_end_response_time: 4,
		}],
		model: {
			slug: params.slug,
			name: params.name,
			short_name: params.shortName,
			model_creators: { name: params.creator },
			intelligence_index: params.ifbench,
			ifbench: params.ifbench,
			context_window_tokens: 128_000,
			reasoning_model: false,
			input_modality_image: false,
		},
	};
}

function defaultAaHostRow() {
	return aaHostRow({
		slug: "gpt-5-5-non-reasoning",
		name: "GPT-5.5 (Non-reasoning)",
		shortName: "GPT-5.5",
		creator: "OpenAI",
		ifbench: 85,
	});
}

function provenanceAaHostRows() {
	return [
		aaHostRow({ slug: "gpt-5-5-non-reasoning", name: "GPT-5.5 (Non-reasoning)", shortName: "GPT-5.5", creator: "OpenAI", ifbench: 80, speed: 140 }),
		aaHostRow({ slug: "gemini-3-1-flash-lite-non-reasoning", name: "Gemini 3.1 Flash Lite (Non-reasoning)", shortName: "Gemini Flash Lite", creator: "Google", ifbench: 100, speed: 70 }),
		aaHostRow({ slug: "deepseek-v4-flash-non-reasoning", name: "DeepSeek V4 Flash (Non-reasoning)", shortName: "DeepSeek Flash", creator: "DeepSeek", ifbench: 90, speed: 100 }),
		// Dataset-only floor row keeps every available route above the relative quality floor.
		aaHostRow({ slug: "qwen3-coder-plus-non-reasoning", name: "Qwen3 Coder Plus (Non-reasoning)", shortName: "Qwen3 Coder", creator: "Alibaba", ifbench: 0, speed: 200 }),
	];
}

function mockAaFetch(t: test.TestContext, hostModels = [defaultAaHostRow()]): void {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({ hostModels }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
	t.after(() => { globalThis.fetch = originalFetch; });
}

async function runOneRoutingTurn(harness: ReturnType<typeof createHarness>): Promise<void> {
	await harness.handlers.get("session_start")?.({ reason: "startup" }, harness.ctx);
	await harness.handlers.get("before_agent_start")?.({ prompt: "Rewrite this email briefly.", images: [] }, harness.ctx);
}

function persistedDecision(harness: ReturnType<typeof createHarness>): Record<string, any> {
	const entry = [...harness.entries].reverse().find((item) => item.type === "aa-router-decision" && item.data !== null);
	assert.ok(entry && typeof entry.data === "object");
	return entry.data as Record<string, any>;
}

function provenanceModels() {
	return [
		routingModel("openai/gpt-5.5", 0.1),
		routingModel("google/gemini-3.1-flash-lite", 5),
		routingModel("deepseek/deepseek-v4-flash", 1),
	];
}

function writeProvenanceConfig(autoAcceptRouting: boolean): void {
	writeGlobalConfig({
		enabled: true,
		strategy: {
			routingProvider: "openrouter",
			objective: "quality",
			qualityFloor: 0.3,
			preferCurrentWithin: 0,
			minAaMatch: 0.35,
			minRouteConfidence: 0,
		},
		ui: { autoAcceptRouting },
	});
}

/*
 * Verifies Enter on a recommended current route finalizes and persists a real decision without a
 * model switch, while the TUI receives the normal themed widget.
 */
test("current route confirmation finalizes the lifecycle decision", async (t) => {
	mockAaFetch(t);
	writeGlobalConfig({
		enabled: true,
		strategy: { routingProvider: "openrouter" },
		ui: { autoAcceptRouting: false },
	});
	const cwd = tempProject(t);
	const current = routingModel();
	const harness = createHarness(cwd, (component) => component.handleInput?.("\r"), "tui", {
		models: [current],
		currentModel: current,
	});

	await runOneRoutingTurn(harness);
	assert.equal(harness.setModelCalls, 0);
	assert.ok(harness.entries.some((entry) => entry.type === "aa-router-decision"));
	assert.ok(harness.widgets.some((widget) => widget.key === "aa-router-decision" && typeof widget.content === "function"));
	assert.ok(harness.notifications.some((item) => item.message.includes("Current route confirmed")));
	const decision = persistedDecision(harness);
	assert.equal(decision.recommendationBasis, "objective-ranking");
	assert.equal(decision.applicationOrigin, "user-current");
	assert.equal(decision.topCandidates[0]?.recommended, true);
	assert.equal(decision.topCandidates[0]?.applied, true);
});

/*
 * Verifies confirming a non-current recommendation records user confirmation without conflating it
 * with automatic acceptance or changing the kernel's recommendation rationale.
 */
test("recommended route confirmation records independent provenance", async (t) => {
	mockAaFetch(t, provenanceAaHostRows());
	writeProvenanceConfig(false);
	const cwd = tempProject(t);
	const models = provenanceModels();
	const harness = createHarness(cwd, (component) => component.handleInput?.("\r"), "tui", {
		models,
		currentModel: models[0],
	});

	await runOneRoutingTurn(harness);
	const decision = persistedDecision(harness);
	assert.equal(decision.recommendedRoute.modelId, "google/gemini-3.1-flash-lite");
	assert.equal(decision.modelId, "google/gemini-3.1-flash-lite");
	assert.equal(decision.recommendationBasis, "objective-ranking");
	assert.equal(decision.applicationOrigin, "user-recommended");
	assert.match(decision.shortSummary[0], /^Recommended google\/gemini/);
	assert.match(decision.shortSummary.at(-1), /Applied the recommended route/);
});

/*
 * Verifies selecting another presented candidate preserves the algorithmic recommendation and its
 * explanation while the applied route and candidate flags describe the user's alternative.
 */
test("manual alternative does not become the reported recommendation", async (t) => {
	mockAaFetch(t, provenanceAaHostRows());
	writeProvenanceConfig(false);
	const cwd = tempProject(t);
	const models = provenanceModels();
	const harness = createHarness(cwd, (component) => {
		const options = (component as any).options as Array<{ candidate?: { piModel: { id: string } } }>;
		const alternativeIndex = options.findIndex((option) => option.candidate?.piModel.id === "deepseek/deepseek-v4-flash");
		assert.ok(alternativeIndex >= 0);
		(component as any).focusedIndex = alternativeIndex;
		component.handleInput?.("\r");
	}, "tui", { models, currentModel: models[0] });

	await runOneRoutingTurn(harness);
	const decision = persistedDecision(harness);
	assert.equal(decision.recommendedRoute.modelId, "google/gemini-3.1-flash-lite");
	assert.equal(decision.modelId, "deepseek/deepseek-v4-flash");
	assert.equal(decision.applicationOrigin, "user-alternative");
	assert.match(decision.shortSummary[0], /^Recommended google\/gemini/);
	assert.match(decision.shortSummary.at(-1), /Applied deepseek\/deepseek-v4-flash/);
	assert.equal(decision.topCandidates.find((item: any) => item.recommended)?.modelId, "google/gemini-3.1-flash-lite");
	assert.equal(decision.topCandidates.find((item: any) => item.applied)?.modelId, "deepseek/deepseek-v4-flash");
});

/*
 * Verifies RPC mode receives a serializable plain-text widget instead of a TUI component factory.
 */
test("RPC routing emits plain decision widget lines", async (t) => {
	mockAaFetch(t);
	writeGlobalConfig({
		enabled: true,
		strategy: { routingProvider: "openrouter" },
		ui: { autoAcceptRouting: true },
	});
	const cwd = tempProject(t);
	const current = routingModel();
	const harness = createHarness(cwd, undefined, "rpc", { models: [current], currentModel: current });

	await runOneRoutingTurn(harness);
	const widget = harness.widgets.find((item) => item.key === "aa-router-decision" && Array.isArray(item.content));
	assert.ok(Array.isArray(widget?.content));
	assert.ok((widget?.content as string[]).length <= 4);
	assert.ok((widget?.content as string[]).some((line) => line.includes("openrouter/openai/gpt-5.5")));
	const decision = persistedDecision(harness);
	assert.equal(decision.recommendationBasis, "objective-ranking");
	assert.equal(decision.applicationOrigin, "auto-accept");
});

/*
 * Verifies Escape persists an explicit null decision marker so a branch reload cannot resurrect an
 * older decision after the confirmation UI has deliberately cleared it.
 */
test("route cancellation persists and restores a decision clear marker", async (t) => {
	mockAaFetch(t);
	writeGlobalConfig({
		enabled: true,
		strategy: { routingProvider: "openrouter" },
		ui: { autoAcceptRouting: false },
	});
	const cwd = tempProject(t);
	const current = routingModel();
	const harness = createHarness(cwd, (component) => component.handleInput?.("\x1b"), "tui", {
		models: [current],
		currentModel: current,
	});

	await runOneRoutingTurn(harness);
	assert.ok(harness.entries.some((entry) => entry.type === "aa-router-decision" && entry.data === null));
	assert.equal(harness.widgets.at(-1)?.content, undefined);

	const historicalDecision = { provider: "openrouter", modelId: "old/model", thinkingLevel: "off" } as any;
	const restored = createHarness(cwd, undefined, "tui", {
		branch: [
			{ type: "custom", customType: "aa-router-state", data: { enabled: true } },
			{ type: "custom", customType: "aa-router-decision", data: historicalDecision },
			{ type: "custom", customType: "aa-router-decision", data: null },
		],
	});
	await restored.handlers.get("session_tree")?.({}, restored.ctx);
	assert.equal(restored.widgets.at(-1)?.content, undefined);
	assert.equal(restored.statuses.at(-1)?.content, "router:on");
});

/*
 * Verifies branch restoration rehydrates an active decision widget, while disabling the router
 * removes ambient decision UI and reports disabled even though the historical decision remains.
 */
test("session lifecycle syncs decision widgets and disabled status", async (t) => {
	mockAaFetch(t);
	const cwd = tempProject(t);
	const historicalDecision = makeHistoricalDecision();
	const harness = createHarness(cwd, undefined, "print", {
		branch: [
			{ type: "custom", customType: "aa-router-state", data: { enabled: true } },
			{ type: "custom", customType: "aa-router-decision", data: historicalDecision },
		],
	});

	await harness.handlers.get("session_start")?.({ reason: "startup" }, harness.ctx);
	assert.equal(typeof harness.widgets.at(-1)?.content, "function");
	await harness.routerCommand.handler("off", harness.ctx);
	assert.equal(harness.widgets.at(-1)?.content, undefined);

	const output: string[] = [];
	const original = console.log;
	console.log = (...values: unknown[]) => { output.push(values.join(" ")); };
	t.after(() => { console.log = original; });
	await harness.routerCommand.handler("status", harness.ctx);
	assert.deepEqual(output, ["Router status → disabled"]);
});

/*
 * Verifies saving a global disabled draft synchronizes ambient UI immediately instead of leaving a
 * historical route widget visible until the next lifecycle event.
 */
test("settings disable clears the decision widget", async (t) => {
	mockAaFetch(t);
	writeGlobalConfig({ enabled: true, strategy: { routingProvider: "openrouter" } });
	const cwd = tempProject(t);
	const decision = makeHistoricalDecision();
	const harness = createHarness(cwd, (component) => {
		typeSearch(component, "target");
		component.handleInput?.("\x1b[B");
		component.handleInput?.("\x1b[B");
		component.handleInput?.("\r");
		const menuLines = component.render(100);
		if (!menuLines.some((line) => line.includes("→ global"))) component.handleInput?.("\x1b[A");
		component.handleInput?.("\r");
		component.handleInput?.("\x0c");
		typeSearch(component, "enabled");
		component.handleInput?.("\x1b[B");
		component.handleInput?.("\r");
		chooseNextSubmenuValue(component);
		component.handleInput?.("\x13");
	}, "tui", {
		branch: [
			{ type: "custom", customType: "aa-router-state", data: { enabled: true } },
			{ type: "custom", customType: "aa-router-decision", data: decision },
		],
	});
	await harness.handlers.get("session_start")?.({ reason: "startup" }, harness.ctx);
	assert.equal(typeof harness.widgets.at(-1)?.content, "function");
	await harness.routerCommand.handler("settings", harness.ctx);
	assert.equal(JSON.parse(readFileSync(globalFile(), "utf8")).enabled, false);
	assert.equal(harness.widgets.at(-1)?.content, undefined);
});

/*
 * Verifies print mode emits actionable direct-JSON guidance rather than relying on an invisible UI
 * notification channel.
 */
test("print settings emits direct JSON guidance", async (t) => {
	const cwd = tempProject(t);
	const harness = createHarness(cwd, undefined, "print");
	const output: string[] = [];
	const original = console.log;
	console.log = (...values: unknown[]) => { output.push(values.join(" ")); };
	t.after(() => { console.log = original; });
	await harness.routerCommand.handler("settings", harness.ctx);
	assert.ok(output.some((line) => line.includes("model-router.json") && line.includes("Pi TUI mode")));
});

/*
 * Verifies malformed custom decision entries are ignored while valid state restoration continues,
 * preventing status/widget rendering from dereferencing attacker-controlled session shapes.
 */
test("malformed session decisions are ignored", async (t) => {
	const cwd = tempProject(t);
	const harness = createHarness(cwd, undefined, "tui", {
		branch: [
			{ type: "custom", customType: "aa-router-state", data: { enabled: true } },
			{ type: "custom", customType: "aa-router-decision", data: { provider: "\u001b[2J", modelId: 7, thinkingLevel: "root" } },
			{
				type: "custom",
				customType: "aa-router-decision",
				data: makeHistoricalDecision({
					recommendationBasis: "objective-ranking",
					applicationOrigin: "invalid-origin",
					recommendedRoute: { provider: "openrouter", modelId: "openai/gpt-5.5", modelName: "GPT-5.5", thinkingLevel: "off" },
				}),
			},
		],
	});
	await harness.handlers.get("session_tree")?.({}, harness.ctx);
	assert.equal(harness.widgets.at(-1)?.content, undefined);
	assert.equal(harness.statuses.at(-1)?.content, "router:on");
});

/*
 * Verifies /router refresh distinguishes a network refresh, validated stale recovery, and total
 * acquisition failure without claiming that an old cache was refreshed.
 */
test("refresh reports network stale and failed provenance", async (t) => {
	mockAaFetch(t);
	const cwd = tempProject(t);
	const harness = createHarness(cwd);
	await harness.routerCommand.handler("refresh", harness.ctx);
	assert.ok(harness.notifications.some((item) => item.type === "info" && item.message.includes("from the network")));

	const originalError = console.error;
	console.error = () => {};
	t.after(() => { console.error = originalError; });
	globalThis.fetch = async () => { throw new Error("offline refresh"); };
	await harness.routerCommand.handler("refresh", harness.ctx);
	assert.ok(harness.notifications.some((item) => item.type === "warning" && item.message.includes("validated cache")));

	rmSync(join(agentDir, "cache"), { recursive: true, force: true });
	await harness.routerCommand.handler("refresh", harness.ctx);
	assert.ok(harness.notifications.some((item) => item.type === "warning" && item.message.includes("refresh failed")));
	assert.equal(harness.setModelCalls, 0);
});
