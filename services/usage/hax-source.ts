import type { UsageEvent } from "../../shared/models/usage.js";
import type { ParseCtx } from "./providers/types.js";
import { haxTokens, type HaxUsageRaw } from "./token-math.js";

// Marker pre-filters (perf contract): only header + usage lines reach JSON.parse.
// The header carries the absolute cwd + protocol session id; every billable turn
// carries a turn_usage row. Both substrings are exact byte sequences of the
// hax rollout format (spec §2) — upstream-owned, so parse defensively below.
export const HAX_USAGE_MARKER = '"turn_usage"';
export const HAX_HEADER_MARKER = '"type":"session"';

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Header line → mutate ctx (cwd/sessionId), no event. turn_usage line → event
// with 0 timestamp (the scanner stamps file mtime for any falsy timestamp).
// A turn_usage row whose `usage` is not a plain object is dropped entirely.
export function parseHaxLine(line: string, ctx: ParseCtx): UsageEvent | null {
	if (!line.includes(HAX_USAGE_MARKER) && !line.includes(HAX_HEADER_MARKER)) {
		return null;
	}
	let obj: unknown;
	try {
		obj = JSON.parse(line);
	} catch {
		return null;
	}
	if (!isPlainObject(obj)) return null;
	if (obj.type === "session") {
		if (typeof obj.cwd === "string") ctx.cwd = obj.cwd;
		if (typeof obj.id === "string") ctx.sessionId = obj.id;
		return null;
	}
	if (obj.kind !== "turn_usage") return null;
	if (!isPlainObject(obj.usage)) return null;
	const t = haxTokens(obj.usage as HaxUsageRaw);
	return {
		provider: "ezio",
		timestampMs: 0,
		cwd: ctx.cwd ?? "",
		sessionId: ctx.sessionId ?? "",
		model: typeof obj.model === "string" ? obj.model : "",
		input: t.input,
		output: t.output,
		billable: t.billable,
		raw: t.raw,
	};
}
