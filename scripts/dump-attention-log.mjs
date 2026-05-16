#!/usr/bin/env node
/**
 * diag:attention — read-only inspection CLI for the agent-attention
 * diagnostic JSONL log written by services/diagnostics/agent-attention-logger.ts.
 *
 * The logger is OFF by default (opt-in via AI14ALL_AGENT_ATTENTION_LOG), so the
 * log directory and files may not exist yet. A missing log directory is treated
 * as "0 events" (exit 0, note on stderr) rather than a hard error, so that
 * piping into `jq` or scripted use does not fail just because logging has not
 * been enabled for the evaluation yet.
 *
 * `_meta` preamble lines (written as the first line of each file in `full`
 * mode) are ALWAYS excluded — they are not events, must not pollute `--type`
 * filtering, and are never counted or printed.
 *
 * stdout is pure JSONL (one matching event per line) so it can be piped to
 * `jq`. The `# N events` summary is written to stderr.
 *
 * Usage:
 *   node scripts/dump-attention-log.mjs [filters]
 *   pnpm diag:attention [filters]
 *
 * Filters:
 *   --type=<classifier|mcp|lifecycle|resolution>
 *   --state=<state>
 *   --worktree=<worktreeId>
 *   --provider=<claude|codex|other>
 *   --days=N | --days N   (most recent N distinct calendar days; default 1)
 *   --dir=<path>          (override the log directory (also used by tests))
 *   --help, -h            (print this usage and exit 0)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

const USAGE = `Usage: node scripts/dump-attention-log.mjs [filters]

Filters:
  --type=<classifier|mcp|lifecycle|resolution>  filter by event type
  --state=<state>                               filter by event state
  --worktree=<worktreeId>                       filter by worktree id
  --provider=<claude|codex|other>               filter by provider
  --days=N | --days N                           most recent N distinct
                                                calendar days (default 1)
  --dir=<path>                                  override log directory
  --help, -h                                    print this help and exit

stdout is pure JSONL (pipeable to jq); the "# N events" summary and any
notes are written to stderr. "_meta" preamble lines are always excluded.`;

// agent-attention-YYYY-MM-DD.jsonl OR agent-attention-YYYY-MM-DD.N.jsonl
// Matches the same filename set as agent-attention-logger.ts's log files;
// the capture-group layout differs by design (this script needs date +
// rollover-index groups). Capture 1: the calendar date; capture 2: the
// rollover index (or undefined for the base file).
const FILE_NAME_RE = /^agent-attention-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/;

/**
 * Resolve the directory the agent-attention logger writes to, mirroring
 * Electron's `app.getPath("logs")` per platform. `plat`/`home`/`env` are
 * injectable seams so the per-OS branches stay unit-testable without
 * mocking `node:os`; they default to the real runtime values.
 */
export function logsDir(plat = platform(), home = homedir(), env = process.env) {
	if (plat === "darwin") {
		return join(home, "Library/Logs/ai-14all");
	}
	if (plat === "win32") {
		// Electron's app.getPath("logs") on Windows is <userData>/logs, and
		// userData is %APPDATA% (Roaming), NOT %LOCALAPPDATA% (Local). The
		// app-name segment is "ai-14all" (app.setName in electron/main), the
		// same segment the darwin/linux branches use.
		return join(env.APPDATA ?? "", "ai-14all/logs");
	}
	return join(home, ".config/ai-14all/logs");
}

/**
 * Parse argv into a filters object. Supports `--key=value` for all string
 * filters and BOTH `--days=N` and `--days N` for the day window. `days` is
 * always coerced to a clamped positive integer (>= 1, default 1).
 */
export function parseArgs(argv) {
	const filters = {
		type: null,
		state: null,
		worktree: null,
		provider: null,
		dir: null,
		days: 1,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--help" || a === "-h") {
			filters.help = true;
			continue;
		}
		if (a === "--days" && argv[i + 1] != null) {
			filters.days = argv[++i];
			continue;
		}
		const m = a.match(/^--([a-z]+)=(.*)$/);
		if (m && m[1] in filters) {
			filters[m[1]] = m[2];
		}
	}
	filters.days = clampDays(filters.days);
	return filters;
}

/**
 * Coerce an arbitrary `--days` value (string or number) into a positive
 * integer. Non-numeric, NaN, or < 1 inputs fall back to 1.
 */
export function clampDays(value) {
	const n = Number.parseInt(value, 10);
	if (Number.isNaN(n) || n < 1) return 1;
	return n;
}

/**
 * Given the raw filenames in the log directory and a `days` window, return
 * the files to read: every file whose calendar date is among the most recent
 * `days` distinct dates, INCLUDING all `.N` rollover parts of those dates.
 *
 * Selecting by distinct date (not by file count) ensures heavy days — which
 * roll over into multiple files and are exactly the days worth analyzing —
 * never silently lose their `.N` parts.
 *
 * Returned newest-date-first; within a date, base file before `.1`, `.2`, ...
 * so events read in a stable, roughly chronological order per date.
 */
export function selectFiles(files, days) {
	const dated = [];
	for (const f of files) {
		const m = FILE_NAME_RE.exec(f);
		if (!m) continue;
		// Base file has no rollover index; treat it as -1 so it sorts before
		// `.1`, `.2`, ... (the logger writes the base file first, then rolls
		// it out to `.N`, so the base holds the freshest events of the day).
		const roll = m[2] === undefined ? -1 : Number.parseInt(m[2], 10);
		dated.push({ name: f, date: m[1], roll });
	}
	const distinctDates = [...new Set(dated.map((d) => d.date))].sort();
	const keep = new Set(distinctDates.slice(-days));
	return dated
		.filter((d) => keep.has(d.date))
		.sort((a, b) => {
			if (a.date !== b.date) return a.date < b.date ? 1 : -1;
			return a.roll - b.roll;
		})
		.map((d) => d.name);
}

/**
 * Yield parsed events from the selected files. `_meta` lines and malformed
 * lines are skipped here so they never reach `matches()` or the count.
 */
export function* readEvents(filters, onMissingDir) {
	const dir = filters.dir || logsDir();
	let files;
	try {
		files = readdirSync(dir);
	} catch {
		if (onMissingDir) onMissingDir(dir);
		return;
	}
	for (const f of selectFiles(files, filters.days)) {
		const content = readFileSync(join(dir, f), "utf8");
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			let event;
			try {
				event = JSON.parse(line);
			} catch {
				continue; // skip malformed lines
			}
			if (event && event.type === "_meta") continue;
			yield event;
		}
	}
}

/**
 * Return true if `event` passes every active filter. `_meta` events are
 * rejected defensively (they are already filtered in `readEvents`).
 */
export function matches(event, filters) {
	if (!event || event.type === "_meta") return false;
	if (filters.type && event.type !== filters.type) return false;
	if (filters.state && event.state !== filters.state) return false;
	if (filters.worktree && event.worktreeId !== filters.worktree) {
		return false;
	}
	if (filters.provider && event.provider !== filters.provider) {
		return false;
	}
	return true;
}

export function main(argv = process.argv.slice(2)) {
	const filters = parseArgs(argv);
	if (filters.help) {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	let count = 0;
	for (const event of readEvents(filters, (dir) => {
		process.stderr.write(
			`# no log directory at ${dir} (logging not enabled yet?)\n`,
		);
	})) {
		if (matches(event, filters)) {
			process.stdout.write(`${JSON.stringify(event)}\n`);
			count++;
		}
	}
	process.stderr.write(`# ${count} events\n`);
	return 0;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
	process.exit(main());
}
