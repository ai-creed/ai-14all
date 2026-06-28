import type {
	ProviderRateLimits,
	RateLimitWindow,
	UsageEvent,
} from "../../shared/models/usage.js";
import { codexTokens, type CodexUsageRaw } from "./token-math.js";

// Token telemetry marker (the line kind we aggregate). The two context markers
// below are the only NON-token lines we must still parse — they carry cwd/model
// and sit before token lines. Everything else (response_item, etc.) is filtered
// out before JSON.parse, satisfying the marker pre-filter perf contract.
export const CODEX_MARKER = '"token_count"';
export const CODEX_META_MARKER = '"session_meta"';
export const CODEX_TURN_MARKER = '"turn_context"';

const ROLLOUT_PREFIX = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/;

export function sessionIdFromCodexFile(fileName: string): string {
	return fileName.replace(/\.jsonl$/, "").replace(ROLLOUT_PREFIX, "");
}

function parse(line: string): Record<string, unknown> | null {
	try {
		const v: unknown = JSON.parse(line);
		return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

export function parseCodexSessionMeta(line: string): { cwd: string } | null {
	const o = parse(line);
	if (!o || o.type !== "session_meta") return null;
	const payload = o.payload as { cwd?: unknown } | undefined;
	if (typeof payload?.cwd !== "string") return null;
	return { cwd: payload.cwd };
}

export function parseCodexTurnContext(
	line: string,
): { model?: string; cwd?: string } | null {
	const o = parse(line);
	if (!o || o.type !== "turn_context") return null;
	const payload = o.payload as { model?: unknown; cwd?: unknown } | undefined;
	const out: { model?: string; cwd?: string } = {};
	if (typeof payload?.model === "string") out.model = payload.model;
	if (typeof payload?.cwd === "string") out.cwd = payload.cwd;
	return out;
}

export interface CodexLineCtx {
	cwd: string;
	sessionId: string;
	model: string;
}

export function parseCodexTokenLine(
	line: string,
	ctx: CodexLineCtx,
): UsageEvent | null {
	const o = parse(line);
	if (!o || o.type !== "event_msg") return null;
	const payload = o.payload as
		| { type?: unknown; info?: { last_token_usage?: CodexUsageRaw } }
		| undefined;
	if (payload?.type !== "token_count") return null;
	// Sum per-turn deltas only. Absent last_token_usage => skip (do NOT fall back
	// to total_token_usage, which is cumulative and would overcount).
	const delta = payload.info?.last_token_usage;
	if (!delta || typeof delta !== "object") return null;
	const timestampMs = Date.parse(
		typeof o.timestamp === "string" ? o.timestamp : "",
	);
	if (Number.isNaN(timestampMs)) return null;
	const t = codexTokens(delta);
	return {
		provider: "codex",
		timestampMs,
		cwd: ctx.cwd,
		sessionId: ctx.sessionId,
		model: ctx.model,
		input: t.input,
		output: t.output,
		billable: t.billable,
		raw: t.raw,
	};
}

function win(w: unknown): RateLimitWindow | null {
	const x = w as
		| { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown }
		| undefined;
	if (!x || typeof x.used_percent !== "number") return null;
	return {
		usedPercent: x.used_percent,
		windowMinutes: typeof x.window_minutes === "number" ? x.window_minutes : 0,
		resetsAtMs: typeof x.resets_at === "number" ? x.resets_at * 1000 : 0,
	};
}

export function parseCodexRateLimits(line: string): ProviderRateLimits | null {
	const o = parse(line);
	if (!o) return null;
	const payload = o.payload as
		| {
				type?: unknown;
				rate_limits?: {
					plan_type?: unknown;
					primary?: unknown;
					secondary?: unknown;
				};
		  }
		| undefined;
	if (payload?.type !== "token_count" || !payload.rate_limits) return null;
	const rl = payload.rate_limits;
	const capturedAtMs = Date.parse(
		typeof o.timestamp === "string" ? o.timestamp : "",
	);
	if (Number.isNaN(capturedAtMs)) return null;
	return {
		capturedAtMs,
		planType: typeof rl.plan_type === "string" ? rl.plan_type : "",
		primary: win(rl.primary),
		secondary: win(rl.secondary),
	};
}
