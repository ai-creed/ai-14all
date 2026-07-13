# Review Pane & File Viewer — UX Hardening — Design

**Date:** 2026-07-11
**Status:** Approved design, pending implementation plan
**Scope:** Eleven UX-hardening items in the file-review pane and file viewer: markdown/image inline previews (U1, U2), minimap sizing and click-to-jump (U3, U4, A10), comment-interaction hardening (A1, A2, A4, A8, A9), and changes-mode load-state surfacing (A3).

## 1. Context

Items were collected in two passes: Vu's own pain points (U1–U4) and a full code audit of `src/features/review/**` and related surfaces (A1–A16, prioritized P1–P3). The full candidate backlog, including deferred items and flows deliberately left untouched, lives in the ai-14all session note ("Review-pane UX hardening — candidate backlog, 2026-07-11").

This pass covers the agreed core cut:

| Item | Problem (evidence) |
|------|--------------------|
| U1 | Selecting a `.md` file opens raw source by default. Rendered preview exists but never as the default: an in-editor Preview/Edit button (`InlineEditor.tsx:542-580`), a right-click → Preview modal in the tree (`WorktreeTree.tsx:216-227`), and modal instances in the git lists (`CommitList.tsx:251-258`, `ChangesList.tsx:153-159`). |
| U2 | Selecting an image lands in Monaco as garbage/base64-looking content or a dead-end "Binary file — editor not available." placeholder (`services/files/file-service.ts:229`, `InlineEditor.tsx:77-78`). |
| U3 | Minimap column is a fixed 46 px for a 10 px dot (`src/app/shell.css:6125`); the cluster `+N` label renders outside-left of the dot (`shell.css:6171`). |
| U4 | Clicking a minimap dot only opens the flyout; jumping requires the flyout's separate Jump button (`CommentMinimap.tsx:90, 136-137`). |
| A1 | Comment delete is immediate and permanent — no confirm, no undo (`InlineCommentThread.tsx:141` → `review-comment-service.ts:103-115`). |
| A2 | Focus drops to `<body>` after every thread-closing action (draft submit/cancel, edit save/cancel, delete), breaking the `j`/`k`/`e`/`x` keyboard flow. |
| A3 | Changes-mode diff loading and errors are invisible: the pane ignores `diffState.message` and falls through to the misleading "Select a file…" empty state (`DiffViewerPane.tsx:402-418`). |
| A4 | Save stays live while a comment create is in flight — double-click or held Enter posts duplicates (`InlineDraftThread.tsx:38-55`, `DiffViewerPane.tsx:349-365`). |
| A8 | The `e` keybinding only scrolls to the focused comment; it never opens the edit textarea (`DiffViewerPane.tsx:252-257`). |
| A9 | Escape is dead inside a draft/edit (host node stops keydown propagation, `inline-thread-mount.ts:47`); edit mode lacks Enter-to-save. |
| A10 | Minimap dots are unlabeled buttons for screen readers (`CommentMinimap.tsx:77-97`). |

Deferred to a later pass (kept in the session note): A5 draft-switch guards, A6 comment-list error surface, A7 comment drift detection, A11–A16 polish items.

## 2. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Viewer previews use a mode resolver + sibling components: pure `resolveViewerMode(path)` → `"markdown" \| "image" \| "source"`, and a thin `FileViewer` wrapper that mounts `MarkdownPreview`, `ImagePreview`, or the existing `InlineEditor` | Keeps Monaco/dirty-bar/save-conflict lifecycle untouched inside `InlineEditor`; each renderer is testable alone; `DiffViewerPane` swaps one component at the files-mode call site and carries no flag logic. Extending `InlineEditor` internally was rejected as a boundary violation — and today's `InlineEditor` in fact already embeds a partial version of that rejected approach (a markdown Preview/Edit button with an in-place `ReactMarkdown` render, `InlineEditor.tsx:542-580`), which D15 removes so the design doesn't ship two competing toggles. |
| D2 | `.md` selection defaults to rendered preview with a `[Preview │ Source]` toggle in the pane header; toggle state is per-selection and resets to preview on each new `.md` selection | Preview is the priority use case for markdown; source (editable, existing `InlineEditor`) stays one click away. |
| D3 | Retire only the *tree* right-click Preview path: the `ContextMenu` wrapper in `WorktreeTree`, the `onPreviewMarkdown` prop chain, `treePreviewPath` state, and ReviewRail's modal instance. `MarkdownPreviewModal` itself **stays** — `CommitList.tsx:251-258` and `ChangesList.tsx:153-159` render their own instances, and CommitList's preview is commit-pinned via `contentOverride`, which the worktree-backed inline preview cannot replace. The modal's markdown body is extracted into a shared `MarkdownBody` presentational component used by both the modal and the new `MarkdownPreview` | Inline preview makes the tree path redundant (peek = select). The git-list instances remain the only preview affordance in changes/commits contexts and keep their documented always-mounted Radix workaround; deleting the modal would break both call sites. |
| D4 | Images render via a new `files:readImage` IPC returning `{ base64, mime, byteLength }`, hard-capped at 20 MB; the renderer shows a centered `<img src="data:...">` with a filename + dimensions + byte-size caption | The existing text read path rejects binary content by design. An `<img>` with a data URI is the minimal preview and — critically for SVG — never injects markup into the DOM, so scripted SVGs cannot execute. |
| D5 | Minimap column shrinks 46 px → 24 px; the cluster `+N` moves inside the dot, cluster dots grow to 16 px (singles stay 10 px); the outside-left `__count` label is removed | At 24 px an outside-left label would overlap the diff editor. Count-inside-dot also improves cluster affordance. |
| D6 | Dot click = `onJump(target)` + open flyout; single dot targets its comment, cluster dot targets the cluster's first comment | Land somewhere useful immediately, refine via the flyout list. Hover-to-peek is unchanged; the flyout Jump button remains the way to reach a specific clustered comment. |
| D7 | Delete is guarded by an undo toast (~6 s), not a confirm dialog; undo calls a new service-level `restore(comment)` that reinserts the exact record | Zero friction for intended deletes, full recovery for misclicks. `restore` (not `create`) because `create` mints a fresh UUID and resets status — an undone addressed comment must come back addressed, with the same id. |
| D8 | Every thread-closing action ends by focusing the modified editor that hosted the thread, via the existing diff-editor registry | Restores the `j`/`k`/`e`/`x` flow with zero clicks; entering a draft/edit focuses the textarea, exiting always returns to the editor. |
| D9 | Submits are serialized with a local `submitting` flag (button disabled + Enter no-op while pending) in both draft and edit-save paths | Pure renderer fix; once entry points are serialized, no service-side dedupe is needed. |
| D10 | The inline-thread mount registry is extended with per-thread handles `{ id, openEdit() }`; `editFocused` keeps its scroll and additionally calls `openEdit()` | Gives `e` a real keyboard path into the edit textarea without new global state. |
| D11 | Escape/Enter symmetry: draft — Escape cancels (immediate when empty, discard-confirm when dirty); edit — Enter saves, Shift+Enter newline, Escape cancels (confirm only when modified). Handlers live inside the thread components | The host node's `stopPropagation` makes portal-level key handling unreachable; component-local handlers sidestep it with no portal surgery. |
| D12 | Changes-mode gains error and loading branches mirroring the commits branch; the generic empty state renders only when nothing is selected | `ReviewLoadState` already carries `message`; the pane just never rendered it. |
| D13 | Minimap dots get status-bearing `aria-label`s (`"Comment L12–14 — open"`, `"3 comments from L40"`); the visual `+N` span becomes `aria-hidden` | The label carries the count; the visual span would otherwise double-announce. |
| D14 | `files.read` adopts the shared symlink-containment helper (unconditional realpath containment — catches symlinked files *and* symlinked parent directories; escape → `path-escape`); markdown preview reads through it under the existing 5 MB view cap (`MAX_FILE_VIEW_BYTES`), while the Source toggle keeps `openForEdit`'s 1 MB `MAX_EDITOR_FILE_BYTES` cap. The shared `FileReadFailure` union (`shared/models/file-view.ts:7-11`) gains `{ kind: "path-escape" }` **and** `{ kind: "permission-denied" }` members — it can currently represent neither, and the shared helper maps `EACCES` to `permission-denied` at every call site — and `readFile`'s lexical-escape mapping changes from `read-failed` (`file-service.ts:305-311`) to `path-escape` | Preview-by-default must not weaken today's `.md` safety: the current selection path is `openForEdit` (`.md` is editable), which contains final-file symlinks only (§3.1 readImage covers the parent-directory gap); `files.read` is lexical-only, so a `files.read`-backed default preview would make a symlinked `.md` outside the worktree readable. Strengthening `files.read` closes the hole for every view-path consumer instead of forking a preview-specific read; within-worktree symlinks remain readable. |
| D15 | `InlineEditor`'s embedded markdown Preview/Edit toggle (`InlineEditor.tsx:542-580` — button, `previewing` state, in-place `ReactMarkdown` render) is **removed**; `FileViewer` owns the single `[Preview │ Source]` toggle and `InlineEditor` becomes source-only | Two toggles would contradict the single-toggle design (Source mode would show a second Preview button). The embedded path's one unique capability — previewing the *unsaved buffer* — is superseded: the FileViewer toggle runs the `requestSwitch()` dirty-guard, so the user saves or discards, then previews saved content from one data path. |
| D16 | `ToastProvider` is extended: `show(message, opts?)` with optional `{ action: { label, onSelect }, ttlMs }` **returns the toast `id`**, `ToastItem` gains the optional action, and the `notifyToast` bridge forwards `opts` and returns the id; default TTL stays 4 s (`TTL_MS = 4000`), the undo toast passes `ttlMs: 6000` | The current provider is message-only with a fixed TTL and a void `show` (`ToastProvider.tsx:12-18, 46-55, 80-90`) — an Undo action is not implementable against it, and single-level undo (D7's toast replacement) needs a handle: the returned id lets the delete path `dismiss(previousId)` before showing the next undo toast. Extending the one provider keeps a single toast system instead of a bespoke undo widget. |

## 3. Components

### 3.1 Viewer preview modes (U1, U2 — D1–D4)

**`src/features/viewer/logic/resolve-viewer-mode.ts`** *(new)* — pure function:

```ts
export type ViewerMode = "markdown" | "image" | "source";
export function resolveViewerMode(relativePath: string): ViewerMode;
```

Case-insensitive extension match: `.md` → `markdown`; `.png .jpg .jpeg .gif .webp .svg .bmp .ico` → `image`; everything else → `source`.

**`src/features/viewer/components/FileViewer.tsx`** *(new)* — owns the files-mode slot. Props mirror what `DiffViewerPane` passes `InlineEditor` today (workspaceId, worktreeId, relativePath, resolvedTheme, onSaved, pendingReveal handling, ref forwarded to the inner `InlineEditor` when in source mode). Behavior:

- `source` mode → renders `InlineEditor` exactly as today (all props/ref pass through).
- `markdown` mode → header bar with `[Preview │ Source]` toggle (TUI-styled: square corners, `--radius`, existing chip-bar button classes). Preview state resets to `preview` whenever `relativePath` changes. Preview renders `MarkdownPreview`; Source renders the same `InlineEditor` (editable; dirty-bar and save-conflict behavior untouched).
- `image` mode → renders `ImagePreview`; no toggle (nothing editable). Non-image binaries never reach `FileViewer` specially — they stay `source` mode and keep today's "Binary file" placeholder from `InlineEditor`.

**`src/features/viewer/components/MarkdownPreview.tsx`** *(new)* — loads text via `files.read`, which this change strengthens with the same shared symlink-containment helper as `readImage` (D14). Rationale: today a `.md` selection goes through `openForEdit`, which contains final-file symlinks (`file-service.ts:191-201` — parent-directory symlinks slip through even there; the shared helper fixes both, see §readImage); `files.read` is currently lexical-only (`file-service.ts:301-342`), so preview-by-default must not route markdown through it unhardened. Caps are explicit and deliberately split: preview renders up to the existing 5 MB view cap (`MAX_FILE_VIEW_BYTES`, `shared/files/size-limits.ts:1`); the Source toggle still edits through `openForEdit` under its 1 MB `MAX_EDITOR_FILE_BYTES` cap — the app's existing view-vs-edit cap semantics. The rendered body is a shared `MarkdownBody` presentational component (extracted from `MarkdownPreviewModal`'s `ReactMarkdown` + `remark-gfm` + `rehype-highlight` block) inside a scrollable pane, so the retained modal and this component render identically. Read failures render the same reason strings `InlineEditor` uses (`not-found`, `path-escape`, `too-large`, …); a `too-large` file shows the standard placeholder rather than attempting a render.

**`InlineEditor` strip (D15)** — remove the embedded markdown preview path: the Preview/Edit header button, the `previewing` state, the in-place `ReactMarkdown` render (`InlineEditor.tsx:542-580`), and the `shell-inline-editor__preview*` styles. `InlineEditor` becomes source-only; `resolveViewerMode` + `FileViewer` own all mode switching. Consequence: previewing an *unsaved buffer* is no longer possible — the FileViewer toggle's dirty-guard (`requestSwitch()`) prompts save/discard first, then previews saved content from the single `files.read` path.

**`src/features/viewer/components/ImagePreview.tsx`** *(new)* — calls `files:readImage`; renders centered `<img>` on `var(--muted)` background, `max-width/height: 100%`, natural size otherwise; caption line `name · W×H px · N KB` (dimensions read from the loaded `<img>`). States: loading (muted text), over-cap → "Too large to preview (N MB)", read failure → reason string, `<img onError>` (corrupt/undecodable) → "Cannot decode image".

**`services/files/file-service.ts` + IPC contract + preload** — new image read, split across the privileged IPC trust boundary (AGENTS.md §Privileged IPC Trust Boundary):

- **Renderer-facing contract** (`shared/contracts/commands.ts` + preload + the typed renderer wrapper): `files.readImage(workspaceId, worktreeId, relativePath)` — identifier-based, mirroring the existing `files.read` shape (`commands.ts:452-456`). Raw filesystem paths never cross the renderer→main boundary. The `files` wrapper object in `src/lib/desktop-client.ts:56-78` gains the matching `readImage` method — omitting it fails the `Ai14AllDesktopApi["files"]` type once the shared API grows.
- **IPC handler** (`electron/main/ipc.ts`): resolves the worktree path server-side via `WorkspaceRegistryService.get` + `WorktreeService.findWorktree` (both throw on unknown ids; errors propagate as rejected promises), then calls the internal service method.
- **Internal service method** `FileService.readImage(worktreePath, relativePath)` — the only layer that sees a resolved path. Guards: lexical `resolveInsideWorktree` **plus** a shared containment helper that performs an **unconditional** realpath comparison after lexical resolution: `realpath(resolved.absolute)` must equal `realpath(worktreePath)` or start with it plus the path separator; otherwise `path-escape`. Deliberately *not* an extraction of the current `openForEdit`/`saveFile` lstat guard (`file-service.ts:191-201`) — that guard realpaths only when the *final* component is itself a symlink, so a symlinked intermediate directory (`worktree/linkdir/file.md` with `linkdir` → outside) bypasses it entirely. The unconditional helper replaces the conditional guard at all four call sites — `readImage`, `readFile` (D14), `openForEdit`, `saveFile` — strengthening the two existing ones as part of this change. Helper realpath errors map as elsewhere: `ENOENT` → `not-found`, `EACCES` → `permission-denied`, else `read-failed`.
- Rejects: `not-found`, `permission-denied`, `read-failed`, `path-escape` (symlink outside the worktree), `too-large` (> 20 MB), `not-image` (extension not in the image set).
- Success: `{ base64, mime, byteLength }`; mime mapped from extension (`image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`, `image/bmp`, `image/x-icon`).
- SVG is read as bytes like any other image and rendered only ever through `<img src="data:image/svg+xml;base64,...">` — never inlined into the DOM (script-in-SVG cannot execute inside `<img>`).

**Call-site swap** — `DiffViewerPane.tsx:387-401`: `<InlineEditor …>` → `<FileViewer …>` with identical props. The `inlineEditorRef` continues to work in source mode (forwarded); in preview/image modes the ref is `null`, and the existing dirty-guard (`requestFileSwitch`) treats a null handle as "no unsaved edits", which is correct — previews are read-only.

**Retirement (D3)** — delete the `ContextMenu` Preview wrapper in `WorktreeTree.tsx:207-228` (file rows render plain again), the `onPreviewMarkdown` props in `WorktreeTree`/`FilesPane`/`ReviewRail`, the `treePreviewPath`/`onSetTreePreviewPath` state in `ReviewArea.tsx:129` and its prop threading, and ReviewRail's `MarkdownPreviewModal` instance. `MarkdownPreviewModal.tsx` itself is **kept**: `CommitList.tsx:251-258` and `ChangesList.tsx:153-159` render their own instances (CommitList's commit-pinned via `contentOverride`, not replaceable by worktree-backed inline preview). The modal is refactored to render the shared `MarkdownBody` internally — no behavior change at those two call sites, which keep their always-mounted Radix workaround.

### 3.2 Minimap (U3, U4, A10 — D5, D6, D13)

**CSS (`src/app/shell.css:6123-6176`)** — `.shell-review-minimap` width 46 px → 24 px. `.shell-review-minimap__dot` stays 10 px; new modifier `.shell-review-minimap__dot--cluster` at 16 px with centered 8 px count text. `.shell-review-minimap__count` absolute positioning (`right: calc(100% + 2px)`) removed — the count is now the dot's inline content. Flyout `left/right` rules re-checked so it still opens leftward over the diff without clipping at the new width.

**`CommentMinimap.tsx`**:

- Dot `onClick` (line 90): `setActiveHeadId(head.id)` **and** `onJump(clusterComments[0])` (single-dot clusters have exactly one item, so one code path covers both). Hover/focus behavior unchanged.
- Cluster dots get the `--cluster` class and render the count as direct button text (the `__count` span, now `aria-hidden`).
- `aria-label`: single → `` `Comment L${startLine}${range} — ${status}` ``; cluster → `` `${n} comments from L${firstStartLine}` ``. `aria-haspopup="dialog"` stays.
- Keyboard comes free: dots are `<button>`s, Enter/Space trigger the click handler.

### 3.3 Comment interaction hardening (A1, A2, A4, A8, A9 — D7–D11)

**Undo delete (D7)**:

- `services/review/review-comment-service.ts` — new `restore(comment: ReviewComment)`: validates the worktree scope, reinserts the record verbatim (same id, status, timestamps), persists via the existing store write, rejects if the id already exists (double-undo is a no-op).
- Contract (`shared/contracts/review-comments.ts`) + preload + the `reviewComments` wrapper object in `src/lib/desktop-client.ts:134-149` + `use-review-comments.ts` all gain `restore` (the typed wrapper fails to compile if omitted).
- `ToastProvider` extension (D16): `show(message, opts?: { action?: { label: string; onSelect: () => void }; ttlMs?: number }): string` — returns the toast id. `ToastItem` gains the optional action, rendered as a TUI-styled button before the dismiss icon; clicking it fires `onSelect` exactly once and dismisses the toast. `ttlMs` overrides the 4 s default per toast; the `notifyToast` imperative bridge forwards `opts` and returns the id (empty string when no provider is mounted). Existing message-only call sites compile and behave unchanged.
- `DiffViewerPane` delete path (`:342-348`): snapshot the comment before `remove(id)`, then raise the extended toast — "Comment deleted" with an `Undo` action and `ttlMs: 6000` — keeping `{ toastId, snapshot }` as the single pending-undo state; Undo calls `restore(snapshot)`. On expiry/dismiss the snapshot is dropped. A new delete while an undo toast is pending first calls `dismiss(previousToastId)`, then shows the new toast (previous snapshot dropped — single-level undo; the replaced toast's Undo is no longer actionable).

**Focus restore (D8)** — a small helper in `DiffViewerPane` resolves the hosting modified editor from the existing diff-editor registry and calls `editor.focus()`. Invoked after: draft submit resolve, draft cancel, edit save resolve, edit cancel, delete. Entering a draft or edit focuses the textarea (kept/ensured).

**Submit guard (D9)** — `InlineDraftThread`: `submitting` state set before `await onSubmit(...)`, cleared in `finally`; Save `disabled={submitting || empty}`; Enter handler returns early while `submitting`. Same pattern in `InlineCommentThread`'s edit-save.

**`e` opens edit (D10)** — extend the mount registry used by `use-inline-thread-mounts` so each mounted thread registers `{ id, openEdit }`. `InlineCommentThread` supplies `openEdit` (sets its local `editing` state and focuses the textarea). `editFocused` in `DiffViewerPane` resolves the focused comment, scrolls (unchanged), then invokes the handle's `openEdit()`.

**Escape/Enter symmetry (D11)** — inside `InlineDraftThread`: `onKeyDown` Escape → empty body: `onCancel()` immediately; dirty body: route through the existing discard-confirm path. Inside `InlineCommentThread` edit mode: Enter (no Shift) → save (guarded by D9), Shift+Enter → newline, Escape → cancel, with confirm only when the textarea differs from the original body. All exits route through D8's focus restore.

### 3.4 Changes-mode load states (A3 — D12)

`DiffViewerPane.tsx:402-418` — before the generic empty state, when `reviewMode === "changes"` and a changed file is selected:

- `diffState.message !== null && diffState.data === null` → `<p className="shell-error">{diffState.message}</p>` (mirror of the commits branch at `:368-371`).
- No data, no message → `<p className="shell-empty-state">Loading diff…</p>` (plain muted text, no spinner chrome).
- `stale` handling unchanged: when `diffState.data` exists it keeps rendering.
- The "Select a file or changed file to inspect it." state renders only when nothing is selected.

## 4. Testing (TDD — tests written first, per item)

**Unit/component:**

- `resolveViewerMode`: table test over extensions incl. case-insensitivity and fallthrough.
- `FileViewer`: md → preview by default, toggle mounts `InlineEditor` (mocked), toggle resets on path change; image → `ImagePreview`; other → `InlineEditor` with props/ref passthrough. **Dirty-guard on Source → Preview:** with a mocked `InlineEditor` handle, `requestSwitch()` resolving `"cancel"` keeps source mode mounted (no preview switch); `"proceed"` completes the switch.
- `InlineEditor` post-strip (D15 regression): renders no Preview/Edit button and no embedded markdown render for `.md` files — the FileViewer toggle is the only preview affordance in files mode.
- `MarkdownPreviewModal` retained call sites: modal renders via the shared `MarkdownBody`; `contentOverride` (CommitList's commit-pinned content) is respected over a worktree read.
- `ToastProvider` (D16): action button renders and `onSelect` fires exactly once then dismisses; `ttlMs` override honored (fake timers) while message-only toasts keep the 4 s default; `show` returns an id accepted by `dismiss`; MAX-3 trim behavior unchanged.
- Undo replacement (D7 single-level): with two deletes in sequence, the first undo toast is dismissed when the second appears — its `Undo` is no longer actionable — and only the second comment is restorable.
- `FileReadFailure` `path-escape` + `permission-denied` members (D14): union members exist and `InlineEditor`/`MarkdownPreview` reason-to-placeholder mappings handle both (exhaustive-switch compile guard).
- `MarkdownPreview`: renders GFM (table/code block); read-failure reasons render placeholders, including `path-escape`.
- `file-service.readFile` containment (D14 regression guard): a `.md` symlink resolving outside the worktree returns `path-escape`; a `.md` under a symlinked parent directory resolving outside the worktree also returns `path-escape`; a symlink resolving inside the worktree still reads; content over `MAX_FILE_VIEW_BYTES` still returns `too-large`. **Update the existing lexical-escape expectation** at `tests/unit/services/files/file-service.test.ts:66-70` from `read-failed` to `path-escape` (the directory-read `read-failed` case at `:60-64` stays unchanged).
- `openForEdit`/`saveFile` after helper adoption: existing behavior preserved for plain paths and final-file symlinks; symlinked-parent-directory escape now returns `path-escape` (previously missed).
- `ImagePreview` (mocked IPC): success renders `img` with data URI + caption; `too-large` and `not-image`/failure placeholders; `onError` → "Cannot decode image".
- `file-service.readImage`: mime mapping, 20 MB cap, `not-image` rejection, lexical escape rejection, and **symlink containment** — both a symlinked image file *and* an image under a symlinked parent directory resolving outside the worktree return `path-escape` (regression guards for the unconditional-realpath helper; the parent-directory case is exactly what the old conditional lstat guard missed).
- IPC contract shape: `files.readImage` accepts `(workspaceId, worktreeId, relativePath)` and rejects on unknown ids (resolver-thrown), asserting no raw-path variant exists in the contract/preload.
- `CommentMinimap`: dot click fires `onJump` with head comment **and** opens flyout; cluster dot has `--cluster` class + inner count; aria-labels single/cluster; count span `aria-hidden`.
- `review-comment-service.restore`: exact-record reinsertion (id/status/timestamps), persistence, duplicate-id rejection.
- `InlineDraftThread` / `InlineCommentThread`: second submit blocked while pending; Escape empty-cancel vs dirty-confirm; edit Enter-saves / Shift+Enter newline / Escape-cancel-with-diff-confirm.
- Thread mount registry: `editFocused` invokes the focused thread's `openEdit`.
- `DiffViewerPane` changes-mode: error renders `diffState.message`; loading renders; empty state only when unselected.

**e2e (extends `tests/e2e/review-comments.test.ts` and viewer suites; closes in-scope coverage gaps — delete, double-submit, Escape, `e`-to-edit were all untested):**

- Select `.md` → rendered preview visible → toggle → Monaco source editable.
- Select image → `img` rendered, no Monaco.
- Minimap dot click → editor revealed at the comment's line + flyout open.
- Delete → undo toast → Undo → comment back with same id and status.
- After draft submit → `document.activeElement` inside the modified editor → `j` navigates immediately.
- Double-click Save → exactly one comment persisted.
- `e` on focused thread → textarea focused; Escape → closed, focus back in the editor.

## 5. Edge cases

- **Huge `.md`** → over 5 MB (`MAX_FILE_VIEW_BYTES`): preview shows the `too-large` placeholder (no partial render). Between 1 MB and 5 MB: preview renders, but the Source toggle shows `InlineEditor`'s `too-large` placeholder (its `openForEdit` cap is 1 MB) — deliberate, matching the app's existing view-vs-edit cap split (D14).
- **Previewing unsaved edits** → not supported after D15 (the embedded buffer-preview is removed with the strip); the toggle's dirty-guard prompts save/discard first, and preview always shows saved on-disk content.
- **Symlinked `.md` — directly or via a symlinked parent directory — resolving outside the worktree** → `path-escape` placeholder in preview (D14); preview-by-default does not widen file access, and the parent-directory case closes a hole the current editor path also had.
- **Image over 20 MB / undecodable / deleted between select and read** → dedicated placeholder states in `ImagePreview` (§3.1); never a Monaco fallthrough.
- **Scripted SVG** → rendered only through `<img>`; scripts cannot execute (D4).
- **Symlinked image — directly or via a symlinked parent directory — resolving outside the worktree** → `path-escape` rejection via the unconditional-realpath containment helper; the renderer shows the standard read-failure placeholder.
- **Dirty source edits, then toggle to preview** → the `InlineEditor` unmounts on toggle, so the toggle handler first awaits the handle's existing dirty-guard, `requestSwitch(): Promise<"proceed" | "cancel">` (`InlineEditor.tsx:28-30`), and aborts the mode switch on `"cancel"`. Preview-only selections have a null editor handle and switch freely.
- **Undo after the toast expired** → snapshot dropped; delete is final (documented behavior, single-level undo).
- **Double-undo / restore of an existing id** → service rejects; renderer treats it as a no-op.
- **Delete while another delete's toast is pending** → new toast replaces old; only the latest delete is undoable.
- **`e` with no focused thread** → no-op (unchanged from today's scroll-only behavior).
- **Cluster count ≥ 10** → 16 px dot fits two digits at 8 px; the count also lives in the aria-label, and the flyout lists all items regardless.
- **Legacy sessions with a stored `treePreviewPath`** → state is deleted; no migration needed (it was ephemeral renderer state).

## 6. Non-goals

- No image *diff* view (old vs new side-by-side) — changes/commits modes keep showing text diffs; image preview applies to files-mode selection only.
- No markdown editing inside the preview (source mode is the editor).
- No UX change to the `CommitList`/`ChangesList` preview modals beyond internal `MarkdownBody` reuse — their triggers, commit-pinned content, and always-mounted workaround stay as-is.
- No persistence of the Preview/Source toggle across selections or sessions.
- No service-side comment dedupe (D9 serializes the entry points instead).
- Deferred backlog items A5–A7 and A11–A16 (see session note).

## 7. Files touched

| File | Change |
|------|--------|
| `src/features/viewer/logic/resolve-viewer-mode.ts` *(new)* | Pure viewer-mode resolver. |
| `src/features/viewer/components/FileViewer.tsx` *(new)* | Files-mode slot owner: mode dispatch + Preview/Source toggle. |
| `src/features/viewer/components/MarkdownPreview.tsx` *(new)* | Inline rendered markdown (react-markdown + remark-gfm). |
| `src/features/viewer/components/ImagePreview.tsx` *(new)* | Minimal image preview with placeholder states. |
| `src/features/viewer/components/MarkdownBody.tsx` *(new)* | Shared presentational markdown renderer (`ReactMarkdown` + `remark-gfm` + `rehype-highlight`), used by `MarkdownPreview` and the retained modal. |
| `src/features/viewer/components/MarkdownPreviewModal.tsx` | **Kept** for `CommitList`/`ChangesList` (D3); body refactored to render `MarkdownBody`; ReviewRail's instance removed. |
| `src/features/viewer/components/InlineEditor.tsx` | Remove the embedded markdown Preview/Edit path (D15): button, `previewing` state, in-place render, `shell-inline-editor__preview*` styles. Source-only afterwards. |
| `shared/models/file-view.ts` | `FileReadFailure` gains `{ kind: "path-escape" }` and `{ kind: "permission-denied" }` (D14); renderer reason mappings updated alongside. |
| `src/lib/desktop-client.ts` | Typed wrapper methods added: `files.readImage` (`:56-78` object) and `reviewComments.restore` (`:134-149` object). |
| `src/features/ui/toast/ToastProvider.tsx` | `show(message, opts?)` with `action` + per-toast `ttlMs` (D16); action-button rendering; `notifyToast` bridge forwards opts. |
| `src/features/viewer/components/WorktreeTree.tsx` | Remove context-menu Preview wrapper + `onPreviewMarkdown` prop. |
| `src/app/components/FilesPane.tsx`, `src/features/review/components/ReviewRail.tsx`, `src/app/components/ReviewArea.tsx` | Remove `onPreviewMarkdown`/`treePreviewPath` threading; ReviewRail drops the modal mount. |
| `services/files/file-service.ts` + `shared/contracts/commands.ts` + `electron/preload/index.ts` + `electron/main/ipc.ts` | New `readImage`: identifier-based contract/preload/handler with server-side path resolution; internal service method with shared symlink-containment helper, 20 MB cap, mime map. |
| `services/files/file-service.ts` (`readFile`, `openForEdit`, `saveFile`) | All adopt the shared unconditional-realpath containment helper (D14): file or any parent directory resolving outside the worktree → `path-escape`; replaces the conditional lstat guard; caps unchanged. |
| `src/features/review/components/DiffViewerPane.tsx` | `FileViewer` swap; changes-mode error/loading branches; delete-snapshot + undo toast; focus-restore helper; `editFocused` → `openEdit`. |
| `src/app/shell.css` | Minimap 24 px, cluster-dot modifier, count-inside-dot; new viewer header/preview/image styles. |
| `src/features/review/components/CommentMinimap.tsx` | Click = jump + flyout; cluster dot rendering; aria-labels. |
| `services/review/review-comment-service.ts` + review contract + preload + `use-review-comments.ts` | `restore(comment)` end-to-end. |
| `src/features/review/components/InlineDraftThread.tsx`, `InlineCommentThread.tsx` | Submit guard; Escape/Enter symmetry; `openEdit` handle. |
| `src/features/review/hooks/use-inline-thread-mounts.tsx` / `logic/inline-thread-mount.ts` | Registry handles `{ id, openEdit }`. |
| Tests | Per §4 (unit + component + e2e). |
