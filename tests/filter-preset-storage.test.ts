import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MAX_FILTER_PRESET_BYTES,
	MAX_FILTER_PRESET_DIRECTORY_ENTRIES,
	MAX_FILTER_PRESET_FILES,
	loadSavedModelFilterPresets,
	saveModelFilterPreset,
} from "../src/filter-presets/storage.ts";
import type { RouterModelFilters } from "../src/model-filters-screen.ts";

function tempDir(t: test.TestContext, suffix = "presets"): string {
	const dir = mkdtempSync(join(tmpdir(), `star-router-${suffix}-`));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function filters(): RouterModelFilters {
	return {
		providers: {
			openrouter: {
				preset: "benchmark-safe",
				disabledFamilies: ["gpt-4o"],
				disabledModels: ["openai/gpt-4o-mini"],
			},
		},
	};
}

/*
 * Verifies successful preset persistence is atomic-compatible, parseable, and strips built-in
 * template markers without losing the concrete filter snapshot.
 */
test("saved filter presets round-trip through bounded storage", (t) => {
	const dir = tempDir(t);
	const saved = saveModelFilterPreset(dir, "Team Safe", filters());
	const raw = JSON.parse(readFileSync(join(dir, `${saved.id}.json`), "utf8"));
	const loaded = loadSavedModelFilterPresets(dir);

	assert.equal(raw.name, "Team Safe");
	assert.equal(loaded.length, 1);
	assert.equal(loaded[0]?.id, saved.id);
	assert.equal(loaded[0]?.filters.providers.openrouter?.preset, "none");
	assert.deepEqual(loaded[0]?.filters.providers.openrouter?.disabledModels, ["openai/gpt-4o-mini"]);
});

/*
 * Verifies failed preset replacement leaves existing data untouched and cleans the same-directory
 * temporary file through the shared atomic-write contract.
 */
test("failed preset rename preserves existing files and removes temp", (t) => {
	const dir = tempDir(t);
	const existingPath = join(dir, "team-safe.json");
	writeFileSync(existingPath, "original\n", "utf8");
	let temporaryPath = "";

	assert.throws(() => saveModelFilterPreset(dir, "Team Safe", filters(), {
		write(path, content, mode) {
			temporaryPath = path;
			writeFileSync(path, content, { encoding: "utf8", mode });
		},
		rename() { throw new Error("simulated preset rename failure"); },
		remove(path) { unlinkSync(path); },
	}), /simulated preset rename failure/);

	assert.equal(readFileSync(existingPath, "utf8"), "original\n");
	assert.equal(existsSync(temporaryPath), false);
	assert.equal(existsSync(join(dir, "team-safe-2.json")), false);
});

/*
 * Verifies oversized, unsafe, and overlong preset payloads are ignored independently while a valid
 * bounded sibling remains available.
 */
test("preset loading ignores unsafe and oversized files", (t) => {
	const dir = tempDir(t);
	const valid = saveModelFilterPreset(dir, "Valid", filters());
	writeFileSync(join(dir, "oversized.json"), " ".repeat(MAX_FILTER_PRESET_BYTES + 1), "utf8");
	writeFileSync(join(dir, "unsafe.json"), '{"name":"Unsafe","__proto__":{"polluted":true},"filters":{}}', "utf8");
	writeFileSync(join(dir, "overlong.json"), JSON.stringify({ name: "x".repeat(257), filters: {} }), "utf8");

	assert.deepEqual(loadSavedModelFilterPresets(dir).map((preset) => preset.id), [valid.id]);
	assert.equal(({} as { polluted?: boolean }).polluted, undefined);
	assert.throws(() => saveModelFilterPreset(tempDir(t, "preset-name"), "x".repeat(257), filters()), /Preset name/);

	const oversizedSaveDir = tempDir(t, "preset-save-size");
	const longValues = Array.from({ length: 512 }, (_, index) => `${String(index).padStart(3, "0")}-${"x".repeat(248)}`);
	assert.throws(() => saveModelFilterPreset(oversizedSaveDir, "Too Large", {
		providers: {
			openrouter: {
				preset: "none",
				disabledFamilies: longValues,
				disabledModels: longValues.map((value) => `m${value}`),
			},
		},
	}), /Preset exceeds/);
	assert.deepEqual(loadSavedModelFilterPresets(oversizedSaveDir), []);
});

/*
 * Verifies directory-level file and entry limits fail closed deterministically instead of scanning
 * an attacker-controlled number of project-local preset entries.
 */
test("preset directory enumeration is bounded", (t) => {
	const atFileLimit = tempDir(t, "preset-save-count");
	for (let index = 0; index < MAX_FILTER_PRESET_FILES; index += 1) {
		writeFileSync(join(atFileLimit, `${String(index).padStart(3, "0")}.json`), JSON.stringify({ name: `Preset ${index}`, filters: {} }), "utf8");
	}
	assert.equal(loadSavedModelFilterPresets(atFileLimit).length, MAX_FILTER_PRESET_FILES);
	assert.throws(() => saveModelFilterPreset(atFileLimit, "One Too Many", filters()), /file limit/);
	assert.equal(loadSavedModelFilterPresets(atFileLimit).length, MAX_FILTER_PRESET_FILES);

	const tooManyJson = tempDir(t, "preset-count");
	for (let index = 0; index <= MAX_FILTER_PRESET_FILES; index += 1) {
		writeFileSync(join(tooManyJson, `${String(index).padStart(3, "0")}.json`), JSON.stringify({ name: `Preset ${index}`, filters: {} }), "utf8");
	}
	assert.deepEqual(loadSavedModelFilterPresets(tooManyJson), []);

	const atEntryLimit = tempDir(t, "preset-save-entries");
	for (let index = 0; index < MAX_FILTER_PRESET_DIRECTORY_ENTRIES; index += 1) {
		writeFileSync(join(atEntryLimit, `${String(index).padStart(3, "0")}.txt`), "x", "utf8");
	}
	assert.throws(() => saveModelFilterPreset(atEntryLimit, "One Too Many", filters()), /directory limit/);

	const tooManyEntries = tempDir(t, "preset-entries");
	writeFileSync(join(tooManyEntries, "valid.json"), JSON.stringify({ name: "Valid", filters: {} }), "utf8");
	for (let index = 0; index < MAX_FILTER_PRESET_DIRECTORY_ENTRIES; index += 1) {
		writeFileSync(join(tooManyEntries, `${String(index).padStart(3, "0")}.txt`), "x", "utf8");
	}
	assert.deepEqual(loadSavedModelFilterPresets(tooManyEntries), []);
});
