import { readdirSync, statSync, type Stats } from "node:fs";
import { join } from "node:path";
import type { AgentProviderId } from "../../shared/models/agent-provider.js";
import type {
	ProviderRateLimits,
	UsageEvent,
} from "../../shared/models/usage.js";
import { claudeDriver } from "./providers/claude.js";
import { codexDriver } from "./providers/codex.js";
import type { ParseCtx, TelemetryDriver } from "./providers/types.js";
import { readNewLines } from "./incremental-reader.js";
import {
	type ContributionJson,
	bucketKey,
	recordContribution,
	startOfLocalDay,
} from "./ledger.js";

export interface OffsetEntry {
	offset: number;
	mtime: number;
	// Opaque parse ctx threaded across appends (codex cwd/model, ezio slug).
	// Persisted so a worker restart resumes mid-file without re-deriving it.
	ctx?: ParseCtx;
	// What this file has added to the global ledger (day -> BucketKey -> totals).
	// Dropped when the file is sealed (bounds the cache); see the worker's seal pass.
	contribution?: ContributionJson;
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
): { from: number; mtime: number; truncated: boolean } | null {
	const st = statSync(file);
	const mtime = st.mtimeMs;
	const prev = cache.get(file);
	if (prev && prev.mtime === mtime) return null;
	let from = prev?.offset ?? 0;
	const truncated = !!prev && st.size < prev.offset;
	if (truncated) from = 0; // re-read from the start after subtract/rebuild
	return { from, mtime, truncated };
}

// Enumerate every .jsonl under root (recursive). Used by the worker to build a
// chunked backfill queue (it processes the returned list in small batches).
export function listJsonlFiles(root: string): string[] {
	const out: string[] = [];
	listJsonl(root, out);
	return out.sort();
}

// Drop cached offsets for files modified within `windowMs` of `nowMs` so the
// next scan re-reads them from the start. Called once per launch: the worker's
// aggregator is rebuilt empty each run, so resuming at the persisted offset
// would lose this-week usage that was already consumed in a prior session.
// Files older than the window can't contribute to the rolling window, so their
// offsets are preserved (no needless re-parsing).
export function resetRecentOffsets(
	roots: string[],
	cache: OffsetCache,
	nowMs: number,
	windowMs: number,
): void {
	const cutoff = nowMs - windowMs;
	for (const root of roots) {
		for (const file of listJsonlFiles(root)) {
			let mtime: number;
			try {
				mtime = statSync(file).mtimeMs;
			} catch {
				continue;
			}
			if (mtime >= cutoff) cache.delete(file);
		}
	}
}

export interface ScanHandlers {
	ingest: (e: UsageEvent) => void; // update ledger + session
	onLimits: (id: AgentProviderId, limits: ProviderRateLimits) => void;
	// Truncation of an ACTIVE file: subtract its prior contribution from the ledger
	// before the re-read below re-adds the new bytes (keeps the total idempotent).
	onSubtract: (contrib: ContributionJson) => void;
	// Truncation of a SEALED file (contribution dropped): the per-file subtract path
	// is unavailable, so request the one-time full rebuild (spec §4.3 safe recovery).
	onSealedTruncation: () => void;
}

// Process ONE jsonl file for the given driver: ingest token events from newly
// appended matching lines, surface any provider limits, advance the offset
// cache (threading parse ctx), and record per-file contribution for idempotency.
export function processJsonlFile(
	driver: TelemetryDriver,
	file: string,
	cache: OffsetCache,
	h: ScanHandlers,
): void {
	const ch = changed(file, cache);
	if (!ch) return;
	const prev = cache.get(file);

	if (ch.truncated) {
		if (prev?.contribution) {
			h.onSubtract(prev.contribution); // active file: reconcile precisely
		} else {
			// Sealed file with no contribution detail: cannot subtract in isolation.
			// Signal a full rebuild and stop touching this file this pass.
			h.onSealedTruncation();
			return;
		}
	}

	// Seeded defaults first; persisted ctx wins over them.
	const ctx: ParseCtx = {
		...(driver.seedCtx?.(file) ?? {}),
		...(prev?.ctx ?? {}),
	};
	// Back-compat: resumed past byte 0 without threaded ctx (old cache or codex
	// upgrade). Re-derive it without re-ingesting events.
	if (ch.from > 0 && driver.recoverCtx && !ctx.cwd) {
		Object.assign(ctx, driver.recoverCtx(file, ch.from));
	}
	const keep = driver.keep ?? ((): boolean => true);
	const { lines, offset } = readNewLines(file, ch.from, keep);
	const fileMtime = driver.capabilities.timeSource === "file-mtime";

	// Re-reading after truncation resets contribution; appends extend it.
	const contribution: ContributionJson = ch.truncated
		? {}
		: (prev?.contribution ?? {});

	for (const line of lines) {
		const r = driver.parseLine?.(line, ctx);
		if (!r) continue;
		if (r.limits) h.onLimits(driver.id, r.limits);
		if (r.event) {
			if (fileMtime) r.event.timestampMs = ch.mtime;
			h.ingest(r.event);
			recordContribution(
				contribution,
				startOfLocalDay(r.event.timestampMs),
				bucketKey(r.event.cwd, r.event.provider, r.event.model),
				r.event,
			);
		}
	}
	cache.set(file, { offset, mtime: ch.mtime, ctx, contribution });
}

// Thin wrappers (used by unit tests and scanClaude/scanCodex). Parity with the
// generic processor is guaranteed because they ARE the generic processor.
export function processClaudeFile(
	file: string,
	cache: OffsetCache,
	ingest: (e: UsageEvent) => void,
): number {
	let count = 0;
	processJsonlFile(claudeDriver, file, cache, {
		ingest: (e) => {
			ingest(e);
			count++;
		},
		onLimits: () => {},
		onSubtract: () => {},
		onSealedTruncation: () => {},
	});
	return count;
}

export function processCodexFile(
	file: string,
	cache: OffsetCache,
	ingest: (e: UsageEvent) => void,
): ProviderRateLimits | null {
	let limits: ProviderRateLimits | null = null;
	processJsonlFile(codexDriver, file, cache, {
		ingest,
		onLimits: (_id, rl) => {
			if (!limits || rl.capturedAtMs >= limits.capturedAtMs) limits = rl;
		},
		onSubtract: () => {},
		onSealedTruncation: () => {},
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
): { events: UsageEvent[]; limits: ProviderRateLimits | null } {
	const events: UsageEvent[] = [];
	let limits: ProviderRateLimits | null = null;
	for (const file of listJsonlFiles(root)) {
		const rl = processCodexFile(file, cache, (e) => events.push(e));
		if (rl && (!limits || rl.capturedAtMs >= limits.capturedAtMs)) limits = rl;
	}
	return { events, limits };
}
