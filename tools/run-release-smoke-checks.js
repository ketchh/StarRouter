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
	const profilerText = read("src/prompt-understanding.ts");
	assert(indexText.includes('description: "StarRouter model router: /router status|on|off|refresh|settings"'), "Main router command surface is not minimal.");
	assert(!indexText.includes('case "test":'), "Main router still exposes /router test.");
	assert(!indexText.includes('case "suite":'), "Main router still exposes /router suite.");
	assert(!indexText.includes('case "debug":'), "Main router still exposes /router debug.");
	assert(!indexText.includes("showDebugSidebar") && !indexText.includes("buildSuiteReport"), "Retired debug/suite runtime remains wired.");
	assert(!profilerText.includes("fetch("), "Prompt profiler must not make classifier/network requests.");
	assert(!indexText.includes('"classifier"'), "Main runtime should not expose classifier configuration.");
}

function checkPackageSurface() {
	const pkg = JSON.parse(read("package.json"));
	assert(pkg.version === "1.1.0", "package.json must match release 1.1.0.");
	assert(pkg.engines?.node === ">=22.19.0", "Node requirement must be >=22.19.0.");
	for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
		assert(pkg.peerDependencies?.[name] === ">=0.80.6", `${name} peer requirement must be >=0.80.6.`);
		assert(pkg.devDependencies?.[name] === "0.80.6", `${name} validation dependency must be pinned to 0.80.6.`);
	}
	assert(Array.isArray(pkg.pi?.extensions) && pkg.pi.extensions.length === 1 && pkg.pi.extensions[0] === "./index.ts", "Package must expose exactly the main Pi extension.");
	assert(pkg.scripts?.test === "npm run test:offline", "npm test must delegate to the offline suite.");
	assert(pkg.scripts?.["test:offline"]?.includes("disable-network.js") && pkg.scripts["test:offline"].includes("tests/*.test.ts"), "Offline test script must deny fetch and include only root tests.");
	assert(pkg.scripts?.["test:live"]?.includes("tests/live/*.live.test.ts"), "Live test script must target only explicit live tests.");
	assert(pkg.scripts?.["test:all"]?.includes("test:offline") && pkg.scripts["test:all"].includes("test:live"), "test:all must run offline then live.");
	for (const file of ["CHANGELOG.md", "model-router.json.example", "model-router.project.json.example"]) {
		assert(pkg.files?.includes(file), `${file} must be included in package files.`);
	}
}

function checkDocsAndConfigs() {
	const readme = read("README.md");
	const security = read("SECURITY.md");
	const algorithm = read("docs/algorithm.md");
	const changelog = read("CHANGELOG.md");
	for (const token of ["Node.js `>=22.19.0`", "Pi `>=0.80.6`", "npm run test:offline", "npm run test:live", "Ctrl+Shift+S", "project configuration can control only", "custom global endpoint does not receive them"]) {
		assert(readme.toLowerCase().includes(token.toLowerCase()), `README is missing release/trust documentation: ${token}`);
	}
	assert(readme.includes("zero classifier-model calls"), "README must state the no-classifier property.");
	assert(security.includes("Project values for `enabled`"), "SECURITY must document the project trust boundary.");
	assert(security.includes("validated stale cache"), "SECURITY must document validated stale-cache fallback.");
	assert(security.includes("Custom global endpoints") && security.includes("no Artificial Analysis secret headers"), "SECURITY must document custom-endpoint secret behavior.");
	assert(readme.includes("model-only") && readme.includes("slug pin") && readme.includes("operating-system sandbox"), "README must document evidence scope, strict overrides, and offline-guard scope.");
	assert(algorithm.includes("lexicographic") && algorithm.includes("TTFT"), "Algorithm docs must match objective and latency semantics.");
	for (const heading of ["Identity gates", "Host normalization", "Pareto frontier", "Confidence and abstention", "Limits", "Test strategy"]) {
		assert(algorithm.includes(heading), `Algorithm documentation is missing ${heading}.`);
	}
	assert(changelog.includes("## 1.1.0") && changelog.includes("Migrating from 1.0.0"), "CHANGELOG must contain 1.1.0 and migration notes.");

	for (const relativePath of ["model-router.json.example", "model-router.project.json.example"]) {
		const raw = read(relativePath);
		JSON.parse(raw);
		for (const retired of ['"classifier"', '"debug"', '"policy"', '"reliability"']) {
			assert(!raw.includes(retired), `${relativePath} contains retired configuration ${retired}.`);
		}
	}
	const projectExample = JSON.parse(read("model-router.project.json.example"));
	assert(projectExample.enabled === undefined, "Project example must not include enabled.");
	assert(projectExample.dataSource === undefined, "Project example must not include dataSource.");
	assert(projectExample.strategy?.routingProvider === undefined, "Project example must not include routingProvider.");
	assert(projectExample.ui?.autoAcceptRouting === undefined, "Project example must not include autoAcceptRouting.");

}

function checkHtmlPresentation() {
	const html = read("docs/index.html");
	assert((html.match(/<svg\b/g) ?? []).length >= 2, "Public page should contain at least two inline SVG diagrams.");
	assert(html.includes("113") && html.includes("deterministic offline tests"), "Public page must present current offline evidence.");
	assert(html.includes("80") && html.includes("checked-in golden prompts"), "Public page must present the golden bank.");
	assert(html.includes("0") && html.includes("classifier calls before a turn"), "Public page must state zero classifier calls.");
	assert(html.includes("Evidence, not projections") && html.includes("npm run test:live"), "Public page must explain reproducibility and live observations.");
	assert(html.includes("2026-07-13"), "Public page must carry the approved release date.");
	assert(html.includes(":focus-visible") && html.includes("@media print") && html.includes("<main"), "Public page must include keyboard focus, print, and semantic main support.");
	assert(!/<script\b/i.test(html), "Public page must remain JavaScript-free.");
	assert(!/https?:\/\/(?:fonts|cdn)\./i.test(html), "Public page must not load font/CDN assets.");
}

function collectTestFiles(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const location = path.join(directory, entry.name);
		if (entry.isDirectory()) return collectTestFiles(location);
		return entry.name.endsWith(".test.ts") ? [location] : [];
	});
}

function checkTestComments() {
	const testsDir = path.join(root, "tests");
	assert(fs.existsSync(testsDir), "tests/ is missing.");
	const files = collectTestFiles(testsDir);
	assert(files.length >= 7, "Release suite should cover core, security, cache, lifecycle, UI, and live observation.");
	for (const file of files) {
		const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
		for (let index = 0; index < lines.length; index += 1) {
			if (!/^test\(/.test(lines[index].trim())) continue;
			let previous = index - 1;
			while (previous >= 0 && lines[previous].trim() === "") previous -= 1;
			assert(previous >= 0 && lines[previous].trim() === "*/", `${path.relative(root, file)}:${index + 1} test must be preceded by an explanatory block comment.`);
		}
	}
}

function checkObsoleteArtifactsRemoved() {
	for (const relativePath of [
		"debug-extension", ".pi/extensions/star-router-debug/index.ts", "src/debug.ts", "src/debug-sidebar.ts",
		"src/test-suite.ts", "test", "tools/run-heuristic-regressions.js", "tools/run-routing-engine-matrix.js",
		"tools/generate-router-html-reports.py", "tools/runtime-stubs", "docs/heuristic-complexity.html",
		"docs/product-review.html", "tools/generate-product-review.py", "tools/generate-review-report.py",
	]) {
		assert(!fs.existsSync(path.join(root, relativePath)), `${relativePath} should not exist in the core package.`);
	}
}

function checkRuntimeSmoke() {
	run("pi", ["--list-models", "openrouter"]);
	run("pi", ["-e", ".", "--list-models", "openrouter"]);
	const status = run("pi", ["-e", ".", "-p", "/router status"]);
	assert(status.includes("Router status → disabled"), "Extension runtime smoke must print the disabled router status.");
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
