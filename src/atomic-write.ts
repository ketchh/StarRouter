import { renameSync, unlinkSync, writeFileSync } from "node:fs";

export interface AtomicWriteOperations {
	write(path: string, content: string, mode: number): void;
	rename(from: string, to: string): void;
	remove(path: string): void;
}

const NODE_ATOMIC_WRITE_OPERATIONS: AtomicWriteOperations = {
	write(path, content, mode) {
		writeFileSync(path, content, { encoding: "utf8", mode });
	},
	rename(from, to) {
		renameSync(from, to);
	},
	remove(path) {
		unlinkSync(path);
	},
};

/**
 * Replaces a text file through a same-directory temporary file. A failed write or rename leaves the
 * previous destination untouched and triggers best-effort temporary-file cleanup.
 */
export function writeTextFileAtomically(
	path: string,
	content: string,
	mode: number,
	operations: AtomicWriteOperations = NODE_ATOMIC_WRITE_OPERATIONS,
): void {
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
	try {
		operations.write(temporaryPath, content, mode);
		operations.rename(temporaryPath, path);
	} finally {
		try {
			operations.remove(temporaryPath);
		} catch {
			// Successful rename removes the temporary path; failed writes still get best-effort cleanup.
		}
	}
}
