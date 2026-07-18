import { existsSync, mkdirSync, opendirSync } from "node:fs";
import { join } from "node:path";
import { writeTextFileAtomically, type AtomicWriteOperations } from "../atomic-write.ts";
import { normalizeModelFilters, type RouterModelFilters } from "../model-filters-screen.ts";
import { readBoundedJsonFileIfExists } from "../safe-json-file.ts";

export const MAX_FILTER_PRESET_BYTES = 256 * 1024;
export const MAX_FILTER_PRESET_FILES = 128;
export const MAX_FILTER_PRESET_DIRECTORY_ENTRIES = 512;
export const MAX_FILTER_PRESET_TEXT_LENGTH = 256;
const MAX_FILTER_PRESET_ID_ATTEMPTS = 512;

export interface SavedModelFilterPreset {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	filters: RouterModelFilters;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedPresetText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0
		&& trimmed.length <= MAX_FILTER_PRESET_TEXT_LENGTH
		&& !/[\u0000-\u001f\u007f-\u009f]/.test(trimmed)
		? trimmed
		: undefined;
}

function stripBuiltInPresetMarkers(filters: RouterModelFilters): RouterModelFilters {
	const normalized = normalizeModelFilters(filters);
	for (const providerFilters of Object.values(normalized.providers)) {
		providerFilters.preset = "none";
	}
	return normalized;
}

function slugifyPresetName(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 128)
		.replace(/-$/, "");
	return slug || "preset";
}

function uniquePresetPath(dir: string, baseSlug: string): { id: string; path: string } {
	for (let index = 0; index < MAX_FILTER_PRESET_ID_ATTEMPTS; index += 1) {
		const id = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
		const path = join(dir, `${id}.json`);
		if (!existsSync(path)) return { id, path };
	}
	throw new Error(`Too many saved presets named ${baseSlug}`);
}

function assertPresetSaveCapacity(dir: string): void {
	let directory;
	try {
		directory = opendirSync(dir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	let entries = 0;
	let jsonFiles = 0;
	try {
		for (;;) {
			const entry = directory.readSync();
			if (!entry) break;
			entries += 1;
			if (entries >= MAX_FILTER_PRESET_DIRECTORY_ENTRIES) {
				throw new Error(`Preset directory limit of ${MAX_FILTER_PRESET_DIRECTORY_ENTRIES} entries reached`);
			}
			if (entry.isFile() && entry.name.endsWith(".json")) jsonFiles += 1;
			if (jsonFiles >= MAX_FILTER_PRESET_FILES) {
				throw new Error(`Preset file limit of ${MAX_FILTER_PRESET_FILES} reached`);
			}
		}
	} finally {
		directory.closeSync();
	}
}

function boundedPresetFiles(dir: string): string[] {
	let directory;
	try {
		directory = opendirSync(dir);
	} catch {
		return [];
	}
	const files: string[] = [];
	let examined = 0;
	try {
		for (;;) {
			const entry = directory.readSync();
			if (!entry) break;
			examined += 1;
			if (examined > MAX_FILTER_PRESET_DIRECTORY_ENTRIES) return [];
			if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
			files.push(entry.name);
			if (files.length > MAX_FILTER_PRESET_FILES) return [];
		}
	} finally {
		directory.closeSync();
	}
	return files.sort();
}

export function loadSavedModelFilterPresets(dir: string): SavedModelFilterPreset[] {
	if (!existsSync(dir)) return [];
	const presets: SavedModelFilterPreset[] = [];
	for (const file of boundedPresetFiles(dir)) {
		try {
			const raw = readBoundedJsonFileIfExists(join(dir, file), MAX_FILTER_PRESET_BYTES);
			if (!isRecord(raw)) continue;
			const name = boundedPresetText(raw.name);
			if (!name) continue;
			const fallbackId = boundedPresetText(file.replace(/\.json$/, ""));
			const id = boundedPresetText(raw.id) ?? fallbackId;
			if (!id) continue;
			presets.push({
				id,
				name,
				createdAt: boundedPresetText(raw.createdAt) ?? new Date(0).toISOString(),
				updatedAt: boundedPresetText(raw.updatedAt) ?? new Date(0).toISOString(),
				filters: stripBuiltInPresetMarkers(normalizeModelFilters(raw.filters as Partial<RouterModelFilters> | undefined)),
			});
		} catch {
			// Ignore malformed, unsafe, or oversized user preset files; settings must remain usable.
		}
	}
	return presets.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function saveModelFilterPreset(
	dir: string,
	name: string,
	filters: RouterModelFilters,
	operations?: AtomicWriteOperations,
): SavedModelFilterPreset {
	mkdirSync(dir, { recursive: true });
	assertPresetSaveCapacity(dir);
	const now = new Date().toISOString();
	const boundedName = boundedPresetText(name);
	if (!boundedName && name.trim().length > 0) {
		throw new Error(`Preset name must be at most ${MAX_FILTER_PRESET_TEXT_LENGTH} safe characters`);
	}
	const safeName = boundedName ?? "preset";
	const { id, path } = uniquePresetPath(dir, slugifyPresetName(safeName));
	const preset: SavedModelFilterPreset = {
		id,
		name: safeName,
		createdAt: now,
		updatedAt: now,
		filters: stripBuiltInPresetMarkers(filters),
	};
	const content = `${JSON.stringify(preset, null, 2)}\n`;
	if (Buffer.byteLength(content, "utf8") > MAX_FILTER_PRESET_BYTES) {
		throw new Error(`Preset exceeds ${MAX_FILTER_PRESET_BYTES} bytes`);
	}
	writeTextFileAtomically(path, content, 0o644, operations);
	return preset;
}
