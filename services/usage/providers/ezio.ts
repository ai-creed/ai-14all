import { basename, dirname } from "node:path";
import { join } from "node:path";
import { EZIO_MARKER, parseEzioLine } from "../ezio-source.js";
import type { TelemetryDriver } from "./types.js";

export const ezioDriver: TelemetryDriver = {
	id: "ezio",
	capabilities: {
		tokenLog: true,
		storeKind: "jsonl-tree",
		timeSource: "per-event", // ezio rows carry a per-turn ISO-8601 timestamp
		cwdSource: "dir-slug", // cwd derived from the parent directory slug
		nativeLimits: false,
	},
	roots: (home) => [join(home, ".local", "state", "ezio", "sessions")],
	keep: (line) => line.includes(EZIO_MARKER),
	// Parent dir name is the cwd slug; file basename (sans .jsonl) is the session.
	seedCtx: (file) => ({
		cwd: basename(dirname(file)),
		sessionId: basename(file).replace(/\.jsonl$/, ""),
	}),
	parseLine: (line, ctx) => {
		const event = parseEzioLine(line, {
			cwd: ctx.cwd ?? "",
			sessionId: ctx.sessionId ?? "",
		});
		return event ? { event } : {};
	},
};
