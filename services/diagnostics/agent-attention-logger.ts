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

const DEFAULT_FILE_CAP_BYTES = 10 * 1024 * 1024;
const RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

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
	private disabled = false;

	constructor(options: AgentAttentionLoggerOptions) {
		this.logsDir = options.logsDir;
		this.mode = options.mode;
		this.now = options.now ?? (() => new Date());
		this.fileCapBytes = options.fileCapBytes ?? DEFAULT_FILE_CAP_BYTES;

		if (this.mode === "off") return;

		mkdirSync(this.logsDir, { recursive: true });
		this.pruneOldFiles();

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
		const d = this.now();
		const y = d.getUTCFullYear();
		const m = `${d.getUTCMonth() + 1}`.padStart(2, "0");
		const day = `${d.getUTCDate()}`.padStart(2, "0");
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
		// Compare by calendar date (UTC midnight) so retention is deterministic
		// regardless of the wall-clock time-of-day in `now()`. A file is pruned
		// when its filename date is strictly more than RETENTION_DAYS days
		// before today's date.
		const today = this.now();
		const todayMidnight = Date.UTC(
			today.getUTCFullYear(),
			today.getUTCMonth(),
			today.getUTCDate(),
		);
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
			const fileTime = Date.UTC(Number(y), Number(m) - 1, Number(d));
			if (fileTime < cutoff) {
				try {
					rmSync(join(this.logsDir, entry), { force: true });
				} catch {
					// Best-effort: skip files we cannot remove.
				}
			}
		}
	}
}
