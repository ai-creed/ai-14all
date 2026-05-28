# Code Navigation MVP Design

## Purpose

This spec defines the first iteration of in-app code navigation for `ai-14all`. It enables a reviewer to jump between code locations (definitions, references, file paths) inside the review chrome and the inline editor without leaving the app and without bringing in a full IDE.

The navigation surface is powered by reading the existing `ai-cortex` symbol index from disk, mirrored into a per-worktree SQLite database, and wired into Monaco's built-in navigation providers.

## Problem

Reviewing changes today requires constant context switching. When a diff shows a call to `foo()`, there is no in-app way to jump to the definition of `foo`. The same is true for inspecting callers, finding a symbol by name, or following a path reference embedded in diff text.

The user wants a lightweight nav layer that:

- works inside the Monaco-backed `DiffViewer` and `InlineEditor`
- supports jump-to-definition, find references, document-link click-through, and a fuzzy workspace symbol palette
- handles ~8k-file projects without holding the full index in memory
- stays in sync with code changes made by editors and coding agents, but only spends resources when the review chrome is actually being used

## Non-goals

This MVP does **not**:

- ship a custom language server or run any LSP
- index symbol references for non-call usages (variable reads, argument passes) — out of scope until `ai-cortex` exposes them
- support cross-worktree navigation
- persist navigation history across app restarts
- implement rename, type-definition, implementation, or declaration providers
- replace the existing editor or diff implementations
- expose configuration UI for nav behavior (keybindings, ranking) — hard-coded defaults only

## Inputs from ai-cortex

`ai-cortex` already produces a per-worktree JSON index at:

```
~/.cache/ai-cortex/v1/<repoKey>/<worktreeKey>.json
```

A spike confirmed that schema v3 captures:

- `functions[]` — `{ qualifiedName, file, line, exported, isDefaultExport, isDeclarationOnly? }`
- `calls[]` — `{ from: "file::func", to: "file::func" | "::bareName", kind }`
- `imports[]` — `{ from, to }` resolved at file level
- `files[]` — `{ path, kind, contentHash? }`
- `fingerprint` (HEAD commit), `worktreePath`, `repoKey`, `worktreeKey`, sidecar `.meta.json` for cheap freshness checks

Known limitations of the current schema, accepted as constraints of this MVP:

- `calls[]` stores no callsite line or column, so cursor-on-callsite resolution falls back to identifier-name lookup against `functions[]`
- `functions[]` stores only a start line, so peek hover cannot render the function body without rereading the file
- non-call symbol references (variable reads, argument passes) are not captured

Two upstream `ai-cortex` issues have been queued for follow-up to address the first two limitations. The MVP design is correct without them; it gains precision when they land.

## High-level approach

A new `code-nav` feature module spans the Electron main and renderer processes.

The **main process** owns SQLite (via `better-sqlite3`, the first native module dependency for `ai-14all`). It loads and refreshes one DB per active worktree, exposes a typed IPC surface for queries, and runs the file watcher that triggers `ai-cortex` refreshes.

The **renderer process** registers Monaco providers (`DefinitionProvider`, `ReferenceProvider`, `DocumentLinkProvider`), implements the cross-file navigation router and history stack, and renders the workspace symbol palette.

Monaco supplies the navigation UX (cmd+click affordance, peek widget, references panel, picker for ambiguous results). The new module's responsibilities are limited to: data access, cross-file routing, navigation history, the workspace symbol palette, and hygiene.

## Architecture

### Process and module split

```
electron/code-nav/
  cortex-index-service.ts        -- holds per-worktree DB handles, dispatches queries
  ingest/
    schema.sql                   -- CREATE TABLE statements (CODE_NAV_SCHEMA_VERSION = 1)
    json-to-sqlite.ts            -- one-shot ingestion of a cortex JSON snapshot
  watch/
    worktree-watcher.ts          -- chokidar + debounced cortex CLI refresh
  ipc/
    register.ts                  -- ipcMain handlers; typed channel names

src/features/code-nav/
  ipc/                           -- typed renderer-side IPC client wrappers
  monaco/
    definition-provider.ts
    reference-provider.ts
    document-link-provider.ts
    register.ts                  -- one-time global registration on Monaco ready
  nav/
    nav-router.ts                -- intercepts cortex:// URI opens, swaps main pane
    nav-history.ts               -- per-worktree back/forward ring buffer
  palette/
    SymbolPalette.tsx            -- cmd+T modal
    use-symbol-search.ts
  hooks/
    use-cortex-readiness.ts      -- subscribes to ingest/refresh state
  CodeNavHygiene.tsx             -- mounts watcher when review chrome is expanded
```

The renderer module never imports `better-sqlite3`. All data access flows through IPC.

### Lifecycle of a single navigation

1. User cmd+clicks `foo()` in a Monaco editor.
2. Monaco fires `DefinitionProvider.provideDefinition(model, position)`.
3. The provider extracts the word and the model's file URI, then calls IPC `findDefinitions({ workspaceId, worktreeId, name, callerFile })`. The renderer never sends raw worktree paths; the main process resolves the worktree via `WorkspaceRegistryService.get(workspaceId)` + `WorktreeService.findWorktree(repository, worktreeId)` before any filesystem or SQLite access (mirrors `files:*` and `git:*` handlers in `electron/main/ipc.ts`).
4. The main process runs a prepared SQLite statement against `functions`, ranks the rows (see Ranking), and returns 0..N `Location` records with a custom `cortex://nav/<worktreeKey>/<encoded-path>` URI.
5. Monaco's built-in picker handles N>1; the chosen URI bubbles up to `IOpenerService`.
6. The `NavRouter` intercepts `cortex://nav/*` opens, pushes the current location to `NavHistory`, and dispatches a `session/selectFileAtLocation` action (see Selection action extension) that swaps the main pane to `<InlineEditor>` for the target file with `revealLine` set.
7. `<InlineEditor>` mounts, calls `editor.revealLineInCenter(line)`, sets the cursor, and renders a transient highlight decoration (~600 ms).

## SQLite data layer

### File location

`~/.cache/ai-14all/code-nav/<repoKey>/<worktreeKey>.sqlite`

`repoKey` and `worktreeKey` are read straight out of the cortex JSON (do not recompute). A sidecar `<worktreeKey>.meta.json` mirrors `source_fingerprint`, our `schema_version`, and `ingested_at` for cheap mtime + JSON freshness checks before opening the DB.

### Schema (`CODE_NAV_SCHEMA_VERSION = 1`)

```sql
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- keys: schema_version, source_fingerprint, source_indexed_at, ingested_at,
--       worktree_path, repo_key, worktree_key

CREATE TABLE functions (
  id INTEGER PRIMARY KEY,
  qualified_name TEXT NOT NULL,
  bare_name TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  exported INTEGER NOT NULL,
  is_default INTEGER NOT NULL,
  is_declaration_only INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_functions_bare_name ON functions(bare_name);
CREATE INDEX idx_functions_qualified_name ON functions(qualified_name);
CREATE INDEX idx_functions_file ON functions(file);

CREATE TABLE calls (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL,
  to_id INTEGER,                    -- nullable: NULL when cortex stored "::bareName"
  to_bare_name TEXT NOT NULL,
  kind TEXT NOT NULL,               -- 'call' | 'new' | 'method'
  FOREIGN KEY (from_id) REFERENCES functions(id),
  FOREIGN KEY (to_id)   REFERENCES functions(id)
);
CREATE INDEX idx_calls_from_id       ON calls(from_id);
CREATE INDEX idx_calls_to_id         ON calls(to_id);
CREATE INDEX idx_calls_to_bare_name  ON calls(to_bare_name);

CREATE TABLE imports (
  id INTEGER PRIMARY KEY,
  from_file TEXT NOT NULL,
  to_file TEXT NOT NULL
);
CREATE INDEX idx_imports_from_file ON imports(from_file);
CREATE INDEX idx_imports_to_file   ON imports(to_file);

CREATE TABLE files (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL,               -- 'file' | 'dir'
  content_hash TEXT
);

CREATE VIRTUAL TABLE functions_fts USING fts5(
  qualified_name, bare_name, file,
  content='functions', content_rowid='id',
  tokenize='trigram'
);
CREATE TRIGGER functions_ai AFTER INSERT ON functions BEGIN
  INSERT INTO functions_fts(rowid, qualified_name, bare_name, file)
    VALUES (new.id, new.qualified_name, new.bare_name, new.file);
END;
CREATE TRIGGER functions_ad AFTER DELETE ON functions BEGIN
  INSERT INTO functions_fts(functions_fts, rowid, qualified_name, bare_name, file)
    VALUES ('delete', old.id, old.qualified_name, old.bare_name, old.file);
END;
```

FTS5 with the `trigram` tokenizer gives reasonable substring and typo-tolerant ranking for the workspace symbol palette without writing a fuzzy matcher. `better-sqlite3` ships FTS5 enabled.

### Ingestion (`json-to-sqlite.ts`)

1. Read the cortex JSON fully (~15 MB for an 8k-file project; streaming optimization can come later).
2. If a SQLite file already exists at the target path and its `meta.source_fingerprint` matches the JSON's `fingerprint` and `meta.schema_version` matches `CODE_NAV_SCHEMA_VERSION`, skip ingest.
3. Otherwise, inside one `BEGIN IMMEDIATE` transaction:
   - Drop and recreate the tables (simpler than diffing for MVP).
   - Insert `functions`, building an in-memory `qualifiedName -> id` map.
   - Insert `calls`. Parse the stored `to` string; resolve `"file::name"` to `to_id` via the map. Store `to_bare_name` always (the segment after `::`). For unresolved `"::bareName"`, set `to_id = NULL`.
   - Insert `imports`, `files`.
   - Stamp all `meta` rows.
4. Commit. Update sidecar `.meta.json`.

Expected runtime: 200–500 ms native for ~80k calls and ~12k functions.

### Query API (main process, surfaced via IPC)

Every RPC accepts identifier-only `{ workspaceId, worktreeId, ... }` payloads (zod-validated). The handler resolves the on-disk path server-side via `WorkspaceRegistryService.get(workspaceId)` + `WorktreeService.findWorktree(repository, worktreeId)` — renderers never supply raw filesystem paths. This matches the existing `files:*` and `git:*` IPC trust boundary in `electron/main/ipc.ts`.

| RPC | Behavior |
|---|---|
| `findDefinitions({ workspaceId, worktreeId, name, callerFile? })` | `SELECT * FROM functions WHERE bare_name = ? OR qualified_name = ?`, then the ranking heuristic (see below) is applied **server-side in `cortex-index-service`** before the response is returned. The renderer receives an already-ranked list. |
| `findCallees({ workspaceId, worktreeId, fnId })` | `SELECT f.* FROM calls c JOIN functions f ON c.to_id = f.id WHERE c.from_id = ?` plus `SELECT to_bare_name FROM calls WHERE from_id = ? AND to_id IS NULL` for unresolved callees. |
| `findCallers({ workspaceId, worktreeId, fnId })` | `SELECT f.* FROM calls c JOIN functions f ON c.from_id = f.id WHERE c.to_id = ?` |
| `searchSymbols({ workspaceId, worktreeId, query, limit })` | `SELECT f.* FROM functions_fts JOIN functions f ON f.id = functions_fts.rowid WHERE functions_fts MATCH ? ORDER BY rank LIMIT ?` |
| `getFileImports({ workspaceId, worktreeId, file })` | `SELECT to_file FROM imports WHERE from_file = ?` |
| `refreshWorktree({ workspaceId, worktreeId, changedFiles? })` | Spawn cortex CLI; re-ingest on sidecar bump. Emits `WorktreeIndexRefreshed`. |
| `watchWorktree({ workspaceId, worktreeId })` / `unwatchWorktree(...)` | Lifecycle of `worktree-watcher`. |

### Ranking heuristic (`findDefinitions`)

Applied in `cortex-index-service` (Electron main process) before returning to the renderer. The renderer must never re-rank; tests for ranking target `cortex-index-service` directly.

1. Exact `qualified_name` match (handles `Class.foo` queries) → highest.
2. `bare_name` match where the candidate's `file` is listed in `getFileImports(callerFile)` (transitive depth 1) → second.
3. `bare_name` match in the same directory as `callerFile` → third.
4. `bare_name` match elsewhere in the worktree → lowest.

`is_declaration_only` candidates are demoted within their tier so implementations win over C/C++ forward declarations when both exist.

If exactly one candidate survives at the top tier with no peers, Monaco auto-jumps. Otherwise, Monaco renders its native multi-location picker.

## Monaco providers

### Registration

`features/code-nav/monaco/register.ts` runs once via `@monaco-editor/react`'s `beforeMount`. It registers all three providers for the following Monaco language IDs:

```
const LANGS = ['typescript', 'javascript', 'python', 'c', 'cpp'];
```

These are Monaco core language IDs. `ai-14all`'s existing `languageForBasename` (`InlineEditor.tsx`) and `languageFromPath` (`DiffViewer.tsx`) already map `.ts`/`.tsx` → `typescript` and `.js`/`.jsx`/`.mjs`/`.cjs` → `javascript`. As part of this work the mappers gain `.c`/`.h` → `c` and `.cpp`/`.cc`/`.cxx`/`.hpp` → `cpp` so cortex's C/C++ coverage is reachable from a Monaco editor.

Providers read the active worktree at call time. The renderer keeps a single mutable `ActiveWorktreeRef` populated by the existing workspace-state pipeline that already drives `activeWorktree` props in `App.tsx`/`ReviewArea`. This avoids re-registering providers per worktree switch.

### Provider-level caching

Each provider memoizes results by `(worktreeId, modelVersionId, position)` with a 30-second TTL. Caches are invalidated on a `WorktreeIndexRefreshed` event.

### `DefinitionProvider`

Reads `model.getWordAtPosition(position)`, calls `findDefinitions`, returns `Location[]` with `Uri` of the custom scheme `cortex://nav/<worktreeKey>/<encoded-relative-path>`. Range is `Range(line, 1, line, 1)` because cortex stores only the start line.

### `ReferenceProvider`

Returns callers when the identifier under the cursor is a definition site (start-of-function line, identifier matches `functions.qualified_name`). For non-definition cursor positions it returns an empty array; Monaco then shows "No references found". This is deliberate to avoid surprising results from name-only resolution. Callee browsing is deferred to a future panel.

### `DocumentLinkProvider`

Registered for `['*']`. Scans `model.getValue()` for patterns matching `path[:line[:col]]`. Each match resolves against the active worktree root; only matches that map to files known in the `files` table become links. Returns `cortex://nav/...` URIs.

### Intentionally not registered

`HoverProvider`, `WorkspaceSymbolProvider` (Monaco has no such API), `ImplementationProvider`, `DeclarationProvider`, `TypeDefinitionProvider`, `RenameProvider`. Each can be added later when the upstream cortex schema (or local heuristics) supports it.

## Cross-file navigation router

### Why a router is needed

Monaco's built-in editor-open request, fired by go-to-def, peek "open in editor", and DocumentLink clicks, normally swaps the model inside a single Monaco instance. `ai-14all` renders a fresh Monaco per file inside `<InlineEditor>` and `<DiffViewer>`. Without interception, Monaco's own router would attempt to open the model in the same editor instance and bypass the app's pane layout entirely.

The router intercepts opens of the `cortex://nav/*` scheme and short-circuits to our `NavRouter`. The exact Monaco hook is to be confirmed during implementation; candidates in order of preference:

1. `monaco.editor.registerEditorOpener({ openCodeEditor })` if available in `monaco-editor@0.55` (clean, public API).
2. Override `editor._codeEditorService.openCodeEditor` on each editor mount (semi-private but stable in this Monaco line).
3. Intercept the DefinitionProvider result earlier by handling cmd+click on the editor's mouse-down events ourselves and short-circuiting before Monaco fires its open-editor command (most defensive, more code).

Whichever integration point is used, only `cortex://` URIs are handled; all other URI schemes fall back to Monaco's default behavior.

### `NavRouter`

```ts
interface NavTarget {
  workspaceId: string;
  worktreeId: string;
  file: string;       // relative to worktree root
  line: number;       // 1-indexed
  column?: number;
  source: 'definition' | 'reference' | 'link' | 'palette' | 'history';
}

class NavRouter {
  async navigate(target: NavTarget, opts?: { pushHistory?: boolean }): Promise<void>;
  back(worktreeId: string): Promise<void>;
  forward(worktreeId: string): Promise<void>;
}
```

Behavior:

- Always scopes to the active worktree. If the target's `(workspaceId, worktreeId)` differs from the active worktree's identifiers, the router refuses and surfaces a toast. Cross-worktree nav is out of scope.
- On navigate: capture the current main-pane location, push to `NavHistory.back`, clear `NavHistory.forward`, then dispatch a new action `session/selectFileAtLocation { relativePath, revealLine, revealColumn?, transient }` via the existing workspace-state reducer.
- `transient` is `true` when `source === 'definition'`; this marks the pane as a preview, so subsequent jumps replace it in place rather than stacking, until the user edits or pins it.
- Same-file jumps skip the dispatch and call `editor.revealLineInCenter` plus a transient highlight decoration only.

### Selection action extension

The existing reducer (`src/features/workspace/logic/workspace-state.ts`) already handles `session/selectFile { relativePath }` which sets `reviewMode: "files"`, `viewerMode: "file"`, and `selectedFilePath`. We add a sibling action `session/selectFileAtLocation { relativePath, revealLine, revealColumn?, transient }` that does the same plus stamps a one-shot `pendingReveal` field on the session: `{ line, column?, capturedAt }`. `<InlineEditor>` reads `pendingReveal` on mount or on `selectedFilePath` change, calls Monaco's reveal APIs, then dispatches `session/consumePendingReveal` to clear it (mirrors the existing `pendingCommentJump` pattern in `App.tsx`). `transient: true` sets a sibling `paneTransient` boolean that the pane swap logic uses to replace in place rather than push history on the next jump.

### `NavHistory`

Per-worktree, in-memory, ring buffer of capacity 50. Two stacks (`back`, `forward`) per worktree, keyed by `worktreeId`. `push` clears `forward`. `back` and `forward` move an entry across stacks and return the new location. `clear(worktreeId)` runs on worktree close.

History is not persisted across app restarts.

### Keybindings

Registered through the existing `src/app/shortcut-registry.ts` (the `AppShortcut { id, label, mac, other, predicate }` table). New entries: `nav.back`, `nav.forward`, `nav.openSymbolPalette`. The registry's `targetOwnsTyping` helper already handles the case where focus is inside a non-readonly Monaco editor; the nav shortcuts must use `predicate`s that allow firing from inside readonly editors (DiffViewer is wrapped in `[data-readonly-editor]`) and still suppress when inside a plain `<input>`/`<textarea>`.

| Action | Mac | Windows / Linux |
|---|---|---|
| Go to definition (Monaco built-in) | cmd+click, F12 | ctrl+click, F12 |
| Peek definition (Monaco built-in) | opt+F12 | alt+F12 |
| Find references (Monaco built-in) | shift+F12 | shift+F12 |
| Nav back | ctrl+- | ctrl+alt+- |
| Nav forward | ctrl+shift+- | ctrl+shift+- |
| Workspace symbol palette | cmd+T | ctrl+T |

## Workspace symbol palette

A `<SymbolPalette>` modal triggered by cmd+T. Built on `@radix-ui/react-dialog` (already wrapped by `src/components/AppDialog.tsx`; reuse its `AppDialog.Title` / `AppDialog.Body` / `AppDialog.Footer` primitives for visual consistency).

### Data flow

1. User types → `useSymbolSearch(query)` debounces input for 80 ms.
2. Hook calls IPC `searchSymbols({ workspaceId, worktreeId, query, limit: 50 })`.
3. Main process runs FTS5 `MATCH` against `functions_fts` and returns rows ordered by SQLite's built-in `rank`.
4. Renderer renders the list with arrow + enter handling. Enter calls `NavRouter.navigate({ source: 'palette', ... })` and closes the modal.

### Query construction

The user's input is split into tokens, each tokenized into trigrams, then composed into an FTS5 `MATCH` string with prefix expansion. Rank-boost is applied to `bare_name` matches relative to `file` matches.

### Result row layout

```
ƒ  parseConfig            src/lib/config.ts:42      exported
ƒ  Cli.parseConfig        cli/runner.ts:88
ƒ  parseConfigSchema      schemas/config.ts:14      exported  default
```

Icon: `ƒ` for plain function, `⊕` when `qualified_name` contains a dot (method on a class), and a star marker for `is_default`. File path is right-aligned.

### Empty / loading / error states

- Empty query → alphabetical first 50 (deferred: substitute with recent history once that store exists).
- No results → "No symbols match `<query>`" plus a link to fall back to the existing file-search if present in the app.
- Index not yet ready → "Building index…" with progress bound to the ingest service state.

## Hygiene: watcher and refresh pipeline

A single `<CodeNavHygiene>` component is mounted inside the `<ReviewExpandedPortal>` body (in `App.tsx`, adjacent to `<ReviewArea>`). `<ReviewExpandedPortal>` is itself conditionally rendered on the `reviewOpen` local state in `App.tsx`, so the watcher lives only while the review chrome is open and unmounts on collapse. The component receives the active `workspaceId` and `worktreeId` as props (the same identifiers already passed to other privileged IPC handlers) and forwards them to the watcher IPC; the main process resolves the on-disk worktree path itself.

### Watcher

- One chokidar instance per active worktree, rooted at the worktree path.
- Hard-coded ignore list: `node_modules/`, `.git/`, `dist/`, `build/`, `out/`, `.next/`, `.superpowers/`, `.ai-cortex/`.
- Filtered to cortex's known extensions: `.ts .tsx .js .jsx .py .c .cpp .cc .cxx .h .hpp`.
- Events (`add`, `change`, `unlink`) are batched with a 500 ms trailing debounce.

### Refresh flow

1. Debounced batch fires → IPC `refreshWorktree({ workspaceId, worktreeId, changedFiles })`.
2. Main process spawns the `ai-cortex` CLI with an incremental flag (exact CLI invocation to be confirmed during implementation; fallback path is the MCP `index_project` tool).
3. CLI updates cortex JSON plus the sidecar `.meta.json`.
4. Main process observes the sidecar mtime via a single-file `fs.watch`. On bump, it re-runs `json-to-sqlite.ts`. If `source_fingerprint` is unchanged, ingest no-ops.
5. Main process emits `WorktreeIndexRefreshed` via IPC. Renderer invalidates provider caches and palette query cache.

### Open / close lifecycle

- SQLite handles open lazily on first nav query.
- On worktree close or review chrome collapse, handles close after a 60-second grace period to avoid churn on rapid toggle.

### Failure modes

- CLI exits non-zero → toast "Code-nav index refresh failed: `<short reason>`. Retry?". The existing SQLite remains queryable; it is simply stale.
- Cortex JSON missing for a worktree → on first nav request, toast: "Code navigation needs cortex to index this worktree. [Run now]" → spawns an initial `ai-cortex index` run with progress.
- Watcher exceeds the OS file-descriptor limit → fall back to chokidar polling mode (logged).

## Edge cases consolidated

| Case | Behavior |
|---|---|
| Cursor on identifier with no cortex defs (lib code, non-cortex lang) | Monaco shows "No definition found". User can cmd+T to fuzzy-search anyway. |
| Cursor on identifier shadowed by an inner scope | Cortex does not track scope; the global def wins. Documented limitation. |
| `obj.foo()` where multiple `foo` defs exist | `findDefinitions` returns all by `bare_name`; ranking picks the imported-file candidate if exactly one matches. Otherwise Monaco shows a picker. |
| Click `path/file.ts:42` inside a diff hunk | `DocumentLinkProvider` makes it clickable; router opens it. Paths resolve relative to the worktree root. |
| Click absolute path `/Users/x/other/foo.ts:5` outside the worktree | Toast "Path outside this worktree". No nav. |
| Worktree has uncommitted changes; cortex index is stale | Cortex sets `dirtyAtIndex: true`. Palette renders a subtle banner: "Index reflects HEAD, not working tree." with a refresh button. |
| 8k-file project, palette typing latency | FTS5 query on ~12k rows + 50-result limit returns in <10 ms native. The 80 ms input debounce is dominant. |
| Two worktrees of the same repo open concurrently | Each gets its own `<worktreeKey>.sqlite`; queries always scope by `(workspaceId, worktreeId)` and the main process resolves to the correct on-disk worktree. No cross-talk. |
| File deleted or renamed outside ai-14all | Watcher catches it; refresh; SQLite rebuilds. Stale history entries surface as "file no longer exists" toasts at jump time. |
| `is_declaration_only` C/C++ forward declarations | Demoted in `findDefinitions` so the implementation wins. |
| Cortex schema bump (v3 → v4 after upstream fixes) | Ingest detects the `cortex.schemaVersion` mismatch, wipes the SQLite, and re-ingests using the updated mapper. Supported range pinned in code. |

## Testing

### Unit

- `json-to-sqlite.ts` — fixture cortex JSONs (small synthetic plus a real `ai-14all` snapshot). Assert table contents and `meta` rows.
- Ranking heuristic — given a caller file and N candidates, assert the expected order, including `is_declaration_only` demotion.
- `NavHistory` — push, back, forward, and ring-buffer capacity behavior.
- DocumentLink pattern — table-driven cases for `path`, `path:line`, `path:line:col`, paths containing dots, plus false-positive guards for URLs and dotted decimals.

### Integration

- IPC round-trip: open a fixture worktree, call each query RPC with `{ workspaceId, worktreeId, ... }`, assert response shapes.
- IPC trust boundary: assert each `code-nav:*` handler validates its payload via zod and rejects requests that try to smuggle a `worktreePath` (or any absolute path) field. Confirm the handler resolves the worktree via `WorkspaceRegistryService.get` + `WorktreeService.findWorktree` and returns an error for unknown `workspaceId` / `worktreeId`.
- Watcher → CLI (stubbed) → ingest → emit `WorktreeIndexRefreshed`. Assert the event fires and caches invalidate.

### E2E (Playwright; extends existing suite)

- Open a fixture worktree with a known cortex index. Open `page.tsx`. Cmd+click `parseConfig`. Assert the main pane swapped to `config.ts:42`. Press nav-back. Assert return to `page.tsx`.
- Cmd+T, type `pars`, arrow-down once, enter. Assert nav.
- Diff view with `utils/foo.ts:10` inside a comment. Click it. Assert nav.

### Manual smoke per release

- Open the user's large work project (~8k files). Measure ingest time, palette typing latency, and resident memory after 30 minutes of review activity.

## Dependencies introduced

- `better-sqlite3` (first native module in `ai-14all`). Adds a prebuild step to `electron-builder.yml`; relies on the package's published prebuilt binaries for mac arm64/x64, win x64, linux x64.
- `chokidar` for filesystem watching.

No new fuzzy-match library is needed; FTS5 covers the palette.

## Out of scope, captured for follow-up

- Capturing callsite line and column in cortex `calls[]` (queued upstream issue, enables precise callsite resolution and improves caller lists).
- Capturing end-line / range on cortex `functions[]` (queued upstream issue, enables hover peek of full bodies).
- Symbol references for non-call usages (variable reads, argument passes). Requires a cortex schema extension; for now the ripgrep fallback inside the existing app file-search panel covers this gap when needed.
- Callee browsing panel (visualizes `findCallees` results). Deferred to v1.1 once the rest of nav is in use.
- Persisting navigation history across app restarts.
- Per-language overrides and richer keybinding customization.
