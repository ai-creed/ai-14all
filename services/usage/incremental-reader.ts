import { closeSync, openSync, readSync, statSync } from "node:fs";

export interface IncrementalRead {
	lines: string[];
	offset: number;
}

// Reads bytes appended after `fromOffset`, returns complete lines (split on \n)
// that pass `keep`, and the new offset positioned at the start of any trailing
// partial line. If the file shrank (rotated), reads from 0.
export function readNewLines(
	file: string,
	fromOffset: number,
	keep: (line: string) => boolean,
): IncrementalRead {
	const size = statSync(file).size;
	let start = fromOffset;
	if (size < fromOffset) start = 0; // truncated/rotated
	if (size === start) return { lines: [], offset: start };

	const fd = openSync(file, "r");
	try {
		const buf = Buffer.allocUnsafe(size - start);
		readSync(fd, buf, 0, buf.length, start);
		const text = buf.toString("utf8");
		const lastNl = text.lastIndexOf("\n");
		const complete = lastNl === -1 ? "" : text.slice(0, lastNl);
		const consumedBytes =
			lastNl === -1 ? 0 : Buffer.byteLength(text.slice(0, lastNl + 1), "utf8");
		const lines =
			complete.length === 0
				? []
				: complete.split("\n").filter((l) => l.length > 0 && keep(l));
		return { lines, offset: start + consumedBytes };
	} finally {
		closeSync(fd);
	}
}
