# ezio Per-Event Telemetry — Consumer (file-mtime → per-event)

**Date:** 2026-06-30
**Status:** Design approved (brainstorm), pending implementation plan
**Author:** Vu + Claude (brainstorm session)
**Canonical copy:** `~/.ai-pref-nsync/local-docs/ai-14all/specs/` (this repo file is the synced mirror)
**Producer side (shipped):** ai-ezio — `docs/superpowers/specs/2026-06-30-ezio-transcript-telemetry-fields-design.md`

---

## 1. Problem

ai-14all's ezio telemetry driver is configured `timeSource: "file-mtime"`
(`services/usage/providers/ezio.ts`). It has no per-turn timestamp to read, so
the scanner stamps **every** turn in a `.record.jsonl` file with the file's
filesystem mtime. Because `.record.jsonl` is append-only and holds a whole
conversation, every turn collapses onto the file's last-write time — so daily and
weekly rollups for ezio are coarse, and wrong for any conversation that spans a
day/week boundary or is resumed.

The ezio producer change has shipped: ezio now emits a per-turn ISO-8601
`timestamp` (and a `model`) on each `.record.jsonl` row. Those fields are inert
until ai-14all reads them. This change makes ai-14all read the per-line
`timestamp` so it can time-bucket ezio tokens accurately, while staying
backward-compatible with legacy rows that have no timestamp.

## 2. Goal

Flip the ezio driver to `timeSource: "per-event"` and read the per-line
`timestamp`, so ezio tokens bucket by real turn-completion time — **without**
breaking claude/codex, corrupting the ledger on a missing/malformed timestamp, or
forcing a ledger rebuild. The `model` attribution (already parsed) starts being
populated as a side effect.

## 3. Decisions (from brainstorm)

1. **No `LEDGER_VERSION` bump / no forced rebuild.** Consistent with the producer
   spec's "no migration of historical files" non-goal. The cache is incremental:
   already-ingested lines are frozen at their recorded timestamps; only newly
   appended lines pick up per-event stamping. Legacy ezio rows (no timestamp)
   continue to bucket at file mtime via the fallback. The small "window" of rows
   written-with-timestamp but already scanned under the old driver stays coarse —
   accepted (the operator controls both deploys, so the window is tiny).
2. **mtime fallback, not reject.** claude/codex `return null` (drop the event) on
   an unparseable timestamp. ezio instead falls back to file mtime, because
   legacy ezio rows legitimately have no timestamp and rejecting would silently
   **drop historical ezio token data**. The fallback preserves it.
3. **Never emit `NaN`.** `NaN` reaching `startOfLocalDay`/`recordContribution`
   corrupts the ledger (a `"NaN"` day-key). The parser maps an absent/unparseable
   timestamp to the `0` sentinel; the scanner converts any falsy `timestampMs` to
   file mtime. No `NaN` ever reaches `ingestEvent`.
4. **Generalize the scanner fallback, keep `file-mtime` support.** The scanner
   stamps file mtime whenever `timestampMs` is falsy (not only when the driver
   capability is `file-mtime`). The `file-mtime` capability and branch stay intact
   (generic), so the change is minimal and other future drivers are unaffected.

## 4. Scope

Three source files under `services/usage/`, plus their unit tests. No change to
`ledger.ts`, `ledger-store.ts` (no version bump), `snapshot.ts`, `sweep.ts`, or
`electron/main/services/usage-worker.ts`. No `model`-parsing change — the parser
already reads `obj.model`; it simply starts being non-empty once the producer
emits it.

| File | Change |
| --- | --- |
| `services/usage/providers/ezio.ts` | `timeSource: "file-mtime"` → `"per-event"` |
| `services/usage/ezio-source.ts` | parse the per-line `timestamp`; `NaN`/absent → `0` |
| `services/usage/scanner.ts` | stamp `ch.mtime` when `timestampMs` is falsy (generalize the existing `file-mtime` branch) |

## 5. Detailed changes

### 5.1 `services/usage/providers/ezio.ts`

Flip the capability and update the comment:

```ts
// before
		timeSource: "file-mtime", // records carry no per-turn timestamp
// after
		timeSource: "per-event", // ezio rows carry a per-turn ISO-8601 timestamp
```

Everything else in the driver (`roots`, `keep`, `seedCtx`, `parseLine`) is
unchanged. `cwdSource: "dir-slug"` and the `EZIO_MARKER` pre-filter are
independent of `timeSource` and stay as-is.

### 5.2 `services/usage/ezio-source.ts`

Read the per-line `timestamp` and map it safely. Add `timestamp` to the line
shape, compute `timestampMs` from it, and refresh the now-stale comments
(`EZIO_MARKER` doc and the `timestampMs` doc).

```ts
// line shape — add timestamp
interface EzioLine {
	timestamp?: unknown;
	model?: unknown;
	usage?: EzioUsageRaw;
}
```

```ts
// inside parseEzioLine, replacing the hardcoded `timestampMs: 0`
	const t = ezioTokens(usage);
	const parsed = Date.parse(typeof obj.timestamp === "string" ? obj.timestamp : "");
	return {
		provider: "ezio",
		// Per-turn ISO-8601 instant when present; 0 sentinel for legacy rows or an
		// unparseable value — the processor (scanner) stamps file mtime for any
		// falsy timestampMs. Never NaN, so the ledger day-key is always valid.
		timestampMs: Number.isNaN(parsed) ? 0 : parsed,
		cwd: ctx.cwd,
		sessionId: ctx.sessionId,
		model: typeof obj.model === "string" ? obj.model : "",
		input: t.input,
		output: t.output,
		billable: t.billable,
		raw: t.raw,
	};
```

Update the `EZIO_MARKER` header comment, which currently asserts "ezio records
have no per-turn timestamp": ezio rows now carry one; the marker is still the
`"usage"` substring (present on every row), so the perf pre-filter is unchanged.

### 5.3 `services/usage/scanner.ts`

Generalize the mtime stamp inside `processJsonlFile`'s per-line loop:

```ts
// before
				if (fileMtime) r.event.timestampMs = ch.mtime;
// after
				// Stamp file mtime for file-mtime drivers AND for any event whose
				// parser produced a falsy timestamp (legacy ezio rows, or any row
				// missing a per-line timestamp) — so a 0/NaN never reaches the
				// ledger and timestamp-less rows still bucket sanely.
				if (fileMtime || !r.event.timestampMs) r.event.timestampMs = ch.mtime;
```

`const fileMtime = driver.capabilities.timeSource === "file-mtime";` stays. After
the flip, `fileMtime` is `false` for ezio, but `!r.event.timestampMs` catches its
legacy (timestamp-less) rows. claude/codex always produce a valid non-zero
`timestampMs` (and `return null` on `NaN`), so the new clause never changes their
behavior.

## 6. Data flow

| Row | `ezio-source` → `timestampMs` | scanner | bucketed at |
| --- | --- | --- | --- |
| New ezio row (has `timestamp`) | parsed ms (valid) | passes through | the turn's real instant |
| Legacy ezio row (no `timestamp`) | `0` | `!timestampMs` → `ch.mtime` | file mtime (as today) |
| Malformed `timestamp` | `0` (NaN mapped) | `!timestampMs` → `ch.mtime` | file mtime; **no NaN** |
| claude/codex row | valid per-event ms | unchanged | the line's instant |

## 7. Error handling & edge cases

- **NaN safety (headline).** `ezio-source` never returns `NaN` (maps it to `0`);
  the scanner converts `0`/falsy to `ch.mtime`. So `startOfLocalDay(timestampMs)`
  and `recordContribution(...)` always receive a valid number — no `"NaN"`
  day-key, no ledger corruption.
- **Window rows** (timestamp present but already ingested under the old driver):
  frozen at file mtime by the offset cache; not re-read. Accepted (no rebuild).
- **cortex `.cortex.jsonl` rows**: still skipped — they carry no `"usage"`
  substring, so `EZIO_MARKER` rejects them before parse. Unchanged.
- **Aborted/empty ezio turns** (no `usage`): already skipped by `EZIO_MARKER`.
- **`model`**: an empty `model` (no `status` seen producer-side) parses to `""`,
  exactly as today — no behavior change; populated for normal turns.

## 8. Testing (vitest; `tsconfig.test.json` typechecks test files, so keep them type-clean)

Tests live in `tests/unit/usage/`. Run: `pnpm test`. Typecheck: `pnpm typecheck`.

- **`tests/unit/usage/ezio-source.test.ts`**
  - Existing "maps a usage record … with … zero timestamp" (a row with no
    `timestamp`) still passes — `timestampMs: 0`.
  - **Add:** a row with a valid ISO `timestamp` → `timestampMs === Date.parse(iso)`.
  - **Add:** a row with a malformed `timestamp` (e.g. `"not-a-date"`) →
    `timestampMs === 0` (assert **not** `NaN`).
  - **Add/confirm:** `model` from the line passes through to the event.
- **`tests/unit/usage/scanner.test.ts`**
  - Existing "stamps ezio events with file mtime" (a no-timestamp row) still
    passes via the falsy fallback; update its description to reflect the fallback
    (not the driver capability).
  - **Add:** an ezio row **with** a per-line `timestamp`, written to a file whose
    mtime differs → the ingested event's `timestampMs` equals the per-line
    timestamp (proves per-event passthrough, not overridden by mtime).
- **`tests/unit/usage/providers.test.ts`**
  - Flip the ezio `timeSource` assertion to `"per-event"`.

## 9. Rollout & backward compatibility

This is the consumer half of an additive change; the producer has shipped. The
mtime fallback means the per-event driver works against **both** old records (no
`timestamp` → file mtime) and new records (`timestamp` → accurate buckets), so no
synchronized deploy and no rebuild are required. claude/codex/ai-cortex are
unaffected.

## 10. Risks / caveats

- **In-flight worktrees.** ai-14all has worktrees under `.worktrees/` (incl.
  `slice-2a-consume-contract-wt`, whose name suggests contract-consumption work).
  This spec is written against `master`; the implementer must reconcile against
  any overlapping branch before/while implementing, and re-confirm the exact
  `scanner.ts` / `ezio-source.ts` lines if that branch has refactored them.
- **Window rows** stay coarse (see §3.1) — acceptable by decision, not a defect.

## 11. Out of scope / non-goals

- No `LEDGER_VERSION` bump, no forced rebuild, no migration of historical files.
- No `model`-parsing change (already handled), no model-id normalization.
- No change to the ledger, snapshot, sweep, worker, or any non-ezio driver.
- No producer-side change (shipped separately in ai-ezio).

## 12. Success criteria

- ezio rows with a per-line `timestamp` bucket by real turn-completion time
  (correct daily/weekly rollups); `model` is attributed instead of blank.
- Legacy/timestamp-less ezio rows still bucket sanely (file mtime); no `NaN`
  reaches the ledger.
- claude/codex telemetry is byte-for-byte unchanged.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, and `pnpm test` are green.
