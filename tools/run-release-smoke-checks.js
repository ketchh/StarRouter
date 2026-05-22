#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

function fail(message) {
	throw new Error(message);
}

function assert(condition, message) {
	if (!condition) fail(message);
}

function read(relativePath) {
	return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function run(command, args) {
	const result = childProcess.spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
		timeout: 180000,
	});
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
	}
	return `${result.stdout}${result.stderr}`;
}

function checkMainSurface() {
	const indexText = read("index.ts");
	assert(indexText.includes('description: "StarRouter model router: /router status|on|off|refresh|settings"'), "Main router command surface is not minimal.");
	assert(!indexText.includes('case "test":'), "Main router still exposes /router test.");
	assert(!indexText.includes('case "suite":'), "Main router still exposes /router suite.");
	assert(!indexText.includes('case "debug":'), "Main router still exposes /router debug.");
	assert(!indexText.includes('showDebugSidebar'), "Main router still imports or uses debug sidebar tooling.");
	assert(!indexText.includes('buildSuiteReport'), "Main router still imports suite tooling.");
	assert(!indexText.includes('mapWithConcurrency'), "Main router still imports suite concurrency tooling.");
}

function checkPackageSurface() {
	const corePkg = JSON.parse(read("package.json"));
	assert(corePkg.version === "1.0.0", "package.json must be promoted to the stable 1.0.0 release.");
	assert(Array.isArray(corePkg.pi?.extensions), "package.json does not declare pi.extensions.");
	assert(corePkg.pi.extensions.length === 1, "Core package should expose exactly one extension.");
	assert(corePkg.pi.extensions.includes("./index.ts"), "package.json does not expose the core extension.");
	assert(corePkg.scripts?.test, "package.json should expose npm test for the release test suite.");
	assert(corePkg.scripts?.typecheck, "package.json should expose npm run typecheck for release validation.");
}

function checkDocsAndConfigs() {
	const readme = read("README.md");
	assert(readme.includes('/router status'), "README no longer documents main router status command.");
	assert(readme.includes('heuristic prompt profiler'), "README should describe the deterministic heuristic prompt profiler.");
	assert(!readme.includes('/router test <prompt>'), "README still documents /router test in the main extension.");
	assert(!readme.includes('/router suite [file]'), "README still documents /router suite in the main extension.");
	assert(!readme.includes('/router debug route <prompt>'), "README still documents /router debug in the main extension.");
	assert(!readme.includes('https://api.openai.com/v1'), "README still contains legacy OpenAI classifier baseUrl.");
	assert(!readme.includes('OPENAI_API_KEY'), "README still contains legacy OpenAI classifier API key docs.");
	assert(!readme.includes('"temperature": 0'), "README still contains legacy classifier temperature.");
	assert(!readme.includes('policy profiles'), "README still documents retired policy profiles.");
	assert(!readme.includes('Reliability cooldowns'), "README still documents retired reliability cooldowns.");

	for (const file of [
		path.join(root, "model-router.json.example"),
	]) {
		const raw = fs.readFileSync(file, "utf8");
		assert(!raw.includes('https://api.openai.com/v1'), `${file} still contains legacy OpenAI classifier baseUrl.`);
		assert(!raw.includes('OPENAI_API_KEY'), `${file} still contains legacy OpenAI classifier API key env.`);
		assert(!raw.includes('"temperature": 0'), `${file} still contains legacy classifier temperature.`);
		assert(!raw.includes('"debug"'), `${file} still contains deprecated debug config block.`);
		assert(!raw.includes('"classifier"'), `${file} still contains retired classifier config block.`);
		assert(!raw.includes('"policy"'), `${file} still contains retired policy config block.`);
		assert(!raw.includes('"reliability"'), `${file} still contains retired reliability config block.`);
	}
}

function checkHtmlPresentation() {
	const html = read("docs/index.html");
	assert((html.match(/<svg /g) ?? []).length >= 2, "docs/index.html should contain at least two inline SVG diagrams.");
	assert(html.includes("75.76%"), "docs/index.html should present the balanced savings data.");
	assert(html.includes("hidden classifier calls"), "docs/index.html should emphasize the deterministic V1 surface.");
	assert(!html.includes("policy profiles"), "docs/index.html still documents retired policy profiles.");
	assert(!html.includes("Reliability cooldowns"), "docs/index.html still documents retired reliability cooldowns.");
}

function checkTestComments() {
	const testsDir = path.join(root, "tests");
	assert(fs.existsSync(testsDir), "tests/ is missing: the release suite should exist.");
	const files = fs.readdirSync(testsDir).filter((file) => file.endsWith(".test.ts"));
	assert(files.length >= 3, "release suite should cover core, prompt understanding, UI behavior, and pricing.");
	for (const file of files) {
		const lines = fs.readFileSync(path.join(testsDir, file), "utf8").split(/\r?\n/);
		for (let index = 0; index < lines.length; index += 1) {
			if (!/^test\(/.test(lines[index].trim())) continue;
			let previous = index - 1;
			while (previous >= 0 && lines[previous].trim() === "") previous -= 1;
			assert(previous >= 0 && lines[previous].trim() === "*/", `${file}:${index + 1} test must be preceded by an explanatory block comment.`);
		}
	}
}

function checkObsoleteArtifactsRemoved() {
	assert(fs.existsSync(path.join(root, "docs/index.html")), "docs/index.html is missing: the final handcrafted review should exist.");
	for (const relativePath of [
		"debug-extension",
		".pi/extensions/star-router-debug/index.ts",
		"src/debug.ts",
		"src/debug-sidebar.ts",
		"src/test-suite.ts",
		"test",
		"tools/run-heuristic-regressions.js",
		"tools/run-routing-engine-matrix.js",
		"tools/generate-router-html-reports.py",
		"tools/runtime-stubs",
		"docs/heuristic-complexity.html",
		"docs/product-review.html",
		"tools/generate-product-review.py",
		"tools/generate-review-report.py",
	]) {
		assert(!fs.existsSync(path.join(root, relativePath)), `${relativePath} should not exist in the core repo.`);
	}
}

function checkRuntimeSmoke() {
	run("pi", ["--list-models", "openrouter"]);
	run("pi", ["-e", ".", "--list-models", "openrouter"]);
	run("pi", ["-e", ".", "-p", "/router status"]);
}

function main() {
	checkMainSurface();
	checkPackageSurface();
	checkDocsAndConfigs();
	checkHtmlPresentation();
	checkTestComments();
	checkObsoleteArtifactsRemoved();
	checkRuntimeSmoke();
	console.log("All release smoke checks passed.");
}

main();
