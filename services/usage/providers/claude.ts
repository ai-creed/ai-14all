import { join } from "node:path";
import { CLAUDE_MARKER, parseClaudeLine } from "../claude-source.js";
import type { TelemetryDriver } from "./types.js";

export const claudeDriver: TelemetryDriver = {
	id: "claude",
	capabilities: {
		tokenLog: true,
		storeKind: "jsonl-tree",
		timeSource: "per-event",
		cwdSource: "in-line",
		nativeLimits: false,
	},
	roots: (home) => [join(home, ".claude", "projects")],
	keep: (line) => line.includes(CLAUDE_MARKER),
	parseLine: (line) => {
		const event = parseClaudeLine(line);
		return event ? { event } : {};
	},
};
