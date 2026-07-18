import { closeSync, openSync, readSync } from "node:fs";

export const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;
const READ_CHUNK_BYTES = 64 * 1024;

function isObject(value: unknown): value is Record<string, unknown> | unknown[] {
	return value !== null && typeof value === "object";
}

/** Rejects object keys that can alter prototypes when later merged into ordinary JavaScript objects. */
export function assertSafeJsonStructure(value: unknown): void {
	const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
	let visited = 0;
	while (pending.length > 0) {
		const current = pending.pop()!;
		if (!isObject(current.value)) continue;
		visited += 1;
		if (visited > MAX_JSON_NODES) throw new Error(`JSON structure exceeds ${MAX_JSON_NODES} nodes`);
		if (current.depth > MAX_JSON_DEPTH) throw new Error(`JSON structure exceeds depth ${MAX_JSON_DEPTH}`);
		if (Array.isArray(current.value)) {
			for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 });
			continue;
		}
		for (const [key, child] of Object.entries(current.value)) {
			if (UNSAFE_OBJECT_KEYS.has(key)) throw new Error(`JSON contains unsafe object key: ${key}`);
			pending.push({ value: child, depth: current.depth + 1 });
		}
	}
}

export function parseSafeJson(text: string): unknown {
	const parsed = JSON.parse(text) as unknown;
	assertSafeJsonStructure(parsed);
	return parsed;
}

/** Reads no more than maxBytes + 1 bytes, avoiding an unbounded read and a stat/read growth race. */
export function readBoundedJsonFileIfExists(path: string, maxBytes: number): unknown | undefined {
	let descriptor: number;
	try {
		descriptor = openSync(path, "r");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	const chunks: Buffer[] = [];
	let total = 0;
	try {
		for (;;) {
			const remainingWithSentinel = maxBytes - total + 1;
			if (remainingWithSentinel <= 0) throw new Error(`${path} exceeds ${maxBytes} bytes`);
			const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remainingWithSentinel));
			const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
			if (bytesRead === 0) break;
			total += bytesRead;
			if (total > maxBytes) throw new Error(`${path} exceeds ${maxBytes} bytes`);
			chunks.push(buffer.subarray(0, bytesRead));
		}
	} finally {
		closeSync(descriptor);
	}
	return parseSafeJson(Buffer.concat(chunks, total).toString("utf8"));
}
