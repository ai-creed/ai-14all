import { basename, join } from "node:path";
import {
	HAX_HEADER_MARKER,
	HAX_USAGE_MARKER,
	parseHaxLine,
} from "../hax-source.js";
import type { TelemetryDriver } from "./types.js";

// The ezio provider's telemetry source is the hax ENGINE's native session store
// (spec 2026-07-17-hax-native-usage-driver-design). It covers every hax-backed
// session — CLI, whisper-mounted, subagent children — unlike the retired ezio
// record store, which only CLI sessions wrote to.
export const ezioDriver: TelemetryDriver = {
	id: "ezio",
	capabilities: {
		tokenLog: true,
		storeKind: "jsonl-tree",
		timeSource: "file-mtime", // turn_usage rows carry no per-row timestamp
		cwdSource: "in-line", // absolute cwd from the session header line
		nativeLimits: false,
	},
	roots: (home) => [join(home, ".local", "state", "hax", "sessions")],
	keep: (line) =>
		line.includes(HAX_USAGE_MARKER) || line.includes(HAX_HEADER_MARKER),
	// Filename (sans .jsonl) is a fallback session id; the header overwrites it
	// with the protocol uuid. cwd is NOT seeded from the directory name — the
	// hax dir slug is lossy AND a different format from ezioSlug (dots kept).
	seedCtx: (file) => ({ sessionId: basename(file).replace(/\.jsonl$/, "") }),
	parseLine: (line, ctx) => {
		const event = parseHaxLine(line, ctx);
		return event ? { event } : {};
	},
};
