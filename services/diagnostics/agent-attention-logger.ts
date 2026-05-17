import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * Diagnostics mode for the agent-attention logger.
 *
 * - `off`     — logger is a no-op; nothing is written or pruned.
 * - `sampled` — events are written but free-text fields are redacted.
 * - `full`    — events are written verbatim (raw terminal samples included).
 *
 * Default everywhere is `off` (opt-in only).
 */
export type AgentAttentionLogMode = "off" | "sampled" | "full";

/**
 * A classifier decision event: the attention classifier evaluated terminal
 * output for a process and produced a state.
 */
export type ClassifierLogEvent = {
	type: "classifier";
	ts: number;
	worktreeId: string;
	processId: string;
	provider: "claude" | "codex" | "other" | null;
	state: "waiting" | "ready" | "failed" | "stale";
	matchedPattern: string;
	inputSample: string;
	inputPrev: string;
};

/**
 * An MCP push event: the agent-attention MCP bridge pushed a session status
 * for a worktree.
 */
export type MCPLogEvent = {
	type: "mcp";
	ts: number;
	worktreeId: string;
	provider: "claude" | "codex" | "other" | null;
	state: "active" | "waiting" | "ready" | "failed";
	summary: string;
	task: string | null | undefined;
	nextAction: string | null;
};

/**
 * A process lifecycle event: an agent process started or exited.
 */
export type LifecycleLogEvent = {
	type: "lifecycle";
	ts: number;
	worktreeId: string;
	processId: string;
	provider: "claude" | "codex" | "other" | null;
	state: "active" | "failed";
	exitCode: number | null;
};

/**
 * A resolution event: the resolved attention state for a worktree changed
 * (records the before/after snapshots and their sources).
 */
export type ResolutionLogEvent = {
	type: "resolution";
	ts: number;
	worktreeId: string;
	processId: string | null;
	provider: "claude" | "codex" | "other" | null;
	before: { state: string; source: string; summary?: string } | null;
	after: { state: string; source: string; summary?: string } | null;
};

/**
 * Union of all event shapes the agent-attention logger accepts.
 * Tasks 9-10 (MCP server, terminal manager, IPC handler) import these.
 */
export type AttentionLogEvent =
	| ClassifierLogEvent
	| MCPLogEvent
	| LifecycleLogEvent
	| ResolutionLogEvent;

const ProviderSchema = z
	.enum(["claude", "codex", "other"])
	.nullable();

const ClassifierLogEventSchema = z.object({
	type: z.literal("classifier"),
	ts: z.number(),
	worktreeId: z.string(),
	processId: z.string(),
	provider: ProviderSchema,
	state: z.enum(["waiting", "ready", "failed", "stale"]),
	matchedPattern: z.string(),
	inputSample: z.string(),
	inputPrev: z.string(),
});

const MCPLogEventSchema = z.object({
	type: z.literal("mcp"),
	ts: z.number(),
	worktreeId: z.string(),
	provider: ProviderSchema,
	state: z.enum(["active", "waiting", "ready", "failed"]),
	summary: z.string(),
	// `task` is a required key whose value may be string | null | undefined,
	// mirroring MCPLogEvent.task exactly (not an optional key).
	task: z.union([z.string(), z.null(), z.undefined()]),
	nextAction: z.string().nullable(),
});

const LifecycleLogEventSchema = z.object({
	type: z.literal("lifecycle"),
	ts: z.number(),
	worktreeId: z.string(),
	processId: z.string(),
	provider: ProviderSchema,
	state: z.enum(["active", "failed"]),
	exitCode: z.number().nullable(),
});

const ResolutionSnapshotSchema = z
	.object({
		state: z.string(),
		source: z.string(),
		summary: z.string().optional(),
	})
	.nullable();

const ResolutionLogEventSchema = z.object({
	type: z.literal("resolution"),
	ts: z.number(),
	worktreeId: z.string(),
	processId: z.string().nullable(),
	provider: ProviderSchema,
	before: ResolutionSnapshotSchema,
	after: ResolutionSnapshotSchema,
});

/**
 * Runtime validator for {@link AttentionLogEvent}. The IPC handler Zod-parses
 * untrusted renderer payloads with this before handing them to the logger.
 *
 * The `_AttentionLogEventSchemaInSync` / `_AttentionLogEventTypeInSync`
 * compile-time assertions below force this schema and the hand-written TS
 * union to stay structurally identical — if either side drifts, typecheck
 * fails.
 */
export const AttentionLogEventSchema = z.discriminatedUnion("type", [
	ClassifierLogEventSchema,
	MCPLogEventSchema,
	LifecycleLogEventSchema,
	ResolutionLogEventSchema,
]);

type AssertEqual<A, B> = [A] extends [B]
	? [B] extends [A]
		? true
		: never
	: never;

// If these error, the Zod schema and the TS union have drifted apart.
const _AttentionLogEventSchemaInSync: AssertEqual<
	z.infer<typeof AttentionLogEventSchema>,
	AttentionLogEvent
> = true;
const _AttentionLogEventTypeInSync: AssertEqual<
	AttentionLogEvent,
	z.infer<typeof AttentionLogEventSchema>
> = true;
void _AttentionLogEventSchemaInSync;
void _AttentionLogEventTypeInSync;

const DEFAULT_FILE_CAP_BYTES = 10 * 1024 * 1024;
const RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Hard upper bound on total bytes across all `agent-attention-*` files. The
// 7-day date prune is the primary cleanup, but per-day size rollover is
// otherwise unbounded (one busy full-mode day can spawn many `.N` chunks
// within the retention window). This budget is the backstop that enforces the
// spec's ~70 MB worst case. It scales with the (injectable) per-file cap so it
// stays proportional: default 7 * 10 MB = 70 MB; with a tiny test cap it
// scales down so the bound is testable.
const MAX_TOTAL_BYTES_FACTOR = RETENTION_DAYS;

// agent-attention-YYYY-MM-DD.jsonl OR agent-attention-YYYY-MM-DD.N.jsonl
const FILE_NAME_RE = /^agent-attention-(\d{4})-(\d{2})-(\d{2})(?:\.\d+)?\.jsonl$/;

export type AgentAttentionLoggerOptions = {
	logsDir: string;
	mode: AgentAttentionLogMode;
	now?: () => Date;
	fileCapBytes?: number;
};

export class AgentAttentionLogger {
	private readonly logsDir: string;
	private readonly mode: AgentAttentionLogMode;
	private readonly now: () => Date;
	private readonly fileCapBytes: number;
	private readonly maxTotalBytes: number;
	private disabled = false;

	constructor(options: AgentAttentionLoggerOptions) {
		this.logsDir = options.logsDir;
		this.mode = options.mode;
		this.now = options.now ?? (() => new Date());
		this.fileCapBytes = options.fileCapBytes ?? DEFAULT_FILE_CAP_BYTES;
		this.maxTotalBytes = this.fileCapBytes * MAX_TOTAL_BYTES_FACTOR;

		if (this.mode === "off") return;

		mkdirSync(this.logsDir, { recursive: true });
		this.pruneOldFiles();
		this.enforceTotalSizeBudget();

		if (this.mode === "full") {
			this.writeFullModeHeader();
		}
	}

	/**
	 * In `full` mode, write a one-line preamble marker into the current day's
	 * file before any events. This is a file-level warning (mirrored by the
	 * in-app banner) reminding readers that raw terminal output is captured
	 * here. It is intentionally NOT part of `AttentionLogEvent`.
	 */
	private writeFullModeHeader(): void {
		if (this.disabled) return;
		const meta = {
			type: "_meta",
			ts: this.now().getTime(),
			warning:
				"full mode: raw terminal output is being captured to this file",
		};
		try {
			appendFileSync(
				this.currentFilePath(),
				`${JSON.stringify(meta)}\n`,
				"utf8",
			);
		} catch (e) {
			console.warn("[agent-attention-logger] failed to append:", e);
			this.disabled = true;
		}
	}

	getMode(): AgentAttentionLogMode {
		return this.mode;
	}

	getLogsDir(): string {
		return this.logsDir;
	}

	async append(event: AttentionLogEvent): Promise<void> {
		if (this.mode === "off" || this.disabled) return;

		const record =
			this.mode === "sampled" ? this.redact(event) : event;

		try {
			const path = this.currentFilePath();
			// Roll the current day-file out of the way *before* writing when it
			// has already reached the size cap, so the active base file is
			// always present and the freshest data lives in it.
			if (existsSync(path) && statSync(path).size >= this.fileCapBytes) {
				this.rolloverCurrent();
				// A rollover just created another `.N` chunk. Same-day rollover
				// is unbounded on its own, so enforce the total-size backstop
				// here too (not just on init) to keep disk hard-bounded.
				this.enforceTotalSizeBudget();
			}
			appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
		} catch (e) {
			// Best-effort diagnostics: never let logging failures break the app.
			console.warn("[agent-attention-logger] failed to append:", e);
			this.disabled = true;
		}
	}

	private redact(event: AttentionLogEvent): AttentionLogEvent {
		if (event.type !== "classifier") return event;
		return {
			...event,
			inputSample: `<redacted, length=${event.inputSample.length}>`,
			inputPrev: `<redacted, length=${event.inputPrev.length}>`,
		};
	}

	private dateStamp(): string {
		// Spec requires daily rotation by *local* calendar date, so 00:00-06:59
		// in timezones west of UTC do not write under the previous day's file.
		const d = this.now();
		const y = d.getFullYear();
		const m = `${d.getMonth() + 1}`.padStart(2, "0");
		const day = `${d.getDate()}`.padStart(2, "0");
		return `${y}-${m}-${day}`;
	}

	private currentFilePath(): string {
		return join(this.logsDir, `agent-attention-${this.dateStamp()}.jsonl`);
	}

	private rolloverCurrent(): void {
		const stamp = this.dateStamp();
		const base = join(this.logsDir, `agent-attention-${stamp}.jsonl`);
		if (!existsSync(base)) return;
		let n = 1;
		let target = join(this.logsDir, `agent-attention-${stamp}.${n}.jsonl`);
		while (existsSync(target)) {
			n += 1;
			target = join(this.logsDir, `agent-attention-${stamp}.${n}.jsonl`);
		}
		renameSync(base, target);
	}

	private pruneOldFiles(): void {
		// Compare by *local* calendar date so retention boundaries line up with
		// the user's wall calendar (matching the local-date filename stamp) and
		// stay deterministic regardless of the time-of-day in `now()`. A file is
		// pruned when its filename date is strictly more than RETENTION_DAYS
		// days before today's local date. Both sides use a local-midnight
		// timestamp (year/month/day via the local-date `Date` constructor), so
		// the day arithmetic is in local-calendar terms, not UTC ms.
		const today = this.now();
		const todayMidnight = new Date(
			today.getFullYear(),
			today.getMonth(),
			today.getDate(),
		).getTime();
		const cutoff = todayMidnight - RETENTION_DAYS * DAY_MS;
		let entries: string[];
		try {
			entries = readdirSync(this.logsDir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const match = FILE_NAME_RE.exec(entry);
			if (!match) continue;
			const [, y, m, d] = match;
			const fileTime = new Date(
				Number(y),
				Number(m) - 1,
				Number(d),
			).getTime();
			if (fileTime < cutoff) {
				try {
					rmSync(join(this.logsDir, entry), { force: true });
				} catch {
					// Best-effort: skip files we cannot remove.
				}
			}
		}
	}

	/**
	 * Hard backstop on total disk: while the combined size of all
	 * `agent-attention-*` files exceeds {@link maxTotalBytes}, delete the
	 * genuinely-oldest file first.
	 *
	 * Eviction order (oldest-events-first, so the freshest telemetry survives):
	 *   1. oldest filename date first;
	 *   2. within a date, lower rollover index first — the logger appends to
	 *      the base file and, on hitting the per-file cap, renames the base to
	 *      the lowest free `.N`. So `.1` holds the day's oldest rolled-out
	 *      events, `.2` newer, ... and the *base* (no `.N`) holds the freshest.
	 *      Hence within a date we evict `.1`, `.2`, ..., `.N`, and the base
	 *      LAST (rank: base = +Infinity so it is the last to go).
	 *
	 * This complements (does not replace) the 7-day date prune, which remains
	 * the primary cleanup; this is purely the size hard-bound.
	 */
	private enforceTotalSizeBudget(): void {
		let entries: string[];
		try {
			entries = readdirSync(this.logsDir);
		} catch {
			return;
		}
		const files: {
			name: string;
			date: string;
			roll: number;
			size: number;
		}[] = [];
		let total = 0;
		for (const entry of entries) {
			const match = FILE_NAME_RE.exec(entry);
			if (!match) continue;
			const [, y, m, d] = match;
			// Base file (no `.N`) holds the freshest events of the day, so it
			// must be the LAST evicted within its date → rank it +Infinity.
			const rollMatch = /\.(\d+)\.jsonl$/.exec(entry);
			const roll = rollMatch
				? Number.parseInt(rollMatch[1], 10)
				: Number.POSITIVE_INFINITY;
			let size: number;
			try {
				size = statSync(join(this.logsDir, entry)).size;
			} catch {
				continue;
			}
			files.push({ name: entry, date: `${y}-${m}-${d}`, roll, size });
			total += size;
		}
		if (total <= this.maxTotalBytes) return;
		// Oldest first: older date first, then lower rollover index (base last).
		files.sort((a, b) => {
			if (a.date !== b.date) return a.date < b.date ? -1 : 1;
			return a.roll - b.roll;
		});
		for (const f of files) {
			if (total <= this.maxTotalBytes) break;
			try {
				rmSync(join(this.logsDir, f.name), { force: true });
				total -= f.size;
			} catch {
				// Best-effort: skip files we cannot remove.
			}
		}
	}
}
