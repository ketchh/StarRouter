import type { Api, Model } from "@earendil-works/pi-ai";
import { keyHint, keyText, type Theme } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, matchesKey, truncateToWidth, visibleWidth, type Component, type Focusable, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { getModelFilterPreset, normalizeModelFilterPreset, type ModelFilterPresetId } from "./filter-presets/index.ts";
import { UNSAFE_OBJECT_KEYS } from "./safe-json-file.ts";
import { renderEditableValue } from "./ui-text.ts";

export const MAX_FILTER_PROVIDERS = 128;
export const MAX_FILTER_VALUES_PER_COLLECTION = 512;
export const MAX_FILTER_IDENTIFIER_LENGTH = 256;

export interface ProviderModelFilterConfig {
	preset?: ModelFilterPresetId;
	savedPresetId?: string;
	savedPresetName?: string;
	disabledFamilies: string[];
	disabledModels: string[];
}

export interface RouterModelFilters {
	providers: Record<string, ProviderModelFilterConfig>;
}

export interface ModelFamilyInfo {
	key: string;
	label: string;
}

export interface ModelFilterTabSpec {
	id: string;
	label: string;
	provider: string;
	models: Model<Api>[];
}

export interface ModelFiltersScreenOptions {
	onSavePreset?: (name: string, filters: RouterModelFilters) => void;
}

type FamilyStatus = "on" | "off" | "partial";

type FamilyEntry = {
	type: "family";
	familyKey: string;
	familyLabel: string;
	modelIds: string[];
	modelCount: number;
	enabledCount: number;
	status: FamilyStatus;
	expanded: boolean;
	visibleModelCount: number;
};

type ModelEntry = {
	type: "model";
	familyKey: string;
	familyLabel: string;
	modelId: string;
	modelName: string;
	effectiveEnabled: boolean;
	familyEnabled: boolean;
	selfDisabled: boolean;
	modelIds: string[];
};

type FilterEntry = FamilyEntry | ModelEntry;

function decodePrintableInput(data: string): string | undefined {
	const kitty = decodeKittyPrintable(data);
	if (kitty !== undefined) return kitty;
	if (data.length === 1) {
		const code = data.charCodeAt(0);
		if (code >= 32 && code !== 127) return data;
	}
	return undefined;
}

function titleCase(value: string): string {
	return value
		.split(/[\s_-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function providerAndCoreModelId(model: Pick<Model<Api>, "id">): { vendor?: string; coreId: string } {
	const raw = model.id.replace(/^~/, "");
	if (!raw.includes("/")) return { coreId: raw };
	const [vendor, ...rest] = raw.split("/");
	return { vendor, coreId: rest.join("/") || raw };
}

function classifyKnownFamily(coreId: string): ModelFamilyInfo | undefined {
	const id = coreId.toLowerCase();
	let match = id.match(/^claude-(haiku|sonnet|opus)/);
	if (match) return { key: `claude-${match[1]}`, label: `Claude ${titleCase(match[1]!)}` };
	match = id.match(/^gemini(?:-[\d.]+)?-(flash|pro|lite)/);
	if (match) return { key: `gemini-${match[1]}`, label: `Gemini ${titleCase(match[1]!)}` };
	if (/^gpt-5(?:[.-]\d+)?-codex/.test(id)) return { key: "gpt-5-codex", label: "GPT-5 Codex" };
	if (/^gpt-5/.test(id)) return { key: "gpt-5", label: "GPT-5" };
	if (/^gpt-4o/.test(id)) return { key: "gpt-4o", label: "GPT-4o" };
	if (/^gpt-4\.1/.test(id)) return { key: "gpt-4.1", label: "GPT-4.1" };
	if (/^o[134]/.test(id)) return { key: "openai-o-series", label: "OpenAI o-series" };
	if (/^grok-code/.test(id)) return { key: "grok-code", label: "Grok Code" };
	if (/^grok/.test(id)) return { key: "grok", label: "Grok" };
	if (/^deepseek/.test(id)) return { key: "deepseek", label: "DeepSeek" };
	if (/^qwen/.test(id)) return { key: "qwen", label: "Qwen" };
	if (/^(codestral|devstral|ministral|mistral|mixtral|pixtral|voxtral)/.test(id)) return { key: "mistral", label: "Mistral" };
	if (/^kimi/.test(id)) return { key: "kimi", label: "Kimi" };
	if (/^llama/.test(id)) return { key: "llama", label: "Llama" };
	if (/^gemma/.test(id)) return { key: "gemma", label: "Gemma" };
	if (/^nova/.test(id)) return { key: "nova", label: "Nova" };
	if (/^jamba/.test(id)) return { key: "jamba", label: "Jamba" };
	if (/^glm/.test(id)) return { key: "glm", label: "GLM" };
	if (/^openrouter\/auto$/.test(id) || /^auto$/.test(id)) return { key: "auto", label: "Auto" };
	return undefined;
}

export function inferModelFamily(model: Pick<Model<Api>, "id" | "provider">): ModelFamilyInfo {
	const { vendor, coreId } = providerAndCoreModelId(model);
	const known = classifyKnownFamily(coreId);
	if (known) return known;
	const firstToken = coreId.split(/[.:/_-]+/).filter(Boolean)[0] ?? coreId;
	const vendorPrefix = vendor ? `${titleCase(vendor)} ` : "";
	return {
		key: `${vendor ?? model.provider}:${firstToken.toLowerCase()}`,
		label: `${vendorPrefix}${titleCase(firstToken)}`.trim(),
	};
}

function boundedFilterString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 && trimmed.length <= MAX_FILTER_IDENTIFIER_LENGTH ? trimmed : undefined;
}

function boundedUniqueFilterStrings(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const unique = new Set<string>();
	const examined = Math.min(value.length, MAX_FILTER_VALUES_PER_COLLECTION);
	for (let index = 0; index < examined; index += 1) {
		const item = boundedFilterString(value[index]);
		if (item) unique.add(item);
	}
	return [...unique].sort();
}

export function normalizeModelFilters(filters: Partial<RouterModelFilters> | undefined): RouterModelFilters {
	const providers: Record<string, ProviderModelFilterConfig> = {};
	const rawProviders: unknown = filters?.providers;
	if (!rawProviders || typeof rawProviders !== "object" || Array.isArray(rawProviders)) return { providers };
	let examinedProviders = 0;
	for (const [provider, rawValue] of Object.entries(rawProviders)) {
		if (examinedProviders >= MAX_FILTER_PROVIDERS) break;
		examinedProviders += 1;
		if (UNSAFE_OBJECT_KEYS.has(provider) || provider.length === 0 || provider.length > MAX_FILTER_IDENTIFIER_LENGTH) continue;
		const value = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
			? rawValue as Partial<ProviderModelFilterConfig>
			: {};
		providers[provider] = {
			preset: normalizeModelFilterPreset(value.preset),
			savedPresetId: boundedFilterString(value.savedPresetId),
			savedPresetName: boundedFilterString(value.savedPresetName),
			disabledFamilies: boundedUniqueFilterStrings(value.disabledFamilies),
			disabledModels: boundedUniqueFilterStrings(value.disabledModels),
		};
	}
	return { providers };
}

function cloneFilters(filters: RouterModelFilters): RouterModelFilters {
	return normalizeModelFilters(JSON.parse(JSON.stringify(filters)) as RouterModelFilters);
}

export function getProviderFilterConfig(filters: RouterModelFilters | undefined, provider: string | undefined): ProviderModelFilterConfig {
	if (!provider) return { preset: "none", disabledFamilies: [], disabledModels: [] };
	const normalized = normalizeModelFilters(filters);
	return normalized.providers[provider] ?? { preset: "none", disabledFamilies: [], disabledModels: [] };
}

function ensureProviderFilterConfig(filters: RouterModelFilters, provider: string): ProviderModelFilterConfig {
	filters.providers[provider] = filters.providers[provider] ?? { preset: "none", disabledFamilies: [], disabledModels: [] };
	return filters.providers[provider]!;
}

function clearPresetMarkers(providerFilters: ProviderModelFilterConfig): void {
	providerFilters.preset = "none";
	delete providerFilters.savedPresetId;
	delete providerFilters.savedPresetName;
}

export function setProviderFilterPreset(filters: RouterModelFilters, provider: string, preset: ModelFilterPresetId): void {
	const providerFilters = ensureProviderFilterConfig(filters, provider);
	providerFilters.preset = normalizeModelFilterPreset(preset);
	delete providerFilters.savedPresetId;
	delete providerFilters.savedPresetName;
}

export function setProviderSavedFilterPreset(filters: RouterModelFilters, provider: string, presetId: string, presetName: string): void {
	const providerFilters = ensureProviderFilterConfig(filters, provider);
	providerFilters.preset = "none";
	providerFilters.savedPresetId = presetId;
	providerFilters.savedPresetName = presetName;
}

export function isModelAllowedByPreset(presetId: ModelFilterPresetId | undefined, model: Pick<Model<Api>, "provider" | "id">): boolean {
	const preset = getModelFilterPreset(presetId);
	if (preset.allowedFamilies && !preset.allowedFamilies.includes(inferModelFamily(model).key)) return false;
	if (preset.blockedModelPatterns?.some((pattern) => pattern.test(model.id))) return false;
	return true;
}

export function applyBuiltInModelFilterPreset(filters: RouterModelFilters, provider: string, models: Model<Api>[], presetId: ModelFilterPresetId): RouterModelFilters {
	const next = cloneFilters(filters);
	const providerFilters = ensureProviderFilterConfig(next, provider);
	providerFilters.preset = normalizeModelFilterPreset(presetId);
	delete providerFilters.savedPresetId;
	delete providerFilters.savedPresetName;
	if (providerFilters.preset === "none") {
		providerFilters.disabledFamilies = [];
		providerFilters.disabledModels = [];
		return next;
	}
	const preset = getModelFilterPreset(providerFilters.preset);
	const allFamilyKeys = [...new Set(models.map((model) => inferModelFamily(model).key))].sort();
	providerFilters.disabledFamilies = preset.allowedFamilies
		? allFamilyKeys.filter((familyKey) => !preset.allowedFamilies?.includes(familyKey))
		: [];
	providerFilters.disabledModels = models
		.filter((model) => preset.blockedModelPatterns?.some((pattern) => pattern.test(model.id)))
		.map((model) => model.id)
		.sort();
	return next;
}

export function isModelEnabledByFilters(filters: RouterModelFilters | undefined, model: Pick<Model<Api>, "provider" | "id">): boolean {
	const providerFilters = getProviderFilterConfig(filters, String(model.provider));
	const family = inferModelFamily(model);
	if (providerFilters.disabledFamilies.includes(family.key)) return false;
	if (providerFilters.disabledModels.includes(model.id)) return false;
	return true;
}

export function applyModelFilters(models: Model<Api>[], filters: RouterModelFilters | undefined): Model<Api>[] {
	return models.filter((model) => isModelEnabledByFilters(filters, model));
}

export function buildProviderFilterSummary(provider: string | undefined, models: Model<Api>[], filters: RouterModelFilters | undefined): string {
	if (!provider) return "no provider";
	if (models.length === 0) return `${provider}: no text models`;
	const providerFilters = getProviderFilterConfig(filters, provider);
	const preset = getModelFilterPreset(providerFilters.preset);
	const enabledModels = applyModelFilters(models, filters);
	const totalFamilies = new Set(models.map((model) => inferModelFamily(model).key));
	const enabledFamilies = new Set(enabledModels.map((model) => inferModelFamily(model).key));
	const savedLabel = providerFilters.savedPresetName ? `saved:${providerFilters.savedPresetName}` : undefined;
	const presetLabel = savedLabel ?? (preset.id === "none" ? "custom" : preset.id);
	return `${provider}: ${enabledModels.length}/${models.length} models on · ${enabledFamilies.size}/${totalFamilies.size} families on · template ${presetLabel}`;
}

function removeValue(values: string[], target: string): string[] {
	return values.filter((value) => value !== target);
}

function toggleValue(values: string[], target: string, nextEnabled: boolean): string[] {
	return nextEnabled ? removeValue(values, target) : [...new Set([...values, target])].sort();
}

function toggleFamily(filters: RouterModelFilters, provider: string, familyKey: string, modelIds: string[], nextEnabled: boolean): void {
	const providerFilters = ensureProviderFilterConfig(filters, provider);
	clearPresetMarkers(providerFilters);
	providerFilters.disabledFamilies = toggleValue(providerFilters.disabledFamilies, familyKey, nextEnabled);
	if (nextEnabled) {
		providerFilters.disabledModels = providerFilters.disabledModels.filter((modelId) => !modelIds.includes(modelId));
	}
}

export function setModelFilterEnabled(
	filters: RouterModelFilters,
	provider: string,
	familyKey: string,
	modelId: string,
	familyModelIds: string[],
	nextEnabled: boolean,
): void {
	const providerFilters = ensureProviderFilterConfig(filters, provider);
	clearPresetMarkers(providerFilters);
	if (!nextEnabled) {
		providerFilters.disabledModels = toggleValue(providerFilters.disabledModels, modelId, false);
		return;
	}
	const familyWasDisabled = providerFilters.disabledFamilies.includes(familyKey);
	providerFilters.disabledFamilies = removeValue(providerFilters.disabledFamilies, familyKey);
	providerFilters.disabledModels = removeValue(providerFilters.disabledModels, modelId);
	if (familyWasDisabled) {
		providerFilters.disabledModels = [
			...new Set([
				...providerFilters.disabledModels,
				...familyModelIds.filter((candidateModelId) => candidateModelId !== modelId),
			]),
		].sort();
	}
}

function toggleModel(filters: RouterModelFilters, provider: string, familyKey: string, modelId: string, familyModelIds: string[], nextEnabled: boolean): void {
	setModelFilterEnabled(filters, provider, familyKey, modelId, familyModelIds, nextEnabled);
}

function familyStatus(enabledCount: number, modelCount: number): FamilyStatus {
	if (enabledCount <= 0) return "off";
	if (enabledCount >= modelCount) return "on";
	return "partial";
}

function searchTextForModel(model: Model<Api>): string {
	const family = inferModelFamily(model);
	return `${family.label} ${model.id} ${model.name}`.toLowerCase();
}

function buildEntriesForTab(tab: ModelFilterTabSpec, filters: RouterModelFilters, searchQuery: string, collapsedFamilies: Set<string>): FilterEntry[] {
	const providerFilters = getProviderFilterConfig(filters, tab.provider);
	const grouped = new Map<string, { family: ModelFamilyInfo; models: Model<Api>[] }>();
	for (const model of [...tab.models].sort((a, b) => a.id.localeCompare(b.id))) {
		const family = inferModelFamily(model);
		const bucket = grouped.get(family.key) ?? { family, models: [] };
		bucket.models.push(model);
		grouped.set(family.key, bucket);
	}
	const query = searchQuery.trim().toLowerCase();
	const entries: FilterEntry[] = [];
	for (const bucket of [...grouped.values()].sort((a, b) => a.family.label.localeCompare(b.family.label) || a.family.key.localeCompare(b.family.key))) {
		const enabledCount = bucket.models.filter((model) => isModelEnabledByFilters(filters, model)).length;
		const status = familyStatus(enabledCount, bucket.models.length);
		const familyMatches = query.length === 0 || bucket.family.label.toLowerCase().includes(query) || bucket.family.key.toLowerCase().includes(query);
		const matchedModels = query.length === 0 ? bucket.models : bucket.models.filter((model) => searchTextForModel(model).includes(query));
		if (!familyMatches && matchedModels.length === 0) continue;
		const expanded = query.length > 0 ? true : !collapsedFamilies.has(bucket.family.key);
		const visibleModels = query.length === 0 ? bucket.models : familyMatches ? bucket.models : matchedModels;
		entries.push({
			type: "family",
			familyKey: bucket.family.key,
			familyLabel: bucket.family.label,
			modelIds: bucket.models.map((model) => model.id),
			modelCount: bucket.models.length,
			enabledCount,
			status,
			expanded,
			visibleModelCount: visibleModels.length,
		});
		if (!expanded) continue;
		for (const model of visibleModels.sort((a, b) => a.id.localeCompare(b.id))) {
			const familyEnabled = !providerFilters.disabledFamilies.includes(bucket.family.key);
			const selfDisabled = providerFilters.disabledModels.includes(model.id);
			entries.push({
				type: "model",
				familyKey: bucket.family.key,
				familyLabel: bucket.family.label,
				modelId: model.id,
				modelName: model.name,
				effectiveEnabled: familyEnabled && !selfDisabled,
				familyEnabled,
				selfDisabled,
				modelIds: bucket.models.map((candidate) => candidate.id),
			});
		}
	}
	return entries;
}

export class ModelFiltersScreen implements Component, Focusable {
	private filters: RouterModelFilters;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}
	private activeTabIndex = 0;
	private selectedIndexByTab = new Map<number, number>();
	private searchQueryByTab = new Map<number, string>();
	private collapsedFamiliesByTab = new Map<number, Set<string>>();
	private savingPresetName: string | undefined;
	private savePresetMessage: string | undefined;
	private readonly maxVisibleLimit = 16;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
		private readonly tabs: ModelFilterTabSpec[],
		filters: RouterModelFilters,
		private readonly done: (filters?: RouterModelFilters) => void,
		private readonly options: ModelFiltersScreenOptions = {},
	) {
		this.filters = cloneFilters(filters);
	}

	private get activeTab(): ModelFilterTabSpec | undefined {
		return this.tabs[this.activeTabIndex];
	}

	private getSearchQuery(tabIndex = this.activeTabIndex): string {
		return this.searchQueryByTab.get(tabIndex) ?? "";
	}

	private setSearchQuery(nextValue: string): void {
		this.searchQueryByTab.set(this.activeTabIndex, nextValue);
		this.setSelectedIndex(0);
	}

	private getCollapsedFamilies(tabIndex = this.activeTabIndex): Set<string> {
		const current = this.collapsedFamiliesByTab.get(tabIndex);
		if (current) return current;
		const created = new Set<string>();
		this.collapsedFamiliesByTab.set(tabIndex, created);
		return created;
	}

	private get activeEntries(): FilterEntry[] {
		const tab = this.activeTab;
		if (!tab) return [];
		return buildEntriesForTab(tab, this.filters, this.getSearchQuery(), this.getCollapsedFamilies());
	}

	private get selectedIndex(): number {
		const entries = this.activeEntries;
		if (entries.length === 0) return 0;
		const saved = this.selectedIndexByTab.get(this.activeTabIndex) ?? 0;
		return Math.max(0, Math.min(saved, entries.length - 1));
	}

	private setSelectedIndex(index: number): void {
		const entries = this.activeEntries;
		if (entries.length === 0) {
			this.selectedIndexByTab.set(this.activeTabIndex, 0);
			return;
		}
		this.selectedIndexByTab.set(this.activeTabIndex, Math.max(0, Math.min(index, entries.length - 1)));
	}

	private switchTab(delta: number): void {
		if (this.tabs.length <= 1) return;
		this.activeTabIndex = (this.activeTabIndex + delta + this.tabs.length) % this.tabs.length;
		this.setSelectedIndex(this.selectedIndexByTab.get(this.activeTabIndex) ?? 0);
	}

	private findFamilyEntry(familyKey: string): FamilyEntry | undefined {
		return this.activeEntries.find((entry): entry is FamilyEntry => entry.type === "family" && entry.familyKey === familyKey);
	}

	private toggleSelected(): void {
		const tab = this.activeTab;
		const entry = this.activeEntries[this.selectedIndex];
		if (!tab || !entry) return;
		if (entry.type === "family") {
			const nextEnabled = entry.status !== "on";
			toggleFamily(this.filters, tab.provider, entry.familyKey, entry.modelIds, nextEnabled);
			return;
		}
		const nextEnabled = !entry.effectiveEnabled;
		toggleModel(this.filters, tab.provider, entry.familyKey, entry.modelId, entry.modelIds, nextEnabled);
	}

	private collapseFamily(familyKey: string): void {
		this.getCollapsedFamilies().add(familyKey);
	}

	private expandFamily(familyKey: string): void {
		this.getCollapsedFamilies().delete(familyKey);
	}

	private collapseSelectedFamily(): void {
		const entry = this.activeEntries[this.selectedIndex];
		if (!entry) return;
		this.collapseFamily(entry.familyKey);
		const familyEntry = this.findFamilyEntry(entry.familyKey);
		if (!familyEntry) return;
		const familyIndex = this.activeEntries.findIndex((candidate) => candidate.type === "family" && candidate.familyKey === familyEntry.familyKey);
		if (familyIndex >= 0) this.setSelectedIndex(familyIndex);
	}

	private expandSelectedFamily(): void {
		const entry = this.activeEntries[this.selectedIndex];
		if (!entry) return;
		this.expandFamily(entry.familyKey);
	}

	private appendSearchCharacter(ch: string): void {
		if (!ch) return;
		this.setSearchQuery(this.getSearchQuery() + ch);
	}

	private popSearchCharacter(): void {
		const current = this.getSearchQuery();
		if (!current) return;
		this.setSearchQuery(current.slice(0, -1));
	}

	private clearSearch(): void {
		if (!this.getSearchQuery()) return;
		this.setSearchQuery("");
	}

	private startSavePreset(): void {
		if (!this.options.onSavePreset) {
			this.savePresetMessage = "Preset saving is not configured for this screen.";
			return;
		}
		this.savingPresetName = "";
		this.savePresetMessage = undefined;
	}

	private cancelSavePreset(): void {
		this.savingPresetName = undefined;
		this.savePresetMessage = undefined;
	}

	private confirmSavePreset(): void {
		if (this.savingPresetName === undefined) return;
		const name = this.savingPresetName.trim();
		if (!name) {
			this.savePresetMessage = "Type a preset name before pressing Enter.";
			return;
		}
		try {
			this.options.onSavePreset?.(name, cloneFilters(this.filters));
			this.savingPresetName = undefined;
			this.savePresetMessage = `Saved preset “${name}”. Changes are still a draft.`;
		} catch (error) {
			this.savePresetMessage = `Could not save preset: ${String(error)}`;
		}
	}

	private appendPresetNameCharacter(ch: string): void {
		if (this.savingPresetName === undefined || !ch) return;
		this.savingPresetName += ch;
		this.savePresetMessage = undefined;
	}

	private popPresetNameCharacter(): void {
		if (this.savingPresetName === undefined) return;
		this.savingPresetName = this.savingPresetName.slice(0, -1);
	}

	private effectiveMaxVisible(): number {
		const chromeRows = this.savePresetMessage && this.savingPresetName === undefined ? 13 : 12;
		return Math.max(1, Math.min(this.maxVisibleLimit, this.tui.terminal.rows - chromeRows));
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(this.theme.fg("accent", this.theme.bold("Model Filters")));
		const terminalBudget = Math.max(1, this.tui.terminal.rows - 2);
		if (terminalBudget <= 8) {
			const tab = this.activeTab;
			lines.push(tab ? this.renderTabs(width) : this.theme.fg("warning", "No routing provider."));
			if (this.savingPresetName !== undefined) {
				const prefix = "Preset: ";
				lines.push(this.theme.fg("accent", `${prefix}${renderEditableValue(this.savingPresetName, "(name)", Math.max(0, width - visibleWidth(prefix)), this.focused)}`));
				if (terminalBudget >= 6) lines.push(this.theme.fg("muted", this.savePresetMessage ?? "Name the draft preset."));
				while (lines.length < terminalBudget - 1) lines.push("");
				lines.push(this.theme.fg("dim", `${keyHint("tui.select.confirm", "save")} • ${keyHint("tui.select.cancel", "back")}`));
			} else {
				const entries = this.activeEntries;
				const selected = entries[this.selectedIndex];
				lines.push(selected ? this.renderEntry(selected, true, width) : this.theme.fg("warning", "No models match."));
				if (terminalBudget >= 6) lines.push(this.theme.fg("muted", truncateToWidth(this.describeSelectedEntry(), width, "", true)));
				while (lines.length < terminalBudget - 1) lines.push("");
				lines.push(this.theme.fg("dim", `Ctrl+S apply • ${keyHint("tui.select.cancel", "cancel")}`));
			}
			return lines.slice(0, terminalBudget).map((line) => truncateToWidth(line, width, "", true));
		}
		lines.push(this.renderTabs(width));
		if (this.savingPresetName !== undefined) {
			const prefix = "Save preset name: ";
			const name = renderEditableValue(
				this.savingPresetName,
				"(type name)",
				Math.max(0, width - visibleWidth(prefix)),
				this.focused,
			);
			lines.push(this.theme.fg("accent", `${prefix}${name}`));
			lines.push(this.theme.fg(this.savePresetMessage ? "warning" : "dim", this.savePresetMessage ?? `${keyHint("tui.select.confirm", "save preset")} • ${keyHint("tui.select.cancel", "back")}`));
		} else {
			const query = this.getSearchQuery();
			const prefix = "Search: ";
			const search = renderEditableValue(
				query,
				"(type to filter)",
				Math.max(0, width - visibleWidth(prefix)),
				this.focused,
			);
			lines.push(this.theme.fg(query ? "accent" : "dim", `${prefix}${search}`));
		}
		if (this.savePresetMessage && this.savingPresetName === undefined) {
			lines.push(this.theme.fg(this.savePresetMessage.startsWith("Saved preset") ? "success" : "warning", this.savePresetMessage));
		}
		const query = this.getSearchQuery();
		const tab = this.activeTab;
		if (!tab) {
			lines.push(this.theme.fg("warning", "No routing provider available for filtering."));
			lines.push("");
			lines.push(this.theme.fg("dim", `${keyHint("tui.select.cancel", "cancel")}`));
			return lines.map((line) => truncateToWidth(line, width));
		}
		lines.push(this.theme.fg("muted", buildProviderFilterSummary(tab.provider, tab.models, this.filters)));
		lines.push("");

		const entries = this.activeEntries;
		const maxVisible = this.effectiveMaxVisible();
		if (entries.length === 0) {
			lines.push(this.theme.fg("warning", query ? `No models match “${query}”.` : "No models found for this provider."));
			for (let i = 1; i < maxVisible; i += 1) lines.push("");
		} else {
			const selectedIndex = this.selectedIndex;
			const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), Math.max(0, entries.length - maxVisible)));
			const endIndex = Math.min(entries.length, startIndex + maxVisible);
			for (let i = startIndex; i < endIndex; i += 1) {
				lines.push(this.renderEntry(entries[i]!, i === selectedIndex, width));
			}
			for (let i = endIndex; i < startIndex + maxVisible; i += 1) lines.push("");
			lines.push(this.theme.fg("dim", `  (${selectedIndex + 1}/${entries.length})`));
		}

		lines.push("");
		lines.push(this.theme.fg("muted", this.describeSelectedEntry()));
		lines.push("");
		const navigation = `${keyText("tui.select.up")}/${keyText("tui.select.down")} navigate`;
		const primary = `Ctrl+S apply • ${keyHint("tui.select.cancel", "cancel")}`;
		const secondary = `${keyHint("tui.select.confirm", "toggle")} • ${navigation} • Tab switch • ←/→ fold • Ctrl+Shift+S preset`;
		const footer = visibleWidth(`${primary} • ${secondary}`) <= width ? `${primary} • ${secondary}` : primary;
		lines.push(this.theme.fg("dim", footer));
		const targetHeight = Math.max(1, this.tui.terminal.rows - 2);
		while (lines.length < targetHeight) lines.push("");
		if (lines.length > targetHeight) {
			const footer = lines.at(-1)!;
			return [...lines.slice(0, Math.max(0, targetHeight - 1)), footer].map((line) => truncateToWidth(line, width, "", true));
		}
		return lines.map((line) => truncateToWidth(line, width, "", true));
	}

	private renderTabs(width: number): string {
		const parts = this.tabs.map((tab, index) => {
			const text = ` ${tab.label} · ${tab.provider} `;
			return index === this.activeTabIndex ? this.theme.bg("selectedBg", this.theme.fg("text", text)) : this.theme.fg("dim", `[${text.trim()}]`);
		});
		return truncateToWidth(parts.join("  "), width);
	}

	private renderFamilyState(status: FamilyStatus): string {
		switch (status) {
			case "on":
				return this.theme.fg("success", "[on]");
			case "partial":
				return this.theme.fg("accent", "[mix]");
			case "off":
			default:
				return this.theme.fg("warning", "[off]");
		}
	}

	private renderEntry(entry: FilterEntry, selected: boolean, width: number): string {
		const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
		if (entry.type === "family") {
			const state = this.renderFamilyState(entry.status);
			const expandedMark = entry.expanded ? this.theme.fg("muted", "▾") : this.theme.fg("muted", "▸");
			const visibleSuffix = entry.visibleModelCount !== entry.modelCount ? ` · ${entry.visibleModelCount} shown` : "";
			const label = `${entry.familyLabel} · ${entry.enabledCount}/${entry.modelCount} models on${visibleSuffix}`;
			return truncateToWidth(`${prefix}${expandedMark} ${state} ${selected ? this.theme.bold(label) : label}`, width, "", true);
		}
		const checkbox = entry.effectiveEnabled ? this.theme.fg("success", "[on]") : this.theme.fg("warning", "[off]");
		const suffix = !entry.familyEnabled ? " (family off)" : entry.selfDisabled ? " (model off)" : "";
		const modelLabel = `${entry.modelId}${entry.modelName && entry.modelName !== entry.modelId ? ` · ${entry.modelName}` : ""}${suffix}`;
		return truncateToWidth(`${prefix}    ${checkbox} ${modelLabel}`, width, "", true);
	}

	private describeSelectedEntry(): string {
		const tab = this.activeTab;
		const entry = this.activeEntries[this.selectedIndex];
		if (!tab || !entry) return "No filter target selected.";
		if (entry.type === "family") {
			const action = entry.status === "on" ? "disable the entire family" : "enable the whole family";
			const expandHint = entry.expanded ? "Left collapses the family." : "Right expands the family.";
			return `Family ${entry.familyLabel} on ${tab.provider} is ${entry.status}. Toggle to ${action}. ${expandHint}`;
		}
		return `Model ${entry.modelId} in ${entry.familyLabel}. Toggle it for a granular override without touching the whole family.`;
	}

	handleInput(data: string): void {
		const kb = this.keybindings;
		if (this.savingPresetName !== undefined) {
			if (kb.matches(data, "tui.select.cancel")) {
				this.cancelSavePreset();
				return;
			}
			if (kb.matches(data, "tui.select.confirm") || data === "\r" || data === "\n") {
				this.confirmSavePreset();
				return;
			}
			if (matchesKey(data, "backspace")) {
				this.popPresetNameCharacter();
				return;
			}
			const printable = decodePrintableInput(data);
			if (printable && printable >= " " && printable !== "\u007f") this.appendPresetNameCharacter(printable);
			return;
		}
		const entries = this.activeEntries;
		if (matchesKey(data, "ctrl+shift+s")) {
			this.startSavePreset();
			return;
		}
		if (data === "\x13" || matchesKey(data, "ctrl+s")) {
			this.done(cloneFilters(this.filters));
			return;
		}
		if (kb.matches(data, "tui.select.cancel")) {
			this.done(undefined);
			return;
		}
		if (matchesKey(data, "tab")) {
			this.switchTab(1);
			return;
		}
		if (matchesKey(data, "shift+tab")) {
			this.switchTab(-1);
			return;
		}
		if (matchesKey(data, "left")) {
			this.collapseSelectedFamily();
			return;
		}
		if (matchesKey(data, "right")) {
			this.expandSelectedFamily();
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.popSearchCharacter();
			return;
		}
		if (matchesKey(data, "ctrl+l")) {
			this.clearSearch();
			return;
		}
		if (kb.matches(data, "tui.select.up")) {
			if (entries.length === 0) return;
			this.setSelectedIndex(this.selectedIndex === 0 ? entries.length - 1 : this.selectedIndex - 1);
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			if (entries.length === 0) return;
			this.setSelectedIndex(this.selectedIndex === entries.length - 1 ? 0 : this.selectedIndex + 1);
			return;
		}
		if (kb.matches(data, "tui.select.pageUp")) {
			this.setSelectedIndex(this.selectedIndex - this.effectiveMaxVisible());
			return;
		}
		if (kb.matches(data, "tui.select.pageDown")) {
			this.setSelectedIndex(this.selectedIndex + this.effectiveMaxVisible());
			return;
		}
		if (kb.matches(data, "tui.select.confirm") || data === " ") {
			this.toggleSelected();
			return;
		}
		const printable = decodePrintableInput(data);
		if (printable && printable >= " " && printable !== "\u007f") {
			this.appendSearchCharacter(printable);
		}
	}
}

export function createModelFiltersScreen(tui: TUI, theme: Theme, keybindings: KeybindingsManager, tabs: ModelFilterTabSpec[], filters: RouterModelFilters, done: (filters?: RouterModelFilters) => void, options: ModelFiltersScreenOptions = {}): Component & Focusable {
	return new ModelFiltersScreen(tui, theme, keybindings, tabs, filters, done, options);
}
