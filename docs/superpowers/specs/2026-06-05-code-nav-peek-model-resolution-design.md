# Code-Nav — Definition Peek via Monaco Model Resolution

Status: Design (approved for planning)
Date: 2026-06-05
Branch: `wip/code-nav-2026-05-30`
Related memory: `mem-2026-06-05-code-nav-peek-definition-references-ux-5d25fd` (peek deferral this spec resolves),
`mem-2026-06-04-ai-cortex-v0-13-index-contract-v3-1-per-3d9c48` (ranges/call-sites now available)

## 1. Background & problem

Code navigation is powered by ai-cortex. Definition/reference results are returned to
Monaco as virtual `cortex://` locations. This breaks any Monaco feature that needs a
text **model** for a target it doesn't already have open, because standalone Monaco's
`StandaloneTextModelService.createModelReference(uri)` only returns *already-existing*
models and has no content-provider hook (unlike full VS Code). Symptoms seen in smoke:

- **Peek** widgets ("Definitions (N)") crash with `Error: Model not found` and render
  the opaque `cortex://` base64 id as the file name ("crypto name").
- Because Monaco's bundled **TypeScript/JavaScript** language service *also* answers Go
  to Definition (resolving an imported symbol to its import statement), even a normal
  cmd+click produced 2 results → Monaco opened the broken multi-result peek.

Prior stop-gaps (suppress the error; cap our provider to one result; disable the TS/JS
built-in providers) treated symptoms and did not give Monaco resolvable models. This
spec builds the real fix.

### Decided scope (from brainstorming)

In scope: **Go to Definition** (cmd+click / F12), **Peek Definition** (⌥F12), and the
**Cmd+T** symbol palette. **Find/Peek References is explicitly OUT of scope** — the
reference provider stays unregistered and the TS/JS built-in references stay off.

Behavior decisions:
- cmd+click / F12 → **jump to the top-ranked definition** (no peek), even when several
  match. ⌥F12 → **peek the full ranked list with real previews**.
- Selecting a peek entry opens it in **our viewer via NavRouter** (InlineEditor +
  nav back/forward history), consistent with cmd+click.

## 2. What we already have (inventory)

- **Structural nav** (renderer, `codeNavClient`): `findDefinitions` etc. `DefinitionRow`
  carries `file` (worktree-relative), `line`, and precise `col`/`end_line`/`end_col`
  (nullable) from the v3.1 index.
- **File text**: `files.read(workspaceId, worktreeId, relativePath)` (from
  `src/lib/desktop-client.ts`) returns content with binary/error/readonly handling —
  already used by the viewer. The cortex mirror has **no** file text (only
  `content_hash`), so previews must come from `files.read`.
- **Routing**: `monaco.editor.registerEditorOpener` / `registerLinkOpener` →
  `handleCortexResource` → `NavRouter` → `InlineEditor`. `NavRouter.navigate` already
  supports a `column` (`revealColumn`).
- **Viewer models**: `InlineEditor` mounts `@monaco-editor/react` *without* a `path`
  prop, so its model lives at an `inmemory://` URI. Our peek models will use `file://`
  URIs and therefore never collide with the viewer's models.
- **Language detection**: `languageForBasename(basename)` exists privately in
  `InlineEditor`; it will be extracted to a shared util for reuse.

## 3. Architecture

```
cmd+click / F12  ── Monaco goToDefinition ── editor option gotoLocation.multipleDefinitions:"goto"
   (JUMP)            → definitionProvider → cortex ranked defs (file:// URIs, precise ranges)
                     → jumps to defs[0] → openCodeEditor(file://abs) → nav opener → NavRouter → InlineEditor
                     (no model resolution needed on this path)

⌥F12             ── Monaco peekDefinition
   (PEEK)            → definitionProvider returns all ranked file:// locations
                     → ModelProvisioner has pre-created models (content via files.read)
                     → peek renders previews with readable names
                     → select entry → openCodeEditor(file://abs) → nav opener → NavRouter → InlineEditor

Cmd+T            ── SymbolPalette → cortex searchSymbols → NavRouter.navigate(file, line, col)
```

The new mechanism (model provisioning) is needed only for the **peek preview** path;
the jump path rides the existing opener.

## 4. Components & interfaces

### 4.1 `ModelProvisioner` (NEW — `src/features/code-nav/monaco/model-provisioner.ts`)

Sole owner of peek-target text models. Single responsibility: given a worktree file,
guarantee a resolvable Monaco model exists at its `file://` URI.

```ts
interface ModelHost {
  getModel(uri: Uri): ITextModel | null;
  createModel(content: string, language: string, uri: Uri): ITextModel;
}
type ReadResult =
  | { kind: "text"; content: string }
  | { kind: "binary" }
  | { kind: "error" };
type WorktreeRef = { workspaceId: string; worktreeId: string };

class ModelProvisioner {
  constructor(
    host: ModelHost,
    toFileUri: (worktreeId: string, relFile: string) => Uri,
    readFile: (ref: WorktreeRef, relFile: string) => Promise<ReadResult>,
    languageForBasename: (basename: string) => string,
    opts?: { cap?: number }, // default 50
  );
  // Reuse if a model already exists at the URI; else read + create.
  // Returns the URI, or null when binary/unreadable (caller omits that entry).
  ensureModel(ref: WorktreeRef, relFile: string): Promise<Uri | null>;
  disposeAll(): void; // dispose every provisioner-owned model
}
```

The provisioner is a singleton but takes the worktree ref per call (rather than binding
a worktree at construction), so an active-worktree switch needs no re-construction — just
`disposeAll()`. `readFile(ref, relFile)` adapts `files.read(ref.workspaceId,
ref.worktreeId, relFile)` to `ReadResult`.

- Tracks only **provisioner-owned** URIs in a bounded LRU (default cap 50). On overflow
  it disposes the oldest *owned* model; it never disposes a model it did not create
  (e.g. the viewer's `inmemory://` model — which it also never sees since URIs differ).
- All `files.read` / `createModel` calls are wrapped; any failure → `null`.
- The `ModelHost` and the injected functions are seams so the unit can be tested
  without a real Monaco runtime.

`ReadResult` is adapted from `files.read`'s existing return shape inside the provider
wiring (text vs binary vs error), so the provisioner stays decoupled from the IPC type.

### 4.2 `nav-file-uri` (NEW — `src/features/code-nav/nav/nav-file-uri.ts`)

Pure, dependency-light mapping used by both the provider and the opener.

```ts
function toFileUri(worktreeId: string, relFile: string): Uri;      // monaco.Uri.file(join(worktreeId, relFile))
function fromFileUri(worktreeId: string, uri: Uri): string | null; // relFile, or null if abs path is outside worktreeId
```

`worktreeId` is the absolute worktree path (per the active worktree ref). `fromFileUri`
normalizes and verifies the path is inside the worktree before stripping the prefix;
returns `null` otherwise (defensive — the opener then declines to handle it).

### 4.3 `language-for-basename` (EXTRACTED — `src/features/viewer/logic/language-for-basename.ts`)

Move `languageForBasename` out of `InlineEditor.tsx` into a shared module; `InlineEditor`
imports it (no behavior change) and the provisioner reuses it. Pure function.

### 4.4 `definition-provider` (MODIFIED)

```ts
// provideDefinition:
//  - get cortex rows (ranked, best-first) as today
//  - provision models in parallel; build file:// locations; omit unresolvable
const ref = getActiveWorktreeRef(); if (!ref) return null;
const located = await Promise.all(rows.map(async (r) => {
  const uri = await provisioner.ensureModel(ref, r.file);   // null → omit
  if (!uri) return null;
  return { uri, range: rangeFor(r) };                  // precise col/end_line/end_col, fallback (line,1,line,1)
}));
const locs = located.filter(Boolean);
// e2e seam: __codeNavTestLastDefUri = locs[0]?.uri.toString()  (now a file:// URI)
return locs;  // ALL ranked results (cmd+click jumps to [0] via the editor option; ⌥F12 peeks the list)
```

The previous `slice(0, 1)` cap is removed. The provisioner + active ref are obtained
via the renderer singletons (same pattern as `getNavRouter()`), keeping the provider's
exported shape unchanged for Monaco registration.

### 4.5 Opener (MODIFIED — `register.ts`)

`handleResource(uriString)` dispatches by scheme:
- `cortex://` → existing `decodeCortexUri` → `NavRouter.navigate` (diff links unchanged).
- `file://` → `fromFileUri(activeWorktreeId, uri)`; if non-null →
  `NavRouter.navigate({ workspaceId, worktreeId, file: relFile, line, column, source })`;
  if `null` → return `false`.
- otherwise → return `false`.

Wired through the same `registerEditorOpener` (`openCodeEditor`) and `registerLinkOpener`
already in place. For `file://`, the line/column come from the **selection/position
argument Monaco passes to `openCodeEditor(source, resource, selectionOrPosition?)`** —
the current opener ignores that third argument; the `file://` branch reads it
(`startLineNumber`/`startColumn`, or a position's `lineNumber`/`column`) and defaults to
line 1, column 1 when absent. (`cortex://` keeps carrying its own line/column in the URI.)

### 4.6 Editor option (MODIFIED — `InlineEditor` + `DiffViewer` `handleMount`)

```ts
editor.updateOptions({
  gotoLocation: {
    multipleDefinitions: "goto",
    multipleDeclarations: "goto",
    multipleTypeDefinitions: "goto",
    multipleImplementations: "goto",
  },
});
```
Makes Go to Definition jump to the first (top-ranked) result even when several match,
reserving the multi-item list for ⌥F12 Peek.

### 4.7 Provisioner lifecycle (MODIFIED — `registerCodeNavProviders`)

Create one `ModelProvisioner` alongside the `NavRouter` and expose it via a renderer
singleton (mirroring `router-singleton`). Call `disposeAll()`:
- on `worktreeIndexRefreshed` (so post-reindex peeks re-read fresh content),
- on worktree switch, and
- on the teardown returned by `registerCodeNavProviders`.

### 4.8 `SymbolPalette` (MODIFIED)

`pick` navigates with the precise column when available:
`navigate({ ..., line: row.line, column: row.col ?? undefined })`.

### 4.9 Unchanged / explicitly kept

- TS/JS built-in **definitions + references** stay disabled via `setModeConfiguration`.
- The reference provider stays **unregistered** (references out of scope).
- The `known-renderer-errors` "Model not found" suppressor stays as a **backstop**.

## 5. Data flow (peek)

1. ⌥F12 → Monaco calls `definitionProvider.provideDefinition`.
2. Provider fetches ranked cortex rows; for each, `provisioner.ensureModel(ref, relFile)`:
   `files.read` → `createModel(content, language, file://abs)` (or reuse / `null`).
3. Provider returns `file://` locations with precise ranges (unresolvable omitted).
4. Monaco's peek calls `createModelReference(file://abs)` → finds the provisioned model
   → renders the preview with the real filename.
5. Selecting an entry → `openCodeEditor(file://abs)` → opener → `NavRouter.navigate` →
   `InlineEditor` switches file, recorded in history.

## 6. Error handling

- `ensureModel` returns `null` on binary, read error, or any exception; never throws
  into the provider. `null` entries are omitted from the result list.
- If every candidate is `null` → empty peek / cmd+click no-op (graceful).
- Provider continues to swallow IPC errors → `[]`.
- `fromFileUri` returns `null` for paths outside the active worktree → opener returns
  `false` (Monaco default / no-op).
- **LRU disposal safety**: peek targets are most-recently-used and sit at the MRU end,
  so eviction (which trims only the cold tail beyond the cap) won't dispose a model
  during an open peek. Bulk disposal happens only on worktree switch / reindex /
  teardown — never mid-peek.
- The "Model not found" suppressor remains so any unforeseen peek path can't crash the
  app.

## 7. Testing (TDD)

Unit (vitest; thin seams so no real Monaco runtime is required):
- **`model-provisioner.test.ts`** — `ensureModel` creates a model with the right
  content + language and returns the `file://` URI; a second call reuses (no duplicate
  `createModel`); binary/error `readFile` → `null` and no model; LRU beyond cap disposes
  the oldest **owned** model and never a non-owned model; `disposeAll` disposes all owned.
- **`nav-file-uri.test.ts`** — `toFileUri`/`fromFileUri` round-trip; `null` for a path
  outside the worktree; trailing-slash handling.
- **`language-for-basename.test.ts`** — extracted helper across representative
  extensions (ts, tsx, js, py, json, unknown).
- **`definition-provider` result-building** — with cortex rows + a stub provisioner and
  ref: builds `file://` locations with precise ranges, omits `null`-provisioned entries,
  preserves best-first order, sets the e2e seam.
- **opener** — `file://` inside the worktree → `NavRouter.navigate(relFile, line, col)`;
  outside → not handled (`false`); `cortex://` still routes.
- **`SymbolPalette`** — `pick` navigates with `column`.

E2E (`tests/e2e/code-nav.test.ts`; `createTestRepo` writes real files so `files.read`
works):
- cmd+click on a multi-definition symbol → **jumps** to the best result (InlineEditor
  switches file), no peek widget.
- ⌥F12 Peek Definition → peek opens showing a **readable filename + real preview
  content**; selecting an entry navigates via NavRouter.
- Update §419 to assert the `file://` definition-URI seam.

## 8. Scope

### In scope
`ModelProvisioner`, `nav-file-uri`, extracted `language-for-basename`, definition
provider returning all ranked `file://` results + provisioning, opener `file://`
handling, the `gotoLocation` editor option, provisioner lifecycle wiring, Cmd+T column
precision, and the tests above.

### Out of scope (unchanged)
- Find/Peek **References** (reference provider stays unregistered; TS/JS references off).
- Replacing Monaco's `ITextModelService` (Approach B) — not pursued.
- A custom peek UI (Approach C) — not pursued.

### Decided choices
- Approach A (pre-create models on demand) over service override / custom UI.
- cmd+click jumps to best; ⌥F12 peeks all (via `gotoLocation.multipleDefinitions:"goto"`).
- Peek selection routes through NavRouter (our viewer + history).
- Model URIs are `file://` (readable names); viewer models stay `inmemory://` (no collision).

## 9. Affected files

New: `src/features/code-nav/monaco/model-provisioner.ts`,
`src/features/code-nav/nav/nav-file-uri.ts`,
`src/features/viewer/logic/language-for-basename.ts`,
plus a provisioner singleton accessor (extend `nav/router-singleton.ts` or a sibling).
Edit: `src/features/code-nav/monaco/definition-provider.ts`,
`src/features/code-nav/monaco/register.ts` (opener `file://` + provisioner wiring),
`src/features/viewer/components/InlineEditor.tsx` (use extracted helper; set editor
option; provision-aware), `src/features/viewer/components/DiffViewer.tsx` (editor
option), `src/features/code-nav/palette/SymbolPalette.tsx` (column).
Tests: as in §7.
