# Agent Token Telemetry (Claude + Codex) — Design

Date: 2026-05-27
Status: Approved (pending implementation plan)
Scope: macOS desktop app `ai-14all`. No new runtime dependencies.

## Goal

Show how much agents are being used, per worktree and globally, and warn when
approaching the rolling usage limits. Track both **Claude** and **Codex** by
reading the data their CLIs already write to disk — no tokenization by us, no
new dependency.

## Decisions

| Topic              | Decision                                                                       |
| ------------------ | ------------------------------------------------------------------------------ |
| Providers          | Claude **and** Codex                                                            |
| Data source        | The agents' own on-disk session logs (no API, no new dep)                      |
| Token metric       | **Show both**: billable (primary) + raw (secondary)                            |
| Strip number       | Current worktree, **since app launch**                                         |
| Limit signal       | Codex = real `rate_limits`; Claude = budget proxy (no real limit on disk)      |
| Strip placement    | Session info strip (top bar), two stacked rows: **claude over codex**          |
| Strip gauge style  | Mini progress bars + % (style A)                                               |
| Provider colors    | Existing tokens: `--provider-claude #e58a5e`, `--provider-codex #5a9bd6`       |
| Breakdown          | Popover from `▾`: grouped by workspace, scope control, untracked toggle        |
| Cost               | Out of scope — this is usage telemetry, not spend. Token tally only.           |
| Enable/disable     | Master on/off setting (default on) → zero cost when off                        |

## Data Sources (verified against real files)

### Claude — `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`

Each `type:"assistant"` line carries:

```
timestamp, cwd, sessionId, message.model,
message.usage { input_tokens, output_tokens,
                cache_creation_input_tokens, cache_read_input_tokens }
```

Per-message (not cumulative) → sum across messages. No limit data on disk.

### Codex — `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`

- First line `type:"session_meta"` → `payload.cwd` (the worktree path).
- `type:"event_msg"`, `payload.type:"token_count"` →
  - `payload.info.last_token_usage` (per-turn **delta**) — use this for summation.
    `payload.info.total_token_usage` is cumulative; do **not** sum it.
    Fields: `input_tokens, cached_input_tokens, output_tokens,
    reasoning_output_tokens, total_tokens`.
  - `payload.rate_limits`:
    - `primary { used_percent, window_minutes: 300, resets_at }` — 5-hour window
    - `secondary { used_percent, window_minutes: 10080, resets_at }` — weekly
    - `plan_type`
  - `turn_context` lines carry `model` / `cwd` (fallback for cwd).

The latest `rate_limits` seen (newest rollout's last `token_count`) IS the live,
account-wide Codex limit gauge — exact, no proxy.

Scale on the design machine: Claude ≈ 984 files / 306 MB (largest 56 MB); Codex
≈ 219 files / 258 MB (largest 28 MB). **A full re-scan per launch is forbidden.**
Never read Codex's `logs_*.sqlite` (205 MB) — only the small jsonl rollouts.

## Token Metrics

- **Billable** (primary): `input + output + cache_creation`, **excludes** cache
  reads. For Codex: `total_tokens − cached_input_tokens`. Reflects real work.
- **Raw** (secondary): billable + cache reads (Codex: `total_tokens`). Big
  numbers (~10×), shown dimmed.
- Display format: `0.7M / 12.9M (raw)`.

`session-meta` and `stats-cache.json` are rejected: stale (digest, not live).

## Limit Signal

- **Codex** → real `used_percent` for 5h (`primary`) and weekly (`secondary`) +
  `resets_at` countdown.
- **Claude** → budget proxy: rolling billable sums in 5h / 7-day windows vs
  configurable `fiveHourBudget` / `weeklyBudget`. Defaults seeded from
  `.credentials.json` `rateLimitTier` (`default_claude_max_5x` → weekly ≈ 9M, per
  the user's observed 100%-at-~9M data; max-20x ≈ ~30M). 5h budget default is a
  tunable placeholder. Approximate by design.
- Threshold colors: green → amber → red. Codex and Claude gauges are independent
  of the "since launch" totals (different quantities).

## UI

### Strip chip (session info strip, top bar)

Two stacked rows, small monospace, columns aligned:

```
                                  tokens (bill / raw)     5h          week
claude   2.1M / 18.4M (raw)       ▮▮▱▱▱ 12%   ▮▮▱▱▱ 28%
codex    0.7M / 12.9M (raw)       ▮▱▱▱▱  3%   ▮▮▮▮▱ 41%   ▾
```

- claude row above codex row; colors `--provider-claude` / `--provider-codex`.
- tokens = current worktree, since launch (billable primary, raw dimmed).
- 5h / week = mini progress bars + %. Codex real, Claude budget.
- `▾` opens the breakdown popover.

### Breakdown popover

- **Account limits** section: Codex (5h %, reset; weekly %, reset) and Claude
  (5h budget %, weekly budget % with `used / budget`).
- **Controls**: scope segmented `Active | All tracked` (default **Active** =
  worktrees open in the app now; All tracked = every worktree ever) + an
  `include untracked` toggle.
- **Table grouped by workspace (repo)**: each workspace is a header row with a
  subtotal (collapsible); worktree·agent rows indent beneath. Columns: `session
  (bill / raw)` (since launch) and `this week` (rolling 7d). For the All-tracked
  view, "this week" carries the signal (since-launch is often 0).
- `include untracked` ON → all cwds never opened in ai-14all collapse into one
  `other (untracked)` workspace row, folded into the total. OFF → excluded.
- **Footer**: `total = Σ rows` (billable, raw), reflecting scope + toggle. Token
  tally, not cost. `⚙ budget settings` opens the Claude budget config.

## cwd → worktree / workspace mapping

The app already knows each workspace (repo) and its worktree paths. Match the
transcript/rollout `cwd` to a worktree → roll up to its workspace. Codex cwd from
`session_meta` (fallback `turn_context`); Claude cwd per line. Unmatched cwd =
"untracked".

## Performance Architecture (core of this design)

1. **Off-main-thread.** All file IO + parsing runs in an Electron
   **`utilityProcess`** (built-in, no dep). Main and renderer never block.
2. **Incremental, never re-read.** Persisted index in app `userData`: per file
   `{ byteOffset, mtime }`. Read only appended bytes since last offset.
3. **One-time historical backfill** is chunked + throttled (N files per tick with
   `setImmediate` yields) and persisted, so it's paid once.
4. **Cheap pre-filter.** Stream line-by-line; `JSON.parse` only lines containing
   the marker substring (`"usage"` for Claude, `"token_count"` for Codex).
5. **Codex shortcut.** Totals need only the last `token_count` per rollout
   (cumulative); the live limit gauge needs only the newest rollout's last
   `token_count`. Avoid scanning every event.
6. **Watch dirs, not files.** `fs.watch` the few recent project/session dirs,
   debounced ~1.5 s, then tail only changed files. No per-file watchers.
7. **Memory-bounded aggregates.** Keep counters + a ring buffer of time buckets
   (5-min buckets × 7 days = 2016 buckets). Discard raw lines after folding.
8. **Throttled live viz.** Push aggregate snapshots to the renderer on debounced
   change (~1–2 s cap), never per line. Renderer draws CSS bars — no chart lib.
9. **Bounded windows.** Live gauges scan only files with mtime in the last 7 days;
   lifetime/per-worktree totals come from the persisted index, not re-scans.
10. **Master toggle.** When telemetry is disabled, the utilityProcess and watchers
    are never started — zero cost.

## Architecture / Modules

- `services/usage/` (new):
  - `claude-source.ts`, `codex-source.ts` — provider adapters (streaming parse,
    offset cache, marker pre-filter).
  - `aggregator.ts` — per-cwd / per-worktree / per-workspace totals, global total,
    rolling 5h / 7-day ring buckets.
  - `budget.ts` — Claude budget config + proxy %; Codex passthrough of real %.
- Main process: utilityProcess host + IPC wiring (`electron/main/ipc.ts`,
  `electron/preload/index.ts`).
- Contracts/models: `shared/contracts/events.ts` (+ usage snapshot contract),
  `shared/models/usage.ts` (new).
- Renderer: telemetry strip component + popover under `src/features/…`,
  styles in `src/app/shell.css` (reuse `--provider-*` vars).
- Settings: master on/off + Claude budgets persisted in workspace/app settings.

## Reference Tool

`scripts/codex-usage.mjs` (committed) — a manual diagnostic that parses Codex
rollouts and prints daily/by-model totals + latest limit status. It validates the
field paths and serves as a **test fixture reference**. Its IO model (read every
file fully) is a one-off CLI pattern and is **not** what ships; the app uses the
streaming / incremental / utilityProcess design above.

## Edge Cases

- Missing `~/.claude` or `~/.codex` → that provider absent, no crash.
- Trailing partial line during live append → tolerate `JSON.parse` failure.
- Codex event missing `last_token_usage` → skip (do not fall back to cumulative
  when summing).
- Clock/timezone → bucket by event UTC timestamp.
- Large initial backfill → chunked + throttled; never pegs a core or blocks UI.
- Many tracked worktrees → scope control defaults to Active; All-tracked is opt-in.
- cwd not matching a known worktree → counts toward global; surfaced only when
  `include untracked` is on.

## Testing

- **Unit (vitest):** parse fixtures (sampled from real Claude/Codex jsonl, via the
  reference tool) → assert billable/raw math, Codex `last_token_usage` summation,
  Codex `rate_limits` extraction, Claude budget %, rolling-window bucketing,
  cwd→worktree mapping, untracked bucketing.
- **Incremental offset:** appending bytes yields only the delta; re-open from
  persisted offset produces identical totals.
- **Perf guard:** backfill over a large fixture set stays within a time budget and
  off the main thread.
- **Renderer:** strip rows + popover render from a snapshot; scope/untracked
  toggles change rows + total; threshold colors map correctly.

## Files Touched

`services/usage/*` (new), `electron/main/ipc.ts`, `electron/preload/index.ts`,
utilityProcess host (new under `electron/main`), `shared/contracts/events.ts`,
`shared/models/usage.ts` (new), renderer telemetry strip + popover
(`src/features/…`), `src/app/shell.css`, app/workspace settings,
`scripts/codex-usage.mjs` (added) + tests + fixtures.

> 3 files → the implementation plan will split this into discrete tasks.
