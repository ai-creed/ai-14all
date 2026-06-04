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
  readable cortex `.db` with `schemaVersion` major 3; older/missing cortex simply
  disables code-nav (it is a complementary power-user feature). So the mirror's
  job is isolation from cortex's write lifecycle, not drift insulation.

### Coupling model (decided)

ai-cortex stays an **external PATH binary** (no bundling). Code-nav is enabled
only when a readable cortex `.db` with `schemaVersion` major 3 exists for the
worktree; otherwise the feature is disabled gracefully (data not available).

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

### `ingestCortexStore(cortexDbPath, mirrorDbPath): IngestResult` (replaces `ingestCortexJson`)

```ts
type IngestResult =
  | { unavailable: true; reason: 'no-store' | 'unsupported-schema'; schemaVersion?: string }
  | { unavailable?: false; skipped: boolean; functionsCount: number };
```

### `CortexIndexService` (query surface UNCHANGED)

`DefinitionRow` widened with `col`, `end_line`, `end_col` (nullable);
`WorktreeStatus` widened with `available: boolean` and
`reason?: 'no-cortex' | 'unsupported-schema' | 'not-indexed'`.

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
   - `major(meta.schemaVersion) !== 3` →
     `{ unavailable: true, reason: 'unsupported-schema', schemaVersion }`.
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
   `running` map; await exit.
2. `cortexDbPath = join(cortexCacheRoot, repoKey, \`${worktreeKey}.db\`)`.
3. `result = ingestCortexStore(cortexDbPath, mirrorPath)`.
   - `result.unavailable` → emit a `code-nav:worktreeUnavailable` signal with
     `reason` (no scary toast — this is the expected "no/old cortex" path).
   - else if `!result.skipped` → `cortexIndex.invalidate(keys)` + emit
     `code-nav:worktreeIndexRefreshed`.
- A genuine CLI failure (non-zero exit that is not "old cortex") still toasts and
  rejects, as today.

### First-watch bootstrap (`electron/main/ipc.ts:737-757`)

Reads existing cortex output to seed the mirror without spawning the CLI. Switch
from reading `<key>.json` to `<key>.db` via `ingestCortexStore`. If no `.db`
exists (cortex old/absent), leave the worktree unavailable; the first refresh
(file save → watcher → rehydrate) either produces a `.db` (cortex ≥ 0.13) or the
worktree stays disabled.

### E2E ingest seam (`electron/code-nav/ipc/register.ts:140-144`)

`code-nav:e2eIngest` takes a `cortexDbPath` (was `jsonPath`) and calls
`ingestCortexStore`. Gated behind `AI14ALL_E2E`, as today.

### Feature-availability surfacing

`getWorktreeStatus` returns `available: false` + `reason` when the mirror is
missing or was marked unavailable (data-driven; no separate `ai-cortex --version`
probe). The renderer's `use-worktree-status` hides nav affordances when
`!available`. A friendlier "install ai-cortex ≥ 0.13 to enable code-nav" prompt
is optional follow-up.

The two `reason` vocabularies are intentionally distinct and the refresh layer
maps between them: `IngestResult.reason` describes the *ingest* outcome
(`'no-store'` = no readable cortex `.db`; `'unsupported-schema'` = wrong major)
and is translated to the *status* `reason` the renderer consumes
(`'no-cortex'`, `'unsupported-schema'`, `'not-indexed'`). Mapping:
`no-store → no-cortex`, `unsupported-schema → unsupported-schema`; a mirror that
is simply absent with no ingest attempt yet → `not-indexed`.

## 8. Error handling

- Missing/unreadable cortex `.db` → `readMeta()` returns `null` → ingest
  `unavailable: 'no-store'` → feature disabled for the worktree.
- `schemaVersion` major ≠ 3 → `unavailable: 'unsupported-schema'` → disabled.
- Cortex CLI not on PATH / unknown command (old cortex) → spawn error; treated as
  the disable path, not a hard error toast.
- Reads occur only after the CLI exits, so WAL recovery / checkpoint contention
  is not expected; `busy_timeout` covers transient locks defensively.

## 9. Testing (TDD)

- **NEW `cortex-store-reader.test.ts`** — build a cortex-shaped fixture `.db`
  programmatically (text-SQL helper `makeCortexFixtureDb`, no binary check-in);
  assert `readMeta` (including unsupported-schema and missing-file → null) and
  `readGraph` shapes.
- **REWRITE `json-to-sqlite.test.ts` → `cortex-store-to-mirror.test.ts`** —
  bare_name derivation; key resolution for resolved / nested (`A::b`) /
  unresolved (`::x`) calls; sites carried; imports/files/meta mapped; skip on
  unchanged fingerprint; `schema_version` bump forces rebuild;
  `unavailable` paths.
- **UPDATE `cortex-refresh.test.ts`** — `.db` path, `ingestCortexStore`, the
  `worktreeUnavailable` path (old/absent cortex → no scary toast).
- **UPDATE `ipc-register.test.ts`** — `e2eIngest` seam takes `cortexDbPath`;
  replace `__fixtures__/cortex-tiny.json` with the db-builder helper.
- **WIDEN `cortex-index-service.test.ts`** — new `DefinitionRow` /
  `WorktreeStatus` fields present.
- **Renderer** — `use-worktree-status` test for the disable path.

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

New: `source/cortex-store-reader.ts`, `ingest/cortex-store.ts`,
`ingest/cortex-store-to-mirror.ts`.
Edit: `ingest/schema.ts`, `ingest/schema.sql`, `refresh/cortex-refresh.ts`,
`cortex-index-service.ts`, `electron/main/ipc.ts` (bootstrap + cortex-db path),
`ipc/register.ts` (e2e seam).
Remove/replace: `ingest/cortex-json.ts`, `ingest/json-to-sqlite.ts`,
`__fixtures__/cortex-tiny.json`.
Tests: as in §9.
