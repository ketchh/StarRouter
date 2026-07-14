import { keyHint, keyText, type Theme } from "@earendil-works/pi-coding-agent";
import {
	decodeKittyPrintable,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type Focusable,
	type KeybindingsManager,
	type SettingItem,
	type TUI,
} from "@earendil-works/pi-tui";
import { renderEditableValue } from "./ui-text.ts";

export interface SettingsScreenOptions {
	title: string;
	subtitleLines?: string[];
	items: SettingItem[];
	onChange: (id: string, newValue: string) => void;
	onSave: () => void;
	onClose: () => void;
	isDirty?: () => boolean;
	maxVisible?: number;
	enableSearch?: boolean;
	collapsedSections?: string[];
}

type SectionEntry = {
	type: "section";
	sectionKey: string;
	sectionLabel: string;
	itemCount: number;
	visibleItemCount: number;
	expanded: boolean;
};

type SettingEntry = {
	type: "setting";
	sectionKey: string;
	sectionLabel: string;
	leafLabel: string;
	item: SettingItem;
};

type Entry = SectionEntry | SettingEntry;

type SectionBucket = {
	key: string;
	label: string;
	items: SettingItem[];
};

function normalizeSectionKey(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function splitSettingLabel(label: string): { sectionLabel: string; leafLabel: string } {
	const parts = label.split("›").map((part) => part.trim()).filter(Boolean);
	if (parts.length <= 1) return { sectionLabel: "General", leafLabel: label.trim() };
	return {
		sectionLabel: parts[0]!,
		leafLabel: parts.slice(1).join(" › "),
	};
}

function searchTextForItem(item: SettingItem): string {
	return `${item.label} ${item.currentValue} ${item.description ?? ""}`.toLowerCase();
}

function buildSections(items: SettingItem[]): SectionBucket[] {
	const grouped = new Map<string, SectionBucket>();
	for (const item of items) {
		const { sectionLabel } = splitSettingLabel(item.label);
		const key = normalizeSectionKey(sectionLabel);
		const bucket = grouped.get(key) ?? { key, label: sectionLabel, items: [] };
		bucket.items.push(item);
		grouped.set(key, bucket);
	}
	return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function decodePrintableInput(data: string): string | undefined {
	const kitty = decodeKittyPrintable(data);
	if (kitty !== undefined) return kitty;
	if (data.length === 1) {
		const code = data.charCodeAt(0);
		if (code >= 32 && code !== 127) return data;
	}
	return undefined;
}

function buildEntries(items: SettingItem[], searchQuery: string, collapsedSections: Set<string>): Entry[] {
	const query = searchQuery.trim().toLowerCase();
	const sections = buildSections(items);
	const entries: Entry[] = [];
	for (const section of sections) {
		const sectionMatches = query.length === 0 || section.label.toLowerCase().includes(query);
		const matchedItems = query.length === 0 ? section.items : section.items.filter((item) => searchTextForItem(item).includes(query));
		if (!sectionMatches && matchedItems.length === 0) continue;
		const expanded = query.length > 0 ? true : !collapsedSections.has(section.key);
		const visibleItems = query.length === 0 ? section.items : sectionMatches ? section.items : matchedItems;
		entries.push({
			type: "section",
			sectionKey: section.key,
			sectionLabel: section.label,
			itemCount: section.items.length,
			visibleItemCount: visibleItems.length,
			expanded,
		});
		if (!expanded) continue;
		for (const item of visibleItems) {
			const { leafLabel } = splitSettingLabel(item.label);
			entries.push({
				type: "setting",
				sectionKey: section.key,
				sectionLabel: section.label,
				leafLabel,
				item,
			});
		}
	}
	return entries;
}

export class SettingsTreeScreen implements Component, Focusable {
	private searchQuery = "";
	private selectedIndex = 0;
	private submenuComponent: (Component & Partial<Focusable>) | undefined;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		if (this.submenuComponent && "focused" in this.submenuComponent) this.submenuComponent.focused = value;
	}
	private readonly collapsedSections = new Set<string>();
	private readonly maxVisible: number;
	private readonly descriptionMaxLines = 4;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
		private readonly options: SettingsScreenOptions,
	) {
		this.maxVisible = options.maxVisible ?? 16;
		for (const section of options.collapsedSections ?? []) {
			this.collapsedSections.add(normalizeSectionKey(section));
		}
	}

	private get entries(): Entry[] {
		return buildEntries(this.options.items, this.searchQuery, this.collapsedSections);
	}

	private get selectedEntry(): Entry | undefined {
		const entries = this.entries;
		if (entries.length === 0) return undefined;
		this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, entries.length - 1));
		return entries[this.selectedIndex];
	}

	private setSelectedIndex(index: number): void {
		const entries = this.entries;
		if (entries.length === 0) {
			this.selectedIndex = 0;
			return;
		}
		this.selectedIndex = Math.max(0, Math.min(index, entries.length - 1));
	}

	private cycleItemValue(item: SettingItem): void {
		if (!item.values || item.values.length === 0) return;
		const currentIndex = item.values.indexOf(item.currentValue);
		const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % item.values.length : 0;
		const nextValue = item.values[nextIndex]!;
		this.options.onChange(item.id, nextValue);
	}

	private activateSelected(): void {
		const selected = this.selectedEntry;
		if (!selected) return;
		if (selected.type === "section") {
			if (selected.expanded) this.collapsedSections.add(selected.sectionKey);
			else this.collapsedSections.delete(selected.sectionKey);
			return;
		}
		if (selected.item.submenu) {
			this.submenuComponent = selected.item.submenu(selected.item.currentValue, (selectedValue) => {
				this.submenuComponent = undefined;
				if (selectedValue !== undefined) {
					this.options.onChange(selected.item.id, selectedValue);
				}
				this.tui.requestRender();
			}) as Component & Partial<Focusable>;
			if ("focused" in this.submenuComponent) this.submenuComponent.focused = this.focused;
			return;
		}
		this.cycleItemValue(selected.item);
	}

	private collapseSelectedSection(): void {
		const selected = this.selectedEntry;
		if (!selected) return;
		if (selected.type === "section") {
			this.collapsedSections.add(selected.sectionKey);
			return;
		}
		this.collapsedSections.add(selected.sectionKey);
		const sectionIndex = this.entries.findIndex((entry) => entry.type === "section" && entry.sectionKey === selected.sectionKey);
		if (sectionIndex >= 0) this.setSelectedIndex(sectionIndex);
	}

	private expandSelectedSection(): void {
		const selected = this.selectedEntry;
		if (!selected) return;
		this.collapsedSections.delete(selected.sectionKey);
	}

	private appendSearchCharacter(ch: string): void {
		if (!this.options.enableSearch || !ch) return;
		this.searchQuery += ch;
		this.setSelectedIndex(0);
	}

	private popSearchCharacter(): void {
		if (!this.options.enableSearch || !this.searchQuery) return;
		this.searchQuery = this.searchQuery.slice(0, -1);
		this.setSelectedIndex(0);
	}

	private clearSearch(): void {
		if (!this.options.enableSearch || !this.searchQuery) return;
		this.searchQuery = "";
		this.setSelectedIndex(0);
	}

	private renderSectionEntry(entry: SectionEntry, selected: boolean): string {
		const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
		const expandedMark = entry.expanded ? this.theme.fg("muted", "▾") : this.theme.fg("muted", "▸");
		const countSuffix = entry.visibleItemCount !== entry.itemCount ? ` · ${entry.visibleItemCount} shown` : "";
		const text = `${entry.sectionLabel} · ${entry.itemCount} settings${countSuffix}`;
		return `${prefix}${expandedMark} ${selected ? this.theme.bold(text) : text}`;
	}

	private renderSettingEntry(entry: SettingEntry, selected: boolean): string {
		const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
		const marker = this.theme.fg("dim", "•");
		const leaf = selected ? this.theme.bold(entry.leafLabel) : entry.leafLabel;
		const value = this.theme.fg(selected ? "accent" : "muted", entry.item.currentValue);
		return `${prefix}    ${marker} ${leaf} · ${value}`;
	}

	private describeSelectedEntry(): string {
		const selected = this.selectedEntry;
		if (!selected) return "No setting selected.";
		if (selected.type === "section") {
			return `${selected.sectionLabel} contains ${selected.itemCount} settings. ${selected.expanded ? "Left collapses the section." : "Right expands the section."}`;
		}
		if (selected.item.description?.trim()) return selected.item.description.trim();
		if (selected.item.submenu) return `Open ${selected.leafLabel} to choose a specific value.`;
		if (selected.item.values && selected.item.values.length > 0) return `Cycle ${selected.leafLabel} with Enter or Space.`;
		return `Selected setting: ${selected.leafLabel}.`;
	}

	private effectiveMaxVisible(): number {
		const reservedRows = (this.options.subtitleLines?.length ?? 0) + this.descriptionMaxLines + 10;
		const dynamicRows = Math.max(3, this.tui.terminal.rows - reservedRows);
		return Math.max(3, Math.min(this.maxVisible, dynamicRows));
	}

	private wrapDescription(text: string, width: number): string[] {
		const contentWidth = Math.max(12, width - 2);
		const blocks = text.split(/\r?\n/);
		const lines: string[] = [];
		for (const block of blocks) {
			if (block.trim().length === 0) {
				lines.push("");
				continue;
			}
			for (const line of wrapTextWithAnsi(block, contentWidth)) {
				lines.push(line);
			}
		}
		return lines.slice(0, this.descriptionMaxLines);
	}

	invalidate(): void {
		this.submenuComponent?.invalidate();
	}

	render(width: number): string[] {
		if (this.submenuComponent) {
			return this.submenuComponent.render(width);
		}
		this.setSelectedIndex(this.selectedIndex);
		const lines: string[] = [];
		const dirty = this.options.isDirty?.() ?? false;
		const terminalBudget = Math.max(1, this.tui.terminal.rows - 2);
		if (terminalBudget <= 8) {
			lines.push(this.theme.fg("accent", this.theme.bold(`${this.options.title}${dirty ? " *" : ""}`)));
			const entries = this.entries;
			const selected = entries[this.selectedIndex];
			if (terminalBudget >= 6 && (this.options.enableSearch ?? true)) {
				const prefix = "Search: ";
				lines.push(this.theme.fg("dim", `${prefix}${renderEditableValue(this.searchQuery, "(filter)", Math.max(0, width - visibleWidth(prefix)), this.focused)}`));
			}
			if (selected) lines.push(selected.type === "section" ? this.renderSectionEntry(selected, true) : this.renderSettingEntry(selected, true));
			else lines.push(this.theme.fg("warning", "No settings available."));
			if (terminalBudget >= 5) lines.push(this.theme.fg("muted", truncateToWidth(this.describeSelectedEntry(), width, "", true)));
			const footer = `Ctrl+S save • ${keyHint("tui.select.cancel", "cancel")}`;
			while (lines.length < terminalBudget - 1) lines.push("");
			lines.push(this.theme.fg("dim", footer));
			return lines.slice(0, terminalBudget).map((line) => truncateToWidth(line, width, "", true));
		}
		lines.push(this.theme.fg("accent", this.theme.bold(`${this.options.title}${dirty ? " *" : ""}`)));
		for (const line of this.options.subtitleLines ?? []) {
			lines.push(this.theme.fg("muted", line));
		}
		if ((this.options.subtitleLines?.length ?? 0) > 0) lines.push("");
		if (this.options.enableSearch ?? true) {
			const prefix = "Search: ";
			const search = renderEditableValue(
				this.searchQuery,
				"(type to filter)",
				Math.max(0, width - visibleWidth(prefix)),
				this.focused,
			);
			lines.push(this.theme.fg(this.searchQuery ? "accent" : "dim", `${prefix}${search}`));
		}
		const entries = this.entries;
		const maxVisible = this.effectiveMaxVisible();
		if (entries.length === 0) {
			lines.push(this.theme.fg("warning", this.searchQuery ? `No settings match “${this.searchQuery}”.` : "No settings available."));
			for (let i = 1; i < maxVisible; i += 1) lines.push("");
		} else {
			const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), Math.max(0, entries.length - maxVisible)));
			const endIndex = Math.min(entries.length, startIndex + maxVisible);
			for (let i = startIndex; i < endIndex; i += 1) {
				const entry = entries[i]!;
				const selected = i === this.selectedIndex;
				lines.push(entry.type === "section" ? this.renderSectionEntry(entry, selected) : this.renderSettingEntry(entry, selected));
			}
			for (let i = endIndex; i < startIndex + maxVisible; i += 1) lines.push("");
			lines.push(this.theme.fg("dim", `  (${this.selectedIndex + 1}/${entries.length})`));
		}
		lines.push("");
		lines.push(this.theme.fg("muted", "Description"));
		for (const line of this.wrapDescription(this.describeSelectedEntry(), width)) {
			lines.push(this.theme.fg("muted", ` ${line}`));
		}
		while (lines.length > 0 && lines.length < (this.options.subtitleLines?.length ?? 0) + maxVisible + 6 + this.descriptionMaxLines) {
			lines.push("");
		}
		lines.push("");
		const navigation = `${keyText("tui.select.up")}/${keyText("tui.select.down")} navigate`;
		const change = keyHint("tui.select.confirm", "change");
		const cancel = keyHint("tui.select.cancel", "cancel");
		const primary = `Ctrl+S save • ${cancel}`;
		const secondary = `${change} • ${navigation} • ←/→ fold • type search`;
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

	handleInput(data: string): void {
		if (this.submenuComponent?.handleInput) {
			this.submenuComponent.handleInput(data);
			this.tui.requestRender();
			return;
		}
		const kb = this.keybindings;
		const entries = this.entries;
		if (matchesKey(data, "ctrl+s")) {
			this.options.onSave();
			return;
		}
		if (kb.matches(data, "tui.select.cancel")) {
			this.options.onClose();
			return;
		}
		if (matchesKey(data, "left")) {
			this.collapseSelectedSection();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "right")) {
			this.expandSelectedSection();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.popSearchCharacter();
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "ctrl+l")) {
			this.clearSearch();
			this.tui.requestRender();
			return;
		}
		if (kb.matches(data, "tui.select.up")) {
			if (entries.length === 0) return;
			this.setSelectedIndex(this.selectedIndex === 0 ? entries.length - 1 : this.selectedIndex - 1);
			this.tui.requestRender();
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			if (entries.length === 0) return;
			this.setSelectedIndex(this.selectedIndex === entries.length - 1 ? 0 : this.selectedIndex + 1);
			this.tui.requestRender();
			return;
		}
		if (kb.matches(data, "tui.select.pageUp")) {
			this.setSelectedIndex(this.selectedIndex - this.effectiveMaxVisible());
			this.tui.requestRender();
			return;
		}
		if (kb.matches(data, "tui.select.pageDown")) {
			this.setSelectedIndex(this.selectedIndex + this.effectiveMaxVisible());
			this.tui.requestRender();
			return;
		}
		if (kb.matches(data, "tui.select.confirm") || data === " ") {
			this.activateSelected();
			this.tui.requestRender();
			return;
		}
		const printable = decodePrintableInput(data);
		if (printable && printable >= " " && printable !== "\u007f") {
			this.appendSearchCharacter(printable);
			this.tui.requestRender();
		}
	}
}

export function createSettingsScreen(tui: TUI, theme: Theme, keybindings: KeybindingsManager, options: SettingsScreenOptions): Component & Focusable {
	return new SettingsTreeScreen(tui, theme, keybindings, options);
}
