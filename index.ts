import { existsSync } from "node:fs";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	getSelectListTheme,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container, Input, SelectList, Text, type Component, type SelectItem, type SettingItem } from "@earendil-works/pi-tui";
import { createRouteDecisionWidget, openRouteChoice } from "./src/route-choice-screen.ts";
import { createSettingsScreen } from "./src/settings-screen.ts";
import { MODEL_FILTER_PRESET_IDS, getModelFilterPreset, type ModelFilterPresetId } from "./src/filter-presets/index.ts";
import { loadSavedModelFilterPresets, saveModelFilterPreset } from "./src/filter-presets/storage.ts";
import {
	applyBuiltInModelFilterPreset,
	applyModelFilters,
	buildProviderFilterSummary,
	createModelFiltersScreen,
	getProviderFilterConfig,
	normalizeModelFilters,
	type RouterModelFilters,
} from "./src/model-filters-screen.ts";
import * as core from "./src/router-core.ts";
import type {
	AaDataset,
	Candidate,
	DatasetStats,
	RouteDecisionSummary,
	RouteObjective,
	RouterConfig,
	RouterSettingsScope,
} from "./src/router-core.ts";

const {
	clamp,
	listAvailableProviders,
	resolveRoutingProvider,
	getProviderScopedModels,
	getProjectConfigFile,
	getConfigFileForScope,
	getFilterPresetDirForScope,
	loadConfig,
	saveConfigForScope,
	buildStats,
	inferPromptProfile,
	currentModelKey,
	chooseRoute,
	buildDecisionSummary,
	isContextDependentFollowUp,
	summarizeDecision,
	fetchAaModels,
	clearAaMatchCache,
	DEFAULT_CONFIG,
	ROUTER_STATE_ENTRY,
	ROUTER_DECISION_ENTRY,
	GLOBAL_CONFIG_FILE,
} = core;

export default function aaModelRouter(pi: ExtensionAPI) {
	let config: RouterConfig = DEFAULT_CONFIG;
	let enabled = DEFAULT_CONFIG.enabled;
	let lastDecision: RouteDecisionSummary | undefined;
	let aaDataset: AaDataset | undefined;
	let datasetStats: DatasetStats | undefined;
	let datasetPromise: Promise<AaDataset> | undefined;
	let datasetGeneration = 0;

	/* Redis-style note: the status line is deliberately tiny.  The router is
	 * allowed to be smart internally, but the ambient UI should never feel like
	 * a second product fighting the editor for attention. */
	function updateStatus(ctx: ExtensionContext) {
		if (!enabled) {
			ctx.ui.setStatus("aa-router", "router:off");
			return;
		}
		if (!lastDecision) {
			ctx.ui.setStatus("aa-router", "router:on");
			return;
		}
		ctx.ui.setStatus("aa-router", `route:${lastDecision.modelId}@${lastDecision.thinkingLevel}`);
	}

	/* Dataset loading is single-flight per generation.  A settings save bumps the
	 * generation, so an older in-flight fetch cannot repopulate the current cache
	 * after the user changed routing inputs. */
	async function ensureDataset(force = false): Promise<AaDataset> {
		if (force) resetCachedRoutingData();
		if (!force && aaDataset) return aaDataset;
		if (!force && datasetPromise) return datasetPromise;
		const generation = datasetGeneration;
		const fetchConfig = structuredClone(config) as RouterConfig;
		const promise = fetchAaModels(fetchConfig)
			.then((dataset) => {
				if (generation === datasetGeneration) {
					aaDataset = dataset;
					datasetStats = buildStats(dataset.models);
				}
				return dataset;
			})
			.finally(() => {
				if (generation === datasetGeneration && datasetPromise === promise) datasetPromise = undefined;
			});
		datasetPromise = promise;
		return promise;
	}

	/* We persist only product state, not diagnostic telemetry.  The active branch
	 * can restore whether routing was enabled and what was last selected, while a
	 * clean public V1 avoids hidden analytics-style session noise. */
	function persistEnabledState(value: boolean) {
		pi.appendEntry(ROUTER_STATE_ENTRY, { enabled: value, timestamp: Date.now() });
	}

	function persistDecision(decision: RouteDecisionSummary) {
		pi.appendEntry(ROUTER_DECISION_ENTRY, decision);
	}

	function resetCachedRoutingData() {
		datasetGeneration += 1;
		aaDataset = undefined;
		datasetStats = undefined;
		datasetPromise = undefined;
		clearAaMatchCache();
	}

	function restoreStateFromActiveBranch(ctx: ExtensionContext) {
		enabled = config.enabled;
		lastDecision = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom") continue;
			const data = entry.data as { enabled?: unknown } | RouteDecisionSummary | undefined;
			if (entry.customType === ROUTER_STATE_ENTRY && typeof (data as { enabled?: unknown } | undefined)?.enabled === "boolean") {
				enabled = (data as { enabled: boolean }).enabled;
				config.enabled = enabled;
			}
			if (entry.customType === ROUTER_DECISION_ENTRY && data && typeof data === "object") {
				lastDecision = data as RouteDecisionSummary;
			}
		}
	}

	/* Built-in presets are templates, not locks.  The first time a provider is
	 * seen we materialize its preset into concrete disabled families/models; from
	 * there the user can override individual choices in the filter screen. */
	function materializePresetTemplateForProvider(provider: string | undefined, models: Model<Api>[]): void {
		if (!provider || models.length === 0) return;
		const providerFilters = getProviderFilterConfig(config.filters, provider);
		if (!providerFilters.preset || providerFilters.preset === "none") return;
		if (providerFilters.disabledFamilies.length > 0 || providerFilters.disabledModels.length > 0) return;
		config.filters = applyBuiltInModelFilterPreset(config.filters, provider, models, providerFilters.preset);
	}

	async function saveSettings(scope: RouterSettingsScope, ctx: ExtensionContext) {
		saveConfigForScope(scope, ctx.cwd, config);
		enabled = config.enabled;
		persistEnabledState(enabled);
		resetCachedRoutingData();
		updateStatus(ctx);
	}

	async function openRouterSettings(ctx: ExtensionCommandContext): Promise<void> {
		if (!ctx.hasUI) {
			ctx.ui.notify("Router settings require interactive UI", "warning");
			return;
		}
		let scope: RouterSettingsScope = existsSync(getProjectConfigFile(ctx.cwd)) ? "project" : "global";
		let changed = false;

		await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
			const allTextModels = () => ctx.modelRegistry.getAll().filter((model) => model.input.includes("text"));
			const availableTextModels = () => ctx.modelRegistry.getAvailable().filter((model) => model.input.includes("text"));
			const availableProviders = () => listAvailableProviders(allTextModels());
			const authStatusLabel = (providerId: string) => {
				const status = ctx.modelRegistry.getProviderAuthStatus(providerId);
				if (status.source && status.label) return `${status.source}:${status.label}`;
				if (status.source) return status.source;
				return status.configured ? "configured" : "not detected";
			};
			const currentProviderLabel = () => {
				const value = ctx.model?.provider ? String(ctx.model.provider) : undefined;
				return value ? `${value}${ctx.model ? ` (${ctx.model.id})` : ""}` : "none selected";
			};
			const selectedRoutingProvider = () => {
				const providers = availableProviders();
				const configured = config.strategy.routingProvider?.trim();
				if (configured && providers.includes(configured)) return configured;
				return providers[0];
			};
			const routingProviderNow = () => resolveRoutingProvider(availableTextModels(), config);
			const getProviderModels = (providerId: string | undefined) => {
				if (!providerId) return [] as Model<Api>[];
				return allTextModels()
					.filter((model) => model.provider === providerId)
					.sort((a, b) => a.name.localeCompare(b.name));
			};
			const getEnabledProviderModels = (providerId: string | undefined) => applyModelFilters(getProviderModels(providerId), config.filters);
			const itemMap = new Map<string, SettingItem>();
			const allItems: SettingItem[] = [];
			const items: SettingItem[] = [];
			const addItem = (item: SettingItem) => {
				allItems.push(item);
				itemMap.set(item.id, item);
			};

			const selectSubmenu = (title: string, options: SelectItem[], currentValue: string | undefined) =>
				(_currentValue: string, submenuDone: (selectedValue?: string) => void): Component => {
					const container = new Container();
					container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
					const list = new SelectList(options, Math.min(options.length + 1, 12), getSelectListTheme());
					const index = currentValue ? options.findIndex((item) => item.value === currentValue) : -1;
					if (index >= 0) list.setSelectedIndex(index);
					list.onSelect = (item) => submenuDone(item.value);
					list.onCancel = () => submenuDone(undefined);
					container.addChild(list);
					container.addChild(new Text(theme.fg("dim", "↑↓ navigate • Enter select • Esc back"), 1, 0));
					return {
						render(width: number) {
							return container.render(width);
						},
						invalidate() {
							container.invalidate();
						},
						handleInput(data: string) {
							list.handleInput(data);
							tui.requestRender();
						},
					};
				};

			const inputSubmenu = (title: string, helper: string, currentValue: string) =>
				(_currentValue: string, submenuDone: (selectedValue?: string) => void): Component => {
					const container = new Container();
					const input = new Input();
					input.setValue(currentValue);
					input.onSubmit = (value) => submenuDone(value.trim());
					input.onEscape = () => submenuDone(undefined);
					container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
					container.addChild(new Text(theme.fg("muted", helper), 1, 0));
					container.addChild(new Text("", 0, 0));
					container.addChild(input);
					container.addChild(new Text(theme.fg("dim", "Enter save • Esc back"), 1, 0));
					return {
						render(width: number) {
							return container.render(width);
						},
						invalidate() {
							container.invalidate();
						},
						handleInput(data: string) {
							input.handleInput(data);
							tui.requestRender();
						},
					};
				};

			const rebuildVisibleItems = () => {
				const essentialIds = new Set([
					"general.enabled",
					"general.save-target",
					"general.advanced-settings",
					"routing.provider",
					"routing.objective",
					"routing.auto-accept",
					"filters.routing-preset",
					"filters.models",
				]);
				const nextItems = config.ui.showAdvancedSettings ? allItems : allItems.filter((item) => essentialIds.has(item.id));
				items.splice(0, items.length, ...nextItems);
			};

			const buildDescriptions = () => ({
				generalEnabled: "Master switch for automatic routing before each turn. Default is off; enable only when you want StarRouter to choose.",
				advancedSettings: "Show scoring thresholds. Keep this off for the clean V1 surface; turn it on when validating a release.",
				saveTarget: "Where settings are persisted. Project writes .pi/model-router.json in this repo; global affects every repo.",
				autoAcceptRouting: "When off, StarRouter asks before switching model. This is the recommended V1 posture because it keeps the user in control.",
				routingProvider: "Provider used as the routing pool. StarRouter compares models only inside this provider so decisions remain understandable.",
				filterPreset: "Apply a built-in or saved filter template. Presets are templates: after applying one, you can still edit families/models.",
				modelFilters: "Open the provider filter view. Use it sparingly in V1: the benchmark-safe preset is usually enough.",
				objective: "How the final route balances fit, cost, and speed. Balanced is the public default; other objectives are for explicit user intent.",
				qualityFloor: "Reject cheap candidates that fall too far below the best benchmark fit. Example: 0.88 keeps routes within 88% of the best fit.",
				preferCurrent: "Stay on the current route if the winner is only slightly better. Example: 0.04 avoids model flapping.",
				minAaMatch: "Minimum alias/identity match score between a Pi model and an Artificial Analysis row. Raise it if mappings feel suspicious.",
				minConfidence: "Minimum route confidence when no current route can be kept. Low-confidence routes abstain instead of forcing a switch.",
			});

			function refreshItemValues() {
				const providers = availableProviders();
				const availableNow = listAvailableProviders(availableTextModels());
				const routingProviderSelected = selectedRoutingProvider();
				materializePresetTemplateForProvider(routingProviderSelected, getProviderModels(routingProviderSelected));
				const routingFilterConfig = getProviderFilterConfig(config.filters, routingProviderSelected);
				const routingPreset = routingFilterConfig.preset ?? "none";
				const savedPresets = loadSavedModelFilterPresets(getFilterPresetDirForScope(scope, ctx.cwd));
				const descriptions = buildDescriptions();
				const providerOptions = providers.map((providerId) => ({
					value: providerId,
					label: providerId,
					description: `${buildProviderFilterSummary(providerId, getProviderModels(providerId), config.filters)} · ${availableNow.includes(providerId) ? "available now" : "not available now"} · ${authStatusLabel(providerId)}`,
				}));
				const set = (id: string, currentValue: string, description?: string, submenu?: SettingItem["submenu"], values?: string[]) => {
					const item = itemMap.get(id);
					if (!item) return;
					item.currentValue = currentValue;
					if (description !== undefined) item.description = description;
					item.submenu = submenu;
					item.values = values;
				};
				set("general.enabled", config.enabled ? "on" : "off", descriptions.generalEnabled, undefined, ["on", "off"]);
				set("general.advanced-settings", config.ui.showAdvancedSettings ? "on" : "off", descriptions.advancedSettings, undefined, ["on", "off"]);
				set("routing.auto-accept", config.ui.autoAcceptRouting ? "on" : "off", descriptions.autoAcceptRouting, undefined, ["on", "off"]);
				set(
					"general.save-target",
					scope,
					`${descriptions.saveTarget}\nCurrent file: ${getConfigFileForScope(scope, ctx.cwd)}`,
					selectSubmenu(
						"Save target",
						[
							{ value: "global", label: "global", description: GLOBAL_CONFIG_FILE },
							{ value: "project", label: "project", description: getProjectConfigFile(ctx.cwd) },
						],
						scope,
					),
				);
				set(
					"routing.provider",
					routingProviderSelected ?? "(none available)",
					`${descriptions.routingProvider}\nConfigured: ${config.strategy.routingProvider ?? "auto"}\nSelected: ${routingProviderSelected ?? "none"}\nAvailable now: ${routingProviderNow() ?? "none"}`,
					providerOptions.length > 0 ? selectSubmenu("Routing provider", providerOptions, routingProviderSelected) : undefined,
				);
				const routingPresetCurrentValue = routingFilterConfig.savedPresetId ? `saved:${routingFilterConfig.savedPresetId}` : `builtin:${routingPreset}`;
				const routingPresetLabel = routingFilterConfig.savedPresetName
					? `saved: ${routingFilterConfig.savedPresetName}`
					: `${getModelFilterPreset(routingPreset).label} (${routingPreset})`;
				set(
					"filters.routing-preset",
					routingProviderSelected ? `${routingPresetLabel} · ${savedPresets.length} saved` : "select routing provider first",
					`${descriptions.filterPreset}\nRouting provider: ${routingProviderSelected ?? "none"}\nPreset folder: ${getFilterPresetDirForScope(scope, ctx.cwd)}\nLast applied built-in: ${getModelFilterPreset(routingPreset).description}`,
					routingProviderSelected
						? selectSubmenu(
								`Apply filter preset for ${routingProviderSelected}`,
								[
									...MODEL_FILTER_PRESET_IDS.map((presetId) => ({ value: `builtin:${presetId}`, label: getModelFilterPreset(presetId).label, description: getModelFilterPreset(presetId).description })),
									...savedPresets.map((preset) => ({ value: `saved:${preset.id}`, label: `saved: ${preset.name}`, description: `Saved ${preset.updatedAt} · applies full filter snapshot` })),
								],
								routingPresetCurrentValue,
							)
						: undefined,
				);
				set(
					"filters.models",
					routingProviderSelected ? `${getEnabledProviderModels(routingProviderSelected).length}/${getProviderModels(routingProviderSelected).length} models on` : "select routing provider first",
					descriptions.modelFilters,
					routingProviderSelected
						? (_currentValue: string, submenuDone: (selectedValue?: string) => void) =>
							createModelFiltersScreen(
								tui,
								theme,
								keybindings,
								[{ id: "routing", label: "Routing", provider: routingProviderSelected, models: getProviderModels(routingProviderSelected) }],
								config.filters,
								(nextFilters) => submenuDone(JSON.stringify(nextFilters)),
								{
									onSavePreset: (name, nextFilters) => {
										const saved = saveModelFilterPreset(getFilterPresetDirForScope(scope, ctx.cwd), name, nextFilters);
										ctx.ui.notify(`Saved filter preset “${saved.name}”`, "info");
									},
								},
							)
						: undefined,
				);
				set(
					"routing.objective",
					config.strategy.objective,
					descriptions.objective,
					selectSubmenu(
						"Routing objective",
						[
							{ value: "balanced", label: "balanced", description: "Default fit/cost/speed trade-off" },
							{ value: "quality", label: "quality", description: "Push benchmark fit upward" },
							{ value: "cheapest", label: "cheapest", description: "Bias toward lower cost after hard constraints" },
							{ value: "fastest", label: "fastest", description: "Bias toward latency and throughput" },
						],
						config.strategy.objective,
					),
				);
				set("routing.quality-floor", config.strategy.qualityFloor.toFixed(2), descriptions.qualityFloor, inputSubmenu("Quality floor", "Range 0.30 - 0.99", config.strategy.qualityFloor.toFixed(2)));
				set("routing.prefer-current", config.strategy.preferCurrentWithin.toFixed(2), descriptions.preferCurrent, inputSubmenu("Prefer current within", "Range 0.00 - 0.50", config.strategy.preferCurrentWithin.toFixed(2)));
				set("routing.min-aa-match", config.strategy.minAaMatch.toFixed(2), descriptions.minAaMatch, inputSubmenu("Min AA match", "Range 0.00 - 1.20", config.strategy.minAaMatch.toFixed(2)));
				set("routing.min-confidence", config.strategy.minRouteConfidence.toFixed(2), descriptions.minConfidence, inputSubmenu("Min confidence", "Range 0.00 - 1.00", config.strategy.minRouteConfidence.toFixed(2)));
				rebuildVisibleItems();
			}

			addItem({ id: "general.enabled", label: "General › Enabled", currentValue: "" });
			addItem({ id: "general.advanced-settings", label: "General › Advanced settings", currentValue: "" });
			addItem({ id: "general.save-target", label: "General › Save target", currentValue: "" });
			addItem({ id: "routing.provider", label: "Routing › Provider", currentValue: "" });
			addItem({ id: "routing.objective", label: "Routing › Objective", currentValue: "" });
			addItem({ id: "routing.auto-accept", label: "Routing › Auto accept", currentValue: "" });
			addItem({ id: "filters.routing-preset", label: "Filters › Routing preset", currentValue: "" });
			addItem({ id: "filters.models", label: "Filters › Models", currentValue: "" });
			addItem({ id: "routing.quality-floor", label: "Routing › Quality floor", currentValue: "" });
			addItem({ id: "routing.prefer-current", label: "Routing › Prefer current", currentValue: "" });
			addItem({ id: "routing.min-aa-match", label: "Routing › Min AA match", currentValue: "" });
			addItem({ id: "routing.min-confidence", label: "Routing › Min confidence", currentValue: "" });
			refreshItemValues();

			const applyChange = (id: string, rawValue: string) => {
				switch (id) {
					case "general.enabled":
						config.enabled = rawValue === "on";
						break;
					case "general.advanced-settings":
						config.ui.showAdvancedSettings = rawValue === "on";
						break;
					case "routing.auto-accept":
						config.ui.autoAcceptRouting = rawValue === "on";
						break;
					case "general.save-target":
						scope = rawValue as RouterSettingsScope;
						break;
					case "routing.provider":
						config.strategy.routingProvider = rawValue;
						break;
					case "filters.routing-preset": {
						const provider = selectedRoutingProvider();
						if (!provider) break;
						if (rawValue.startsWith("builtin:")) {
							const presetId = rawValue.slice("builtin:".length) as ModelFilterPresetId;
							config.filters = applyBuiltInModelFilterPreset(config.filters, provider, getProviderModels(provider), presetId);
						} else if (rawValue.startsWith("saved:")) {
							const presetId = rawValue.slice("saved:".length);
							const saved = loadSavedModelFilterPresets(getFilterPresetDirForScope(scope, ctx.cwd)).find((preset) => preset.id === presetId);
							if (saved) config.filters = normalizeModelFilters(saved.filters);
						}
						break;
					}
					case "filters.models":
						try {
							config.filters = normalizeModelFilters(JSON.parse(rawValue) as RouterModelFilters);
						} catch {
							ctx.ui.notify("Failed to parse model filters", "warning");
						}
						break;
					case "routing.objective":
						config.strategy.objective = rawValue as RouteObjective;
						break;
					case "routing.quality-floor": {
						const value = Number(rawValue);
						if (Number.isFinite(value)) config.strategy.qualityFloor = clamp(value, 0.3, 0.99);
						break;
					}
					case "routing.prefer-current": {
						const value = Number(rawValue);
						if (Number.isFinite(value)) config.strategy.preferCurrentWithin = clamp(value, 0, 0.5);
						break;
					}
					case "routing.min-aa-match": {
						const value = Number(rawValue);
						if (Number.isFinite(value)) config.strategy.minAaMatch = clamp(value, 0, 1.2);
						break;
					}
					case "routing.min-confidence": {
						const value = Number(rawValue);
						if (Number.isFinite(value)) config.strategy.minRouteConfidence = clamp(value, 0, 1);
						break;
					}
				}
				changed = true;
				refreshItemValues();
				void saveSettings(scope, ctx).catch((error) => {
					ctx.ui.notify(`Failed to save router settings: ${String(error)}`, "warning");
				});
			};

			const settingsVisibleRows = Math.max(12, Math.min(items.length + 2, tui.terminal.rows - 13));
			return createSettingsScreen(tui, theme, keybindings, {
				title: "StarRouter Settings",
				subtitleLines: [
					`Current model: ${currentProviderLabel()}`,
					`Routing provider: ${selectedRoutingProvider() ?? "none"} (now ${routingProviderNow() ?? "none"})`,
					`Target file: ${getConfigFileForScope(scope, ctx.cwd)}`,
				],
				items,
				onChange: applyChange,
				onClose: () => done(),
				maxVisible: settingsVisibleRows,
				enableSearch: true,
				collapsedSections: [],
			});
		});

		if (changed) ctx.ui.notify(`Router settings saved to ${getConfigFileForScope(scope, ctx.cwd)}`, "info");
	}

	pi.registerCommand("router", {
		description: "StarRouter model router: /router status|on|off|refresh|settings",
		handler: async (args, ctx) => {
			const input = (args ?? "status").trim();
			const [command] = input.split(/\s+/);
			switch ((command || "status").toLowerCase()) {
				case "settings":
					await openRouterSettings(ctx);
					return;
				case "on":
					enabled = true;
					config.enabled = true;
					persistEnabledState(true);
					updateStatus(ctx);
					ctx.ui.notify("StarRouter enabled", "info");
					return;
				case "off":
					enabled = false;
					config.enabled = false;
					persistEnabledState(false);
					updateStatus(ctx);
					ctx.ui.notify("StarRouter disabled", "warning");
					return;
				case "refresh":
					await ensureDataset(true);
					ctx.ui.notify("StarRouter dataset cache refreshed", "info");
					return;
				case "status":
				default:
					ctx.ui.notify(lastDecision ? `Router status → ${summarizeDecision(lastDecision)}` : `Router status → ${enabled ? "enabled" : "disabled"}`, "info");
					return;
			}
		},
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("aa-router", undefined);
		ctx.ui.setWidget("aa-router-decision", undefined);
	});

	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig(ctx.cwd);
		restoreStateFromActiveBranch(ctx);
		updateStatus(ctx);
		if (enabled) {
			void ensureDataset(false).catch((error) => {
				console.error("[star-router] Warm cache failed:", error);
			});
		}
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreStateFromActiveBranch(ctx);
		updateStatus(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!enabled) return;
		if (isContextDependentFollowUp(event.prompt)) return;
		const trimmedPrompt = event.prompt.trim();
		if (!trimmedPrompt) return;
		const hasImages = Array.isArray(event.images) && event.images.length > 0;

		const dataset = await ensureDataset(false);
		const stats = datasetStats ?? buildStats(dataset.models);
		const profile = await inferPromptProfile(config, trimmedPrompt, hasImages, ctx);
		const availableModels = ctx.modelRegistry.getAvailable().filter((model) => model.input.includes("text"));
		const routingProvider = resolveRoutingProvider(availableModels, config);
		materializePresetTemplateForProvider(routingProvider, availableModels.filter((model) => model.provider === routingProvider));
		const scoped = getProviderScopedModels(availableModels, ctx.model, config);
		const currentThinkingLevel = pi.getThinkingLevel();
		const selection = chooseRoute(scoped.models, dataset.models, stats, profile, config, ctx.model, currentThinkingLevel, hasImages);
		if (!selection) return;

		const tentativeDecision = buildDecisionSummary({
			best: selection.best,
			topCandidates: selection.topCandidates,
			profile,
			providerScopeMode: scoped.providerScopeMode,
			providerScopeLabel: scoped.providerScopeLabel,
			availableModelCount: scoped.availableModelCount,
			availableRouteCount: scoped.availableRouteCount,
			dataSourceLabel: dataset.sourceLabel,
			objectiveUsed: config.strategy.objective,
			changedModel: currentModelKey(ctx.model) !== currentModelKey(selection.best.piModel),
			changedThinkingLevel: currentThinkingLevel !== selection.best.candidateThinkingLevel,
			actualThinkingLevel: selection.best.candidateThinkingLevel,
		});

		let selected: Candidate | undefined = selection.best;
		if (!config.ui.autoAcceptRouting) {
			selected = await openRouteChoice(ctx, {
				decision: tentativeDecision,
				candidates: selection.topCandidates,
				currentModel: ctx.model,
				currentThinkingLevel,
			});
			if (!selected) {
				ctx.ui.notify("Router kept current model", "info");
				return;
			}
		}

		const currentKey = currentModelKey(ctx.model);
		const nextKey = currentModelKey(selected.piModel);
		const changedModel = currentKey !== nextKey;
		if (changedModel) {
			const ok = await pi.setModel(selected.piModel);
			if (!ok) {
				ctx.ui.notify(`Router failed to select ${selected.piModel.provider}/${selected.piModel.id}`, "warning");
				return;
			}
		}
		pi.setThinkingLevel(selected.candidateThinkingLevel);
		const actualThinkingLevel = pi.getThinkingLevel();
		const changedThinkingLevel = currentThinkingLevel !== actualThinkingLevel;

		lastDecision = buildDecisionSummary({
			best: selected,
			topCandidates: selection.topCandidates,
			profile,
			providerScopeMode: scoped.providerScopeMode,
			providerScopeLabel: scoped.providerScopeLabel,
			availableModelCount: scoped.availableModelCount,
			availableRouteCount: scoped.availableRouteCount,
			dataSourceLabel: dataset.sourceLabel,
			objectiveUsed: config.strategy.objective,
			changedModel,
			changedThinkingLevel,
			actualThinkingLevel,
		});
		persistDecision(lastDecision);
		ctx.ui.setWidget("aa-router-decision", createRouteDecisionWidget(lastDecision), { placement: "aboveEditor" });
		updateStatus(ctx);
		if (changedModel || changedThinkingLevel) ctx.ui.notify(`Router → ${selected.piModel.provider}/${selected.piModel.id} @ ${actualThinkingLevel}`, "info");
	});
}
