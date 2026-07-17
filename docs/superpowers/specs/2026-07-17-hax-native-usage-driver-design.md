# ai-14all — hax-native usage driver (ezio telemetry, take 2)

- **Date:** 2026-07-17 (revised same day, review round 1)
- **Status:** Draft — pending review
- **Owner:** Vu
- **Supersedes (partially):** `2026-06-30-ezio-per-event-telemetry-consumer-design.md` (consumer-side timestamp fix; its scanner/ledger machinery is unchanged and reused here)

## 1. Context and problem

The ezio telemetry driver (`services/usage/providers/ezio.ts`) reads the ezio CLI session-recorder's durable store at `~/.local/state/ezio/sessions/**/*.jsonl`. Investigation on 2026-07-17 (memory `mem-2026-07-17-ezio-telemetry-blind-spot-whisper-9700c5`) established that this store misses nearly all real usage:

- The session-recorder is wired only in the ezio **CLI** entry points (`runStandalone`, `runOneShot`). Whisper collab mounts — the agent-launcher default — drive `@ai-ezio/harness` `Session` directly and never instantiate the recorder. Mounted sessions write **zero** usage rows.
- The record store consequently holds ~183k billable tokens all-time (17 usage rows), while the hax engine's own store shows ~84M input+output tokens for 2026-07-15 → 07-17 alone.
- The app's "ezio ≈ 1.5M" figure is ~87% a bogus 1,332,000-token output-only `gpt-5-codex` block dated 2026-06-30 (dev-era fixture in a since-deleted file, retained by the ledger's deleted-file semantics).

Since ezio **0.4.1** (2026-07-15 engine sync), the hax engine natively persists per-turn usage in its session rollouts, for **every** hax-backed session regardless of host: CLI, whisper-mounted, and subagent children (each child is its own hax process with its own rollout).

**Decision:** repoint the ezio telemetry driver at the hax native store. No ezio-side changes required.

## 2. The hax native store (verified against real data, 2026-07-17)

Root: `~/.local/state/hax/sessions/`

Layout: `<repoKeyish>.<hash16>/<ISO-stamp>_<uuid>.jsonl`, e.g.

```
Users-vuphan-Dev-ai-14all-.worktrees-dev-integration.3aa9cdcd3f8727eb/
  2026-07-17T08-50-11Z_3aa5eb43-2523-4456-b560-d5ed328f0b76.jsonl
```

Note the directory slug **preserves dots** (`ai-14all-.worktrees-…`) and carries a hash suffix — it is NOT the same slug format as `ezioSlug()` (which folds `.` to `-`). The directory name must not be used for cwd resolution.

First line of every file is a session header with an **absolute cwd**:

```json
{"type":"session","version":1,"id":"<uuid>","timestamp":"2026-07-17T08:50:11Z","cwd":"/Users/vuphan/Dev/ai-14all/.worktrees/dev-integration","provider":"codex","model":"gpt-5.6-terra","effort":"xhigh"}
```

Usage rows (one per completed turn; **no per-row timestamp**):

```json
{"kind":"turn_usage","provider":"codex","model":"gpt-5.6-terra","usage":{"input":137422,"output":580,"cached":9728,"elapsed_ms":15135,"cost_in":0.319235,"cost_cache_read":0.002432,"cost_cache_write":0.0,"cost_out":0.0087,"cost_total":0.330367,"cost_estimated":true}}
```

Verified semantics: `usage.input` **includes** `usage.cached`. Cross-check via the engine's own cost fields: `cost_in == (input − cached) × rate` and `cost_cache_read == cached × cache-rate` on multiple sampled rows.

Other row kinds (`turn_boundary`, `user`, `reasoning`, `assistant`, `tool_call`, `tool_result`) carry no usage and are ignored.

Rows lacking `turn_usage` exist in all files written before 2026-07-15; those files simply contribute no events (the store had no usage persistence before the 0.4.1 engine sync).

**Format ownership caveat:** the rollout format is owned by upstream hax (ezio's synced fork). The parser must be defensive: unknown kinds ignored, missing/malformed `usage` object → drop the line, non-numeric fields → 0 (same `n()` guard as `token-math.ts`).

## 3. Driver design

The provider identity stays **`ezio`** (an existing `AgentProviderId`; UI chips, colors, pricing, and ledger bucket keys keep working). Only the driver's source changes.

### 3.1 New parser: `services/usage/hax-source.ts`

Replaces `ezio-source.ts` as the ezio driver's line parser (see §5 for what remains of `ezio-source.ts`).

```
HAX_USAGE_MARKER  = '"turn_usage"'
HAX_HEADER_MARKER = '"type":"session"'
```

`parseHaxLine(line, ctx)`:
- Header line (`type === "session"`): mutate `ctx.cwd = header.cwd`, `ctx.sessionId = header.id`; return no event. (The scanner persists `ctx` in the offset cache, so appends resume with cwd/session intact — same threading codex uses.)
- `kind === "turn_usage"`: first validate `usage` — it must be a **plain object** (non-null, non-array; `typeof === "object"` alone admits arrays and `null`, so check both). A `turn_usage` row whose `usage` is absent, `null`, an array, or any non-object is **dropped** (no event). When `usage` is a valid object, return a `UsageEvent` with
  - `provider: "ezio"`, `model` from the row, `cwd`/`sessionId` from ctx,
  - `timestampMs: 0` — the scanner stamps file mtime for any falsy timestamp (`scanner.ts` `processJsonlFile`, falsy-timestamp fallback),
  - tokens via `haxTokens` (§3.3). An empty `usage` object is valid and yields a zero-token event; individual missing or non-numeric fields coerce to `0` via the `n()` guard.
- Anything else: `{}`.

A `user` row whose text happens to contain the marker substring parses to `kind:"user"` and falls through harmlessly — the markers are a perf pre-filter, not the classifier.

### 3.2 Driver: rewrite `services/usage/providers/ezio.ts`

```ts
export const ezioDriver: TelemetryDriver = {
  id: "ezio",
  capabilities: {
    tokenLog: true,
    storeKind: "jsonl-tree",
    timeSource: "file-mtime",   // turn_usage rows carry no per-row timestamp
    cwdSource: "in-line",        // absolute cwd from the session header
    nativeLimits: false,
  },
  roots: (home) => [join(home, ".local", "state", "hax", "sessions")],
  keep: (line) => line.includes(HAX_USAGE_MARKER) || line.includes(HAX_HEADER_MARKER),
  seedCtx: (file) => ({ sessionId: basename(file).replace(/\.jsonl$/, "") }),
  parseLine: (line, ctx) => parseHaxLine(line, ctx),
};
```

- `seedCtx` seeds a filename-derived sessionId (`<ISO>_<uuid>`) as a fallback; the header overwrites it with the protocol uuid.
- No `recoverCtx`: a file is always read from byte 0 on first contact (header captured, ctx persisted with the offset); truncation re-reads from 0. The codex-style mid-file recovery seam is not needed.
- `timeSource: "file-mtime"` is honest about granularity: with the app running, incremental scans stamp newly appended rows at near-append time; cold backfill of an old multi-day file lumps it at the file's final mtime. This matches pre-Jul-1 ezio behavior and is acceptable; per-row timestamps are an upstream ask (§7).

### 3.3 Token math: add `haxTokens` to `services/usage/token-math.ts`

```ts
export interface HaxUsageRaw {
  input?: number;   // includes cached
  output?: number;
  cached?: number;
}

export function haxTokens(u: HaxUsageRaw): TokenTotals {
  const output = n(u.output);
  const input = Math.max(0, n(u.input) - n(u.cached)); // non-cached input is billable
  return { input, output, billable: input + output, raw: n(u.input) + output };
}
```

Same shape as `codexTokens` (input-includes-cached family), different key names. `EzioUsageRaw`/`ezioTokens` are deleted with the old parser (§5).

### 3.4 cwd resolution

Events now carry an absolute cwd, so `matchCwd`'s first pass (real-path longest-prefix, same as claude/codex) applies. The `ezioSlug` second pass in `worktree-map.ts` **stays**: the persisted ledger contains historic ezio buckets keyed by dir-slug cwds from the old record store, and those still need to resolve for all-time views.

## 4. Ledger history and cleanup

Ledger contributions persist independently of whether their source files are still scanned, so switching roots is safe: old ezio history stays, new hax events accumulate under the same provider.

Backfill on first scan after the switch: all 998 existing rollout files are read from byte 0. Pre-Jul-15 files contribute nothing (no `turn_usage` rows); Jul-15+ files contribute their full usage stamped at file mtime — hours-level accurate for recent days.

**D3 — resolved: option B, a one-time surgical strip scoped to the corrupt day.** Ledger-store version bump (2 → 3) whose load-time migration does exactly three things, once:

1. **Strip the corrupt bucket by its exact observed identity.** Date-window predicates over `dayStartMs` are unsound: a persisted day key has no timezone identity, so any window wide enough to cover "local 2026-06-30 in every timezone" necessarily overlaps adjacent local days. Instead, the migration targets the **exact corrupt entry, extracted from the live ledger and verified on 2026-07-17**:

   ```ts
   // Verified against usage-ledger.json on 2026-07-17. The corrupt contribution is a
   // single bucket: totals {input:0, output:1332000, billable:1332000, raw:1332000},
   // cwd "SMOKE-perEvent-test" — the Jun-30 per-event smoke fixture's slug.
   const CORRUPT_DAY_KEY = 1782838800000; // 2026-06-30T17:00:00.000Z
   const CORRUPT_BUCKET_KEY = `SMOKE-perEvent-test${BUCKET_SEP}ezio${BUCKET_SEP}gpt-5-codex`;
   ```

   The migration deletes `days[CORRUPT_DAY_KEY][CORRUPT_BUCKET_KEY]` if present — guarded by re-parsing the key (`parseBucketKey`) and asserting `provider === "ezio" && model === "gpt-5-codex"` before deletion — and is a no-op when absent (idempotent; safe on machines that never had the corrupt file). No date arithmetic, no timezone assumptions, zero possible collateral: every other bucket key and every other day key, including `ezio`/`gpt-5-codex` history on any other date or under any other cwd, is untouched by construction.
2. **Prune retired-root offsets.** Delete offset-cache entries whose file path is under `~/.local/state/ezio/sessions/` (the retired root is never scanned again; keeping its entries is dead weight and confuses future truncation reasoning). Offsets under all other roots are untouched.
3. **Drop day entries left empty** by step 1.

Rejected alternatives:

- **(A) Leave it.** Zero code, but all-time ezio history stays inflated by 1.33M forever.
- **(C) Full rebuild** (delete ledger + offsets). Simplest, but permanently loses ledger history for *all* providers' rotated/deleted log files — too destructive.

**Known accepted overlap:** direct-CLI ezio sessions between 2026-07-15 (0.4.1) and this cutover were recorded in BOTH stores and are double-counted (~19k tokens observed, essentially the investigation's own repro runs). Not worth migration code.

## 5. What happens to the old ezio source

- `parseEzioLine`, `EZIO_MARKER`, `EzioUsageRaw`, `ezioTokens` — deleted (`ezio-source.ts` shrinks to just `ezioSlug`, or `ezioSlug` moves into `worktree-map.ts` and the file is deleted; implementer's choice, keep the export path used by `worktree-map.ts` tidy).
- `~/.local/state/ezio/sessions` is no longer scanned. The ezio-side recorder keeps writing there for CLI sessions; that store remains cortex/compaction infrastructure, not telemetry.
- Pricing: unchanged. `PROVIDER_RATE.ezio` (codex/OpenAI median) still prices the notional cost; engine-reported `cost_total` is ignored for now (§7).

## 6. Testing (TDD order)

1. **`tests/unit/usage/hax-source.test.ts`** (new; replaces `ezio-source.test.ts`): header mutates ctx (cwd + sessionId); turn_usage → event with ctx cwd, row model, `timestampMs: 0`; input-includes-cached math (`input:137422, cached:9728, output:580` → `billable 128274, raw 138002`); other kinds and malformed JSON → no event; user row containing marker text → no event. Malformed-usage contract (each its own fixture, all → **no event**): `turn_usage` with `usage` absent; `usage: null`; `usage` a string; `usage` a number; `usage` an array. Coercion contract (each → an event with the affected totals at 0): `usage: {}` → all-zero totals; non-numeric field values (string, `null`, boolean) in `input`/`output`/`cached` → that field coerced to 0 while valid siblings still count.
2. **`tests/unit/usage/token-math.test.ts`**: `haxTokens` cases incl. `cached > input` clamp (existing helper-reuse pass: mirror the `codexTokens` test structure).
3. **`tests/unit/usage/providers.test.ts`**: driver contract — roots under `.local/state/hax/sessions`, keep accepts header + usage lines and rejects a `reasoning` line, seedCtx sessionId from filename, capabilities (`file-mtime`, `in-line`).
4. **`tests/unit/usage/scanner.test.ts`**: ctx threads across two appends of the same file (header in append 1, turn_usage in append 2 → event carries header cwd); mtime stamping applied.
5. **Ledger migration test** (D3 is resolved as B, so this is unconditional): a version-2 fixture loads as version 3 with **all** of the following asserted:
   - the exact corrupt entry — bucket `CORRUPT_BUCKET_KEY` under day `CORRUPT_DAY_KEY` (1782838800000) — is gone, and that day entry is dropped when the strip leaves it empty;
   - the **same bucket key** under a different day key (e.g. `CORRUPT_DAY_KEY + 10 × 86_400_000`) survives — the strip is keyed to one day, not to a provider+model pattern;
   - the same bucket key under the **adjacent day keys** `CORRUPT_DAY_KEY ± 86_400_000` (the June-29/July-1 boundary neighbors) survives — no off-by-one-day bleed;
   - a **different-cwd** `ezio`/`gpt-5-codex` bucket under `CORRUPT_DAY_KEY` itself survives — the match is the full bucket key, not provider+model within the day;
   - other same-day buckets (other providers/models) survive;
   - a fixture **without** the corrupt entry migrates cleanly (idempotent no-op);
   - offset-cache entries whose paths sit under `~/.local/state/ezio/sessions/` are pruned, while entries under other roots (claude, codex, hax) are retained — a migration that only touches ledger buckets must fail this test.
6. **e2e — real scan path** (new test case in `tests/e2e/usage-telemetry.spec.ts`): the existing forced-snapshot test (`AI14ALL_E2E_USAGE_SNAPSHOT` seam) only covers renderer shape — it bypasses the worker, driver, parser, and roots entirely, so it cannot detect a wrong hax root or marker. Add a second test that exercises the real pipeline: seed a fixture hax store under the spec's `tempHome` (`<tempHome>/.local/state/hax/sessions/<dir>.<hash>/<ISO>_<uuid>.jsonl` with a real header line + two `turn_usage` rows), launch the app **without** the forced-snapshot env (keeping `HOME: tempHome` and `AI14ALL_USER_DATA_PATH` — the usage worker resolves roots via `os.homedir()`, which honors the `HOME` override), enable telemetry, and assert the usage popover shows an ezio row whose tokens equal the fixture's `haxTokens` math. This is the layer-level guard the snapshot seam cannot provide.

Manual verification: run the app against the real store; the ezio segment should show ~84M+ raw-scale usage for Jul 15–17 instead of ~1.5M all-time, grouped under the correct worktrees (absolute cwd → first-pass match).

## 7. Out of scope / future

- **Per-row timestamps in `turn_usage`** — upstream hax (or ezio's fork sync) ask; would let the driver flip to `timeSource: "per-event"` and make cold backfill day-accurate.
- **Engine-reported cost ingestion** (`cost_total`, `cost_estimated`) — richer than the provider-median notional pricing; needs a `UsageEvent`/ledger extension. Revisit if notional-vs-actual drift starts to matter.
- **ezio recorder architecture** (recorder lives in CLI surface, so every embedder silently loses it) — ezio-repo concern, tracked there if ever needed; engine-native usage makes it moot for telemetry.
- **Pre-2026-07-15 mounted usage** — unrecoverable; no store carried it.

## 8. Risks

- **Upstream format drift**: rollout format is hax-owned; a rename of `turn_usage`/`usage` keys silently zeroes new ezio telemetry. Mitigation: defensive parser + the manual verification step above after each engine sync that touches telemetry fields.
- **Marker false negatives**: if upstream ever emits the header without `"type":"session"` byte-for-byte, cwd falls back to nothing → events group as untracked (visible, not silent loss).
