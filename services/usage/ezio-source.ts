import type { UsageEvent } from "../../shared/models/usage.js";
import { ezioTokens, type EzioUsageRaw } from "./token-math.js";

// Marker pre-filter (perf contract): only lines containing a usage object reach
// JSON.parse. ezio rows now carry a per-turn ISO-8601 `timestamp` (and `model`),
// but the marker stays the `"usage"` substring — present on every billable row —
// so the pre-filter is unchanged. cwd is still absent and seeded from the dir slug.
export const EZIO_MARKER = '"usage"';

// Forward slug of an absolute path: drop the leading "/", then replace every "/"
// and "." with "-". Lossy (not reversible) — resolution is by forward-slugifying
// known worktrees and matching (see worktree-map matchCwd).
export function ezioSlug(path: string): string {
	return path.replace(/^\//, "").replace(/[/.]/g, "-");
}

interface EzioLine {
	timestamp?: unknown;
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
	const parsed = Date.parse(
		typeof obj.timestamp === "string" ? obj.timestamp : "",
	);
	return {
		provider: "ezio",
		// Per-turn ISO-8601 instant when present; 0 sentinel for legacy rows or an
		// unparseable value — the processor (scanner) stamps file mtime for any
		// falsy timestampMs. Never NaN, so the ledger day-key is always valid.
		timestampMs: Number.isNaN(parsed) ? 0 : parsed,
		cwd: ctx.cwd, // dir slug; resolved at snapshot time
		sessionId: ctx.sessionId,
		model: typeof obj.model === "string" ? obj.model : "",
		input: t.input,
		output: t.output,
		billable: t.billable,
		raw: t.raw,
	};
}
