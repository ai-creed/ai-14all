import type { UsageEvent } from "../../shared/models/usage.js";
import { ezioTokens, type EzioUsageRaw } from "./token-math.js";

// Marker pre-filter (perf contract): only lines containing a usage object reach
// JSON.parse. ezio records have no per-turn timestamp and no cwd — the generic
// processor stamps the timestamp from file mtime and seeds cwd from the dir slug.
export const EZIO_MARKER = '"usage"';

// Forward slug of an absolute path: drop the leading "/", then replace every "/"
// and "." with "-". Lossy (not reversible) — resolution is by forward-slugifying
// known worktrees and matching (see worktree-map matchCwd).
export function ezioSlug(path: string): string {
	return path.replace(/^\//, "").replace(/[/.]/g, "-");
}

interface EzioLine {
	model?: unknown;
	usage?: EzioUsageRaw;
}

export function parseEzioLine(
	line: string,
	ctx: { cwd: string; sessionId: string },
): UsageEvent | null {
	if (!line.includes(EZIO_MARKER)) return null;
	let obj: EzioLine;
	try {
		obj = JSON.parse(line) as EzioLine;
	} catch {
		return null;
	}
	const usage = obj?.usage;
	if (!usage || typeof usage !== "object") return null;
	const t = ezioTokens(usage);
	return {
		provider: "ezio",
		timestampMs: 0, // stamped from file mtime by the processor (timeSource: file-mtime)
		cwd: ctx.cwd, // dir slug; resolved at snapshot time
		sessionId: ctx.sessionId,
		model: typeof obj.model === "string" ? obj.model : "",
		input: t.input,
		output: t.output,
		billable: t.billable,
		raw: t.raw,
	};
}
