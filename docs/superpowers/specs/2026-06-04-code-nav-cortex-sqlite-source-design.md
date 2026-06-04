# Code-Nav — ai-cortex SQLite Source Layer

Status: Design (approved for planning)
Date: 2026-06-04
Branch: `wip/code-nav-2026-05-30`
Related memory: `mem-2026-06-03-defer-code-nav-cortex-source-decision-66a9bd`, `mem-2026-06-04-ai-cortex-v0-13-index-contract-v3-1-per-3d9c48`

## 1. Background

ai-cortex v0.13.0 replaced its per-worktree JSON cache with a per-worktree
**SQLite store** (`<worktreeKey>.db`, WAL mode), governed by the formal
`cortex-index-contract.md` v3.1 (binding for ai-14all). The old
`<worktreeKey>.json` cache that code-nav ingests is gone — cortex transcodes
legacy JSON to `.db` in place on first read, and new indexes write `.db`.

Code-nav (branch `wip/code-nav-2026-05-30`, ~2,900 LOC + ~1,550 test LOC) is
otherwise complete and green: a renderer/monaco/nav/palette stack, a main-process
query layer (`CortexIndexService`) over an app-owned SQLite **mirror**, plus
ingest, refresh, watcher, and key-resolver. The only part the cortex migration
breaks is the **ingest source** — the read of `<key>.json`.

### Cortex v3.1 store (the new source) — relevant facts

- Path: `~/.cache/ai-cortex/v1/<repoKey>/<worktreeKey>.db` (SQLite, WAL).
  Sibling `<worktreeKey>.meta.json` sidecar remains (dashboard metadata).
- Two version numbers: `PRAGMA user_version` (store format) and
  `meta.schemaVersion` (content contract, currently `"3.1"`). Reader rule: pin
  to **major**, accept any minor at/above the one written against.
- Tables: `meta(key,value)` [camelCase keys: `schemaVersion`, `repoKey`,
  `worktreeKey`, `worktreePath`, `indexedAt`, `fingerprint`, `packageMeta`,
  `entryFiles`]; `files(path,kind,content_hash)`; `docs(path,title,body)`;
  `imports(from_path,to_path)`; `functions(qualified_name,file,line,col,
  end_line,end_col,exported,is_default_export,is_declaration_only,id)`;
  `calls(from_key,to_key,kind,site_line,site_col,site_end_line,site_end_col)`.
- Canonical function identity = `` `${file}::${qualifiedName}` `` — exactly the
  value in `calls.from_key` / `calls.to_key`. Unresolved/external calls have
  `to_key` starting with `::` (e.g. `::Set`). `functions.id` is reserved and
  empty at v3.x — do not join on it.
- Coordinates are 1-indexed, inclusive on both ends.
- For ai-14all (TS) all functions carry full ranges and all call edges carry
  site coordinates — strictly richer than the old JSON the mirror was built from.
- No FTS5 table and no `bare_name` column.

## 2. Decision

**Keep the app-owned SQLite mirror; change only the ingest *source* from
`<key>.json` (JSON.parse) to `<key>.db` (read via a new `CortexStoreReader`).**
Extend the mirror schema to carry cortex's new ranges and call sites.

### Why (not direct-query)

- **Read-availability isolation.** Live nav (cmd+click, Cmd+T) reads our own
  mirror and never contends with cortex. We read cortex's `.db` *only at refresh
  time, immediately after the `ai-cortex` CLI exits* — when cortex is not
  writing — so even the ingest read is contention-free. Direct readonly querying
  couples our availability to cortex's write lifecycle; in particular a readonly
  connection **cannot recover a WAL after a cortex crash** (`SQLITE_BUSY_RECOVERY`)
  and can stall on cortex's checkpoint/`VACUUM`.
- **Reuse.** The mirror, query layer, FTS, ranking, IPC, renderer, and tests are
  already built and green. Direct-query would mean rewriting every query, solving
  the FTS gap, and handling the recovery edge — strictly *more* work.
- **Version gate, not mirror, handles drift.** The feature hard-gates on a
  readable cortex `.db` whose `schemaVersion` satisfies `isSupportedSchemaVersion`
  (major 3, minor ≥ 1 — i.e. ≥ 3.1); older/missing cortex simply
  disables code-nav (it is a complementary power-user feature). So the mirror's
  job is isolation from cortex's write lifecycle, not drift insulation.

### Coupling model (decided)

ai-cortex stays an **external PATH binary** (no bundling). Code-nav is enabled
only when a readable cortex `.db` exists for the worktree and its
`schemaVersion` satisfies `isSupportedSchemaVersion` (major 3, minor ≥ 1, i.e.
≥ 3.1); otherwise the feature is disabled gracefully (data not available).

## 3. Architecture

```
ai-cortex CLI ──(rehydrate/index → writes <key>.db)──▶ cortex store (READ-ONLY to us)
                                                        ~/.cache/ai-cortex/v1/<repoKey>/<key>.db
                                                          │  read ONLY after CLI exits (no live contention)
                              ┌───────────────────────────▼───────────────────────────┐
                              │ CortexStoreReader  (NEW)                                │  ← sole owner of cortex v3.1 schema knowledge
                              │   readMeta()  → {schemaVersion, fingerprint, …} | null  │  ← version-gate source
                              │   readGraph() → {functions, calls, imports, files}      │
                              └───────────────────────────┬───────────────────────────┘
                              ┌───────────────────────────▼───────────────────────────┐
                              │ ingestCortexStore()  (replaces ingestCortexJson)        │  ← transform: bare_name, int ids,
                              │                                                         │     key resolution, ranges/sites, FTS
                              └───────────────────────────┬───────────────────────────┘
                                                          ▼ writes app-owned mirror
                                                        ~/.cache/ai-14all/code-nav/<repoKey>/<key>.sqlite
                              ┌─────────────────────────────────────────────────────────┐
                              │ CortexIndexService  (queries; UNCHANGED query surface)   │  ← live nav reads here, always available
                              └─────────────────────────────────────────────────────────┘
                              IPC contract / renderer / monaco / nav  — UNCHANGED
```

### Two-root cache layout (already in place)

- `cortexCacheRoot = ~/.cache/ai-cortex/v1/` (env `AI14ALL_CORTEX_CACHE_ROOT`) —
  cortex-owned; **we only read** (key-resolver sidecar scan, store reader).
- `codeNavCacheRoot = ~/.cache/ai-14all/code-nav/` (env
  `AI14ALL_CODE_NAV_CACHE_ROOT`) — app-owned; the mirror `<key>.sqlite` and its
  skip-sidecar live here. **No cross-pollution into cortex's dir.** (Confirmed in
  `electron/main/ipc.ts:692-700`.)

## 4. Components and interfaces

### `CortexStoreReader` (NEW — `electron/code-nav/source/cortex-store-reader.ts`)

Single responsibility: read cortex's v3.1 `.db`. Encapsulates all cortex-schema
knowledge so a future cortex minor touches only this file.

```ts
interface CortexStoreMeta {
  schemaVersion: string;       // e.g. "3.1"
  fingerprint: string;
  indexedAt: string;
  dirtyAtIndex: boolean;       // default false when absent
}
interface CortexGraph {
  functions: CortexFunctionRow[]; // qualified_name, file, line, col, end_line, end_col, exported, is_default_export, is_declaration_only
  calls: CortexCallRow[];         // from_key, to_key, kind, site_line, site_col, site_end_line, site_end_col
  imports: CortexImportRow[];     // from_path, to_path
  files: CortexFileRow[];         // path, kind, content_hash
}
class CortexStoreReader {
  constructor(cortexDbPath: string);
  readMeta(): CortexStoreMeta | null;   // null if file missing/unreadable
  readGraph(): CortexGraph;
}
```

Opens cortex's `.db` readonly with `busy_timeout` set (belt-and-suspenders;
reads happen post-CLI-exit so contention is near-zero). Row types live in a new
`ingest/cortex-store.ts` (replaces `ingest/cortex-json.ts`).

### Version compatibility — `isSupportedSchemaVersion` (single source of truth)

The binding v3.1 reader rule is "pin to **major**, accept any minor **at or above**
the one written against." We were written against `3.1`, so:

```ts
// SUPPORTED_SCHEMA = { major: 3, minMinor: 1 }   // written against 3.1
function isSupportedSchemaVersion(v: string): boolean {
  const [major, minor] = v.split('.').map(Number); // "3.1" -> [3, 1]
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return false;
  return major === SUPPORTED_SCHEMA.major && minor >= SUPPORTED_SCHEMA.minMinor;
}
```

Exact semantics this enforces (and that tests MUST cover):

| `schemaVersion` | Result | Why |
|---|---|---|
| `3.0` | **reject** | below the written-against minor `3.1` |
| `3.1` | accept | equals written-against |
| `3.2` (any higher minor) | accept | minor at/above written-against |
| `2.9` (any lower major) | reject | wrong major |
| `4.0` (any higher major) | reject | wrong major — requires a code update; disable until then |
| malformed / non-numeric | reject | treated as unsupported |

This predicate is the *only* place the version gate is decided; all callers
delegate to it rather than re-checking `major`.

### `ingestCortexStore(cortexDbPath, mirrorDbPath): IngestResult` (replaces `ingestCortexJson`)

```ts
type IngestResult =
  | { unavailable: true; reason: 'no-store' | 'unsupported-schema'; schemaVersion?: string }
  | { unavailable?: false; skipped: boolean; functionsCount: number };
```

### Availability marker (NEW — `electron/code-nav/source/availability-marker.ts`)

A small persisted file is the **single source of truth** the status-query layer
reads to report *why* code-nav is disabled, surviving process restarts without
any in-memory `CortexIndexService` state. It lives in the app-owned root next to
the mirror it shadows:

```
codeNavCacheRoot/<repoKey>/<worktreeKey>.unavailable.json
  { reason: 'no-cortex' | 'unsupported-schema', schemaVersion?: string, checkedAt: string }
```

```ts
type AvailabilityReason = 'no-cortex' | 'unsupported-schema';
function writeAvailabilityMarker(codeNavCacheRoot, keys, reason: AvailabilityReason, schemaVersion?: string): void;
function clearAvailabilityMarker(codeNavCacheRoot, keys): void;            // unlink if present, no-op otherwise
function readAvailabilityMarker(codeNavCacheRoot, keys): { reason: AvailabilityReason; schemaVersion?: string; checkedAt: string } | null;
```

Writers: the ingest callers (refresh + first-watch bootstrap) write the marker on
an `unavailable` result and clear it on any successful ingest. Reader:
`getWorktreeStatus`. The ingest→marker reason mapping is applied at the write
point: `no-store → no-cortex`, `unsupported-schema → unsupported-schema`.

### `CortexIndexService` (query surface UNCHANGED)

`DefinitionRow` widened with `col`, `end_line`, `end_col` (nullable);
`WorktreeStatus` widened with `available: boolean` and
`reason?: 'no-cortex' | 'unsupported-schema' | 'not-indexed'`.

`getWorktreeStatus(keys)` resolves availability in this exact order (it already
has `codeNavCacheRoot` via `opts.cacheRoot`, so it reads both the mirror and the
marker):

1. Mirror `<key>.sqlite` exists and is readable → `{ available: true, ready: true,
   dirtyAtIndex, sourceFingerprint, sourceIndexedAt }` (reads mirror `meta`, as
   today). On a successful ingest the marker has been cleared, so this case never
   coexists with a marker.
2. Else `readAvailabilityMarker(...)` returns a marker → `{ available: false,
   ready: false, reason: marker.reason }` (`no-cortex` or `unsupported-schema`).
3. Else (no mirror, no marker — never attempted) → `{ available: false,
   ready: false, reason: 'not-indexed' }`.

This replaces the prior behavior of throwing `CortexIndexNotReadyError` when the
mirror is absent; absence now resolves to a concrete `available: false` status.

### Unchanged

`cortex-key-resolver.ts` (sidecar scan — cortex kept the sidecar), `ranking.ts`,
`worktree-watcher.ts`, the entire renderer/monaco/nav/palette stack (except the
`use-worktree-status` disable path), and the IPC channel shape.

## 5. Mirror schema additions

Keep the mirror's integer-id model, `bare_name`, and `functions_fts` exactly as
today (so `CortexIndexService` and its tests don't move). Add nullable columns
and bump the mirror's own schema version.

```sql
-- functions: + col INTEGER, end_line INTEGER, end_col INTEGER
-- calls:     + site_line INTEGER, site_col INTEGER, site_end_line INTEGER, site_end_col INTEGER
-- CODE_NAV_SCHEMA_VERSION: 1 -> 2   (forces existing mirrors to rebuild on upgrade)
```

Keep `schema.ts` (inlined string) and `schema.sql` in sync, as today.

## 6. The ingest algorithm

`ingestCortexStore(cortexDbPath, mirrorDbPath)`:

1. `reader = new CortexStoreReader(cortexDbPath)`; `meta = reader.readMeta()`.
   - `meta === null` → `{ unavailable: true, reason: 'no-store' }`.
   - `!isSupportedSchemaVersion(meta.schemaVersion)` →
     `{ unavailable: true, reason: 'unsupported-schema', schemaVersion }`.
     Per §4 this accepts iff `major === 3 && minor >= 1`, so `3.0` is rejected
     (below the written-against `3.1`), `3.1`/`3.2`/… accepted, and `2.x`/`4.x`
     rejected. The gate is decided solely by `isSupportedSchemaVersion`.
2. **Skip check:** read mirror sidecar; if
   `source_fingerprint === meta.fingerprint && schema_version === 2` →
   `{ skipped: true, functionsCount }`.
3. `graph = reader.readGraph()`. Rebuild the mirror in one transaction:
   - **functions:** `bare = bareName(qualified_name)` (substring after last `::`);
     insert `(qualified_name, bare_name, file, line, exported, is_default,
     is_declaration_only, col, end_line, end_col)`; record
     `idByKey[\`${file}::${qualified_name}\`] = rowid`. `functions_fts` auto-fills
     via the existing AFTER INSERT trigger.
   - **calls:** resolve by **full-key lookup** (not re-parsing):
     - `to_bare_name = bareName(to_key)` (last `::` segment).
     - `to_id = to_key.startsWith('::') ? null : (idByKey[to_key] ?? null)`.
     - `from_id = idByKey[from_key]` (skip the row if undefined).
     - insert with `site_line, site_col, site_end_line, site_end_col`.
     - Note: full-key lookup is more robust than the old `parseCallTo` for nested
       `A::b` qualified names (a latent-bug fix).
   - **imports:** `from_path → from_file`, `to_path → to_file`.
   - **files:** copy `path, kind, content_hash`.
   - **meta:** map camelCase → snake_case: `fingerprint → source_fingerprint`,
     `indexedAt → source_indexed_at`, `dirtyAtIndex → dirty_at_index` (default 0);
     `schema_version = 2`; plus `worktree_path`, `repo_key`, `worktree_key`.
4. Write the skip-sidecar (`schema_version`, `source_fingerprint`,
   `functions_count`, `ingested_at`); return `{ skipped: false, functionsCount }`.

JS materialization (read rows into arrays, transform in JS) is chosen over
SQL `ATTACH … INSERT … SELECT` for clarity and testability; index sizes
(hundreds–tens of thousands of rows) make it inexpensive.

## 7. Refresh sequencing and the disable path

### `CortexRefreshController.doRefresh`

1. Spawn `ai-cortex rehydrate <worktreePath>` (unchanged); single-flight via the
   `running` map; await exit. **Classify the spawn outcome:**
   - `child` `error` event with `ENOENT` (ai-cortex not on PATH / not installed)
     → the **disable path**: `reconcileAvailability(... , { unavailable: true,
     reason: 'no-store' })` (→ marker `no-cortex`, emit `worktreeUnavailable`, no
     toast), then return. Not a capability the user has → not a hard error.
   - Non-zero exit code (cortex ran but failed, e.g. transient I/O) → the
     **transient path**: toast + reject as today; **no marker written** (do not
     flip the worktree to a persistent disabled state for a transient failure).
   - Exit 0 → continue to step 2.
2. `cortexDbPath = join(cortexCacheRoot, repoKey, \`${worktreeKey}.db\`)`.
3. `result = ingestCortexStore(cortexDbPath, mirrorPath)` →
   `reconcileAvailability(codeNavCacheRoot, keys, result)`. Note an **installed
   but old** cortex (CLI exits 0 but writes only `.json`, no `.db`) lands here as
   `result.unavailable.reason === 'no-store'` → marker `no-cortex` — the same
   disabled outcome as not-installed, reached through the ingest rather than the
   spawn classification.

**Shared helper — `reconcileAvailability(codeNavCacheRoot, keys, result)`** (used
by BOTH refresh and the first-watch bootstrap, so the marker discipline lives in
one tested place):
   - `result.unavailable` → `writeAvailabilityMarker(codeNavCacheRoot, keys,
     map(result.reason), result.schemaVersion)` (mapping `no-store → no-cortex`,
     `unsupported-schema → unsupported-schema`), then emit
     `code-nav:worktreeUnavailable` with the mapped status reason (no scary
     toast). The persisted marker is what lets a later `getWorktreeStatus` report
     the same reason.
   - else → `clearAvailabilityMarker(codeNavCacheRoot, keys)`, then if
     `!result.skipped` → `cortexIndex.invalidate(keys)` + emit
     `code-nav:worktreeIndexRefreshed`.

### First-watch bootstrap (`electron/main/ipc.ts:737-757`)

Reads existing cortex output to seed the mirror without spawning the CLI. Switch
from reading `<key>.json` to `<key>.db` via `ingestCortexStore`, then route the
result through the **same `reconcileAvailability` helper** as refresh — so the
bootstrap cannot silently skip marker persistence (it shares the one tested code
path): on `unavailable` the marker is written (so `getWorktreeStatus` reports the
reason); on success it is cleared. If no `.db` exists (cortex old/absent →
`no-store` → marker `no-cortex`), the worktree is left unavailable with the
marker written; the first refresh (file save → watcher → rehydrate) either
produces a supported `.db` (cortex ≥ 0.13) and clears the marker, or the worktree
stays disabled.

To make this unit-testable (the current bootstrap is inline in the large
`electron/main/ipc.ts`), **extract the bootstrap ingest into a small pure helper**
`bootstrapWorktreeMirror({ cortexCacheRoot, codeNavCacheRoot, keys, cortexIndex,
emit })` that computes `cortexDbPath`, calls `ingestCortexStore`, and delegates to
`reconcileAvailability`. `electron/main/ipc.ts` calls this helper; tests exercise
the helper directly.

### E2E ingest seam (`electron/code-nav/ipc/register.ts:140-144`)

`code-nav:e2eIngest` takes a `cortexDbPath` (was `jsonPath`) and calls
`ingestCortexStore`. Gated behind `AI14ALL_E2E`, as today.

### Feature-availability surfacing

State flow end to end:

```
ingestCortexStore → IngestResult.reason ('no-store' | 'unsupported-schema')
        │  (refresh / bootstrap map + persist)
        ▼
availability marker  <key>.unavailable.json  { reason: 'no-cortex' | 'unsupported-schema', schemaVersion?, checkedAt }
        │  (pull)                                   │  (push)
        ▼                                           ▼
getWorktreeStatus → { available, reason }     code-nav:worktreeUnavailable event
        │
        ▼
renderer use-worktree-status hides nav affordances when !available
```

- **Pull (query):** `getWorktreeStatus` resolves `{ available, reason }` via the
  three-step order in §4 — mirror present → available; else marker → its reason;
  else `not-indexed`. This is data-driven (no `ai-cortex --version` probe) and
  the authoritative state, including across restarts.
- **Push (event):** `code-nav:worktreeUnavailable` is fired on the unavailable
  transition so the UI updates without re-polling; it carries the same mapped
  reason the marker stored. The event and the marker never disagree because the
  refresh/bootstrap writes the marker *before* emitting.
- **Reason vocabularies:** `IngestResult.reason` (`'no-store'`,
  `'unsupported-schema'`) is the ingest-layer outcome; it is mapped at the write
  point to the status/marker reason the renderer consumes (`'no-cortex'`,
  `'unsupported-schema'`, plus `'not-indexed'` for the never-attempted case that
  only `getWorktreeStatus` produces). Mapping: `no-store → no-cortex`,
  `unsupported-schema → unsupported-schema`.
- The renderer keys its message off `reason` (e.g. `no-cortex`/`not-indexed` →
  "install ai-cortex ≥ 0.13 to enable code-nav"; `unsupported-schema` →
  "update ai-cortex to enable code-nav"). The exact copy is follow-up; the
  reason contract is fixed here.

## 8. Error handling

- Missing/unreadable cortex `.db` → `readMeta()` returns `null` → ingest
  `unavailable: 'no-store'` → marker `no-cortex` written → feature disabled for
  the worktree.
- `schemaVersion` fails `isSupportedSchemaVersion` (e.g. `3.0`, `2.x`, `4.x`,
  malformed) → `unavailable: 'unsupported-schema'` → marker `unsupported-schema`
  written → disabled.
- Cortex CLI **not installed / not on PATH** (spawn `ENOENT`) → disable path:
  marker `no-cortex`, no hard error toast, no reject.
- Cortex installed but **old** (CLI exits 0, writes no `.db`) → ingest `no-store`
  → marker `no-cortex` — same disabled outcome, reached via ingest.
- A **transient** CLI failure (non-zero exit; cortex ran but failed) → toast +
  reject, **no marker** (not a persistent capability gap). This is the one CLI
  failure that is *not* a disable path, and tests must keep it distinct from the
  not-installed case above.
- A successful ingest always clears any prior marker, so recovery (user installs
  / upgrades cortex, re-indexes) flips the worktree back to available with no
  stale disable state.
- Reads occur only after the CLI exits, so WAL recovery / checkpoint contention
  is not expected; `busy_timeout` covers transient locks defensively.

## 9. Testing (TDD)

- **NEW `cortex-store-reader.test.ts`** — build a cortex-shaped fixture `.db`
  programmatically (text-SQL helper `makeCortexFixtureDb`, no binary check-in);
  assert `readMeta` (including missing-file → null) and `readGraph` shapes.
- **NEW `version-compat.test.ts`** (or a `describe` block alongside the reader) —
  `isSupportedSchemaVersion` truth table, asserting the **exact** boundary:
  `3.0` → false, `3.1` → true, `3.2` / `3.10` → true, `2.9` → false, `4.0` →
  false, and malformed/non-numeric (`""`, `"3"`, `"3.x"`) → false. This is the
  required lower-minor-rejection coverage.
- **REWRITE `json-to-sqlite.test.ts` → `cortex-store-to-mirror.test.ts`** —
  bare_name derivation; key resolution for resolved / nested (`A::b`) /
  unresolved (`::x`) calls; sites carried; imports/files/meta mapped; skip on
  unchanged fingerprint; `schema_version` bump forces rebuild; and the
  `unavailable` results: `readMeta() === null` → `no-store`; `schemaVersion`
  `3.0` and `4.0` → `unsupported-schema` (asserting `3.1` is accepted at the same
  call site).
- **NEW `availability-marker.test.ts`** — `write` then `read` round-trips the
  reason + `schemaVersion`; `clear` removes it; `read` on absent → `null`; marker
  path is under `codeNavCacheRoot` (never `cortexCacheRoot`).
- **NEW `reconcile-availability.test.ts`** — the shared helper: `unavailable`
  (`no-store`/`unsupported-schema`) → writes the mapped marker + emits
  `worktreeUnavailable`, no toast; success → clears the marker + (when
  `!skipped`) invalidates + emits `worktreeIndexRefreshed`. Both refresh and
  bootstrap reuse this, so its coverage is the source of truth for marker
  discipline.
- **UPDATE `cortex-refresh.test.ts`** — `.db` path, `ingestCortexStore`, and the
  **spawn-outcome classification** explicitly:
  - cortex **not installed** (spawn `error`/`ENOENT`) → marker `no-cortex`,
    emits `worktreeUnavailable`, **no toast**, does not reject.
  - cortex **installed but old** (CLI exits 0, no `.db` produced) → ingest
    `no-store` → marker `no-cortex`, no toast.
  - **transient** non-zero exit (cortex ran, failed) → toast + reject,
    **no marker written**.
  - supported `.db` ingest → marker cleared, `worktreeIndexRefreshed` emitted.
- **NEW `bootstrap-worktree-mirror.test.ts`** — the extracted
  `bootstrapWorktreeMirror` helper: no `.db` present → writes marker `no-cortex`
  (no CLI spawned); unsupported-schema `.db` → writes marker `unsupported-schema`;
  supported `.db` → seeds the mirror **and clears any marker**. This is the
  first-watch bootstrap disable coverage the prior review flagged as missing.
- **UPDATE `ipc-register.test.ts`** — `e2eIngest` seam takes `cortexDbPath`;
  replace `__fixtures__/cortex-tiny.json` with the db-builder helper.
- **WIDEN `cortex-index-service.test.ts`** — new `DefinitionRow` fields present;
  and `getWorktreeStatus` resolution: mirror present → `available: true`; marker
  `no-cortex` present (no mirror) → `available: false, reason: 'no-cortex'`;
  marker `unsupported-schema` → `available: false, reason: 'unsupported-schema'`;
  neither mirror nor marker → `available: false, reason: 'not-indexed'`.
- **Renderer** — `use-worktree-status` test for the disable path (hides nav when
  `!available`; reason drives the message).

## 10. Scope

### In scope

The ingest source swap (JSON → cortex `.db`) via `CortexStoreReader`; mirror
schema additions for ranges and call sites (data plumbed through to
`DefinitionRow`); the version-gate and feature-disable surfacing; the two
bootstrap/e2e read-sites; tests.

### Out of scope (explicit follow-up)

Using the ranges/sites in monaco — precise definition-range highlighting and
jump-to-callsite "find references". The data is plumbed into the mirror and row
types; the provider UX changes are deferred.

### Decided choices

- Carry ranges/sites now (avoids a second schema migration later).
- Mirror stays in `~/.cache/ai-14all/code-nav/` (app-owned, already separated;
  env-overridable). No move to `userData` for this change.
- ai-cortex remains an external PATH binary; no bundling.

## 11. Affected files

New: `source/cortex-store-reader.ts` (incl. `isSupportedSchemaVersion`),
`source/availability-marker.ts`, `refresh/reconcile-availability.ts` (shared
marker-reconciliation helper), `refresh/bootstrap-worktree-mirror.ts` (extracted
testable bootstrap), `ingest/cortex-store.ts`, `ingest/cortex-store-to-mirror.ts`.
Edit: `ingest/schema.ts`, `ingest/schema.sql`, `refresh/cortex-refresh.ts`
(spawn-outcome classification; delegates marker work to `reconcileAvailability`),
`cortex-index-service.ts` (widen `DefinitionRow` / `WorktreeStatus`; marker-aware
`getWorktreeStatus`), `electron/main/ipc.ts` (calls `bootstrapWorktreeMirror`;
cortex-db path), `ipc/register.ts` (e2e seam).
Remove/replace: `ingest/cortex-json.ts`, `ingest/json-to-sqlite.ts`,
`__fixtures__/cortex-tiny.json`.
Tests: as in §9.
