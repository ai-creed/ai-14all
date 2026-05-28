import { readdirSync, statSync, type Stats } from "node:fs";
import { join } from "node:path";
import type { CodexRateLimits, UsageEvent } from "../../shared/models/usage.js";
import { CLAUDE_MARKER, parseClaudeLine } from "./claude-source.js";
import {
	CODEX_MARKER,
	CODEX_META_MARKER,
	CODEX_TURN_MARKER,
	parseCodexRateLimits,
	parseCodexSessionMeta,
	parseCodexTokenLine,
	parseCodexTurnContext,
	sessionIdFromCodexFile,
} from "./codex-source.js";
import { readNewLines } from "./incremental-reader.js";

export interface OffsetEntry {
	offset: number;
	mtime: number;
	// Codex-only: ctx threaded forward across appends. Persisted so a worker
	// restart resumes mid-rollout without losing cwd/model (token lines do not
	// carry them — only session_meta/turn_context lines do).
	cwd?: string;
	model?: string;
}
export type OffsetCache = Map<string, OffsetEntry>;

function listJsonl(dir: string, out: string[]): void {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of names) {
		const full = join(dir, name);
		let st: Stats;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) listJsonl(full, out);
		else if (st.isFile() && full.endsWith(".jsonl")) out.push(full);
	}
}

function changed(
	file: string,
	cache: OffsetCache,
): { from: number; mtime: number } | null {
	const mtime = statSync(file).mtimeMs;
	const prev = cache.get(file);
	if (prev && prev.mtime === mtime) return null;
	return { from: prev?.offset ?? 0, mtime };
}

// Enumerate every .jsonl under root (recursive). Used by the worker to build a
// chunked backfill queue (it processes the returned list in small batches).
export function listJsonlFiles(root: string): string[] {
	const out: string[] = [];
	listJsonl(root, out);
	return out.sort();
}

// Process ONE Claude file: ingest events parsed from newly-appended lines, then
// advance the offset cache. Returns the number of events ingested.
export function processClaudeFile(
	file: string,
	cache: OffsetCache,
	ingest: (e: UsageEvent) => void,
): number {
	const ch = changed(file, cache);
	if (!ch) return 0;
	const { lines, offset } = readNewLines(file, ch.from, (l) =>
		l.includes(CLAUDE_MARKER),
	);
	let count = 0;
	for (const line of lines) {
		const e = parseClaudeLine(line);
		if (e) {
			ingest(e);
			count++;
		}
	}
	cache.set(file, { offset, mtime: ch.mtime });
	return count;
}

// Process ONE Codex rollout: ingest token events, return the newest rate-limit
// snapshot seen in this file (or null). Per-file ctx (cwd/model) is persisted
// in the OffsetCache entry so a worker restart resuming mid-file still has it.
export function processCodexFile(
	file: string,
	cache: OffsetCache,
	ingest: (e: UsageEvent) => void,
): CodexRateLimits | null {
	const ch = changed(file, cache);
	if (!ch) return null;
	const prev = cache.get(file);
	const ctx = {
		cwd: prev?.cwd ?? "",
		model: prev?.model ?? "",
		sessionId: sessionIdFromCodexFile(file.split("/").pop() ?? ""),
	};
	// Back-compat: cache entry from an older build (or any case where ctx was
	// never persisted) resumed past byte 0. Re-scan [0, ch.from) with the
	// meta-only filter to recover cwd/model. Token lines are excluded by the
	// keep filter so no events are re-ingested.
	if (ch.from > 0 && !ctx.cwd) {
		const metaOnly = (l: string): boolean =>
			l.includes(CODEX_META_MARKER) || l.includes(CODEX_TURN_MARKER);
		const back = readNewLines(file, 0, metaOnly);
		for (const line of back.lines) {
			const meta = parseCodexSessionMeta(line);
			if (meta) {
				ctx.cwd = meta.cwd;
				continue;
			}
			const tc = parseCodexTurnContext(line);
			if (tc) {
				if (tc.cwd) ctx.cwd = tc.cwd;
				if (tc.model) ctx.model = tc.model;
			}
		}
	}
	let limits: CodexRateLimits | null = null;
	// Marker pre-filter: only token lines (what we aggregate) plus the small
	// session_meta/turn_context lines (cwd/model). Large unrelated lines never
	// reach JSON.parse.
	const keep = (l: string): boolean =>
		l.includes(CODEX_MARKER) ||
		l.includes(CODEX_META_MARKER) ||
		l.includes(CODEX_TURN_MARKER);
	const { lines, offset } = readNewLines(file, ch.from, keep);
	for (const line of lines) {
		const meta = parseCodexSessionMeta(line);
		if (meta) {
			ctx.cwd = meta.cwd;
			continue;
		}
		const tc = parseCodexTurnContext(line);
		if (tc) {
			if (tc.cwd) ctx.cwd = tc.cwd;
			if (tc.model) ctx.model = tc.model;
			continue;
		}
		if (!line.includes(CODEX_MARKER)) continue;
		const rl = parseCodexRateLimits(line);
		if (rl && (!limits || rl.capturedAtMs >= limits.capturedAtMs)) limits = rl;
		const e = parseCodexTokenLine(line, ctx);
		if (e) ingest(e);
	}
	cache.set(file, {
		offset,
		mtime: ch.mtime,
		cwd: ctx.cwd,
		model: ctx.model,
	});
	return limits;
}

// Convenience wrappers (used by unit tests and one-shot callers). The worker
// uses the per-file processors above so it can yield between files.
export function scanClaude(root: string, cache: OffsetCache): UsageEvent[] {
	const events: UsageEvent[] = [];
	for (const file of listJsonlFiles(root))
		processClaudeFile(file, cache, (e) => events.push(e));
	return events;
}

export function scanCodex(
	root: string,
	cache: OffsetCache,
): { events: UsageEvent[]; limits: CodexRateLimits | null } {
	const events: UsageEvent[] = [];
	let limits: CodexRateLimits | null = null;
	for (const file of listJsonlFiles(root)) {
		const rl = processCodexFile(file, cache, (e) => events.push(e));
		if (rl && (!limits || rl.capturedAtMs >= limits.capturedAtMs)) limits = rl;
	}
	return { events, limits };
}
