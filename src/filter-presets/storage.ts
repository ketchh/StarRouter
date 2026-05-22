import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeModelFilters, type RouterModelFilters } from "../model-filters-screen.ts";

export interface SavedModelFilterPreset {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	filters: RouterModelFilters;
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
		.replace(/^-|-$/g, "");
	return slug || "preset";
}

function uniquePresetPath(dir: string, baseSlug: string): { id: string; path: string } {
	let index = 0;
	for (;;) {
		const id = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
		const path = join(dir, `${id}.json`);
		if (!existsSync(path)) return { id, path };
		index += 1;
	}
}

export function loadSavedModelFilterPresets(dir: string): SavedModelFilterPreset[] {
	if (!existsSync(dir)) return [];
	const presets: SavedModelFilterPreset[] = [];
	for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
		try {
			const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
			if (!raw || typeof raw !== "object" || typeof raw.name !== "string") continue;
			presets.push({
				id: typeof raw.id === "string" ? raw.id : file.replace(/\.json$/, ""),
				name: raw.name,
				createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
				updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
				filters: stripBuiltInPresetMarkers(normalizeModelFilters(raw.filters as Partial<RouterModelFilters> | undefined)),
			});
		} catch {
			// Ignore malformed user preset files; the settings UI should remain usable.
		}
	}
	return presets.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function saveModelFilterPreset(dir: string, name: string, filters: RouterModelFilters): SavedModelFilterPreset {
	mkdirSync(dir, { recursive: true });
	const now = new Date().toISOString();
	const { id, path } = uniquePresetPath(dir, slugifyPresetName(name));
	const preset: SavedModelFilterPreset = {
		id,
		name: name.trim() || id,
		createdAt: now,
		updatedAt: now,
		filters: stripBuiltInPresetMarkers(filters),
	};
	writeFileSync(path, `${JSON.stringify(preset, null, 2)}\n`, "utf8");
	return preset;
}
