# Inline Review UI Redesign

**Status:** Design approved · awaiting implementation plan
**Date:** 2026-05-14
**Scope:** `src/features/review/*`, `src/app/components/ReviewArea.tsx`, file-tree badge, IPC additions in `services/review/*`

## Goals

Fix three pain points with the current review experience:

1. **Comments feel detached from code.** Today comments live in a sidebar list; the user clicks a range to scroll back. The new design renders threads inline with the diff.
2. **Adding a comment is clunky.** Select → floating overlay button → sidebar form is too many steps. The new design surfaces the add affordance directly at the line.
3. **Visual hierarchy is weak.** The redesign introduces explicit thread states (open / editing / addressed-strip) and a purpose-built queue panel.

Non-goals for this iteration:

- Line-drift compensation when code changes after a comment is created (kept as a known follow-up).
- Threaded replies / agent-reply messages (single body per comment retained).
- Keyboard-driven review mode beyond a few core shortcuts.

## Decisions

| Topic | Choice |
| --- | --- |
| Placement | Inline view-zone thread, hosted in Monaco between code lines |
| Add trigger | Gutter "+" on hover (single line) + selection-pill (range) + `⌘⇧A` shortcut |
| Overview | New `ReviewQueuePanel` (flat grouped queue) replacing `ReviewCommentSidebar`, plus comment-count badges on the changed-files tree |
| Bulk action | "Clear all addressed" shortcut in queue header |
| Addressed state | Fold to thin one-line strip with addressed color; still navigable via the queue; click to expand; `↺` to reopen |
| Editing | Inline edit of body allowed while status is `open` |
| Lifecycle | `open` ↔ `addressed`; `delete` permanent |

## Architecture

```
ReviewArea
├── ReviewQueuePanel              ← NEW (replaces ReviewCommentSidebar)
│   ├── per-file groups, count chip
│   ├── "Clear all addressed" + "Hide addressed" toggle
│   └── row click → focus file + scroll + flash thread
│
└── DiffEditor (Monaco)
    ├── decorations               ← extended diff-editor-decorations
    │     · range bg (open vs addressed)
    │     · gutter glyph (● open, ✓ addressed)
    ├── content widgets           ← NEW inline-comment-widgets
    │     · GutterPlusWidget      (hover line on modified side)
    │     · SelectionPillWidget   (anchors to active selection)
    └── view-zones                ← NEW inline-thread-mount
          · one zone per comment, hosts <InlineCommentThread/> via React portal
          · zone height re-measured on render
```

### New files (logic)

- `src/features/review/logic/inline-comment-widgets.ts` — manages gutter-"+" + selection-pill widget instances on a given editor; exposes `onStartDraft(range)` callback.
- `src/features/review/logic/inline-thread-mount.ts` — Monaco view-zone ⇄ React portal bridge. Owns mount/unmount, height re-measure, and target DOM lifecycle.
- `src/features/review/logic/comment-key-bindings.ts` — registers `⌘⇧A` (add at caret), `j` / `k` (next / prev thread in the current file; wraps), `e` (edit the "focused" thread), `x` (toggle addressed on the focused thread). The **focused thread** is the most recently navigated-to or clicked thread for the active editor; when no thread has been focused yet, `e` and `x` are no-ops.

### New components

- `src/features/review/components/InlineCommentThread.tsx` — three render states keyed by `data-state`:
  - `open`: header (`L43–45 · 2m ago`), body, footer (`✓ Address` · `Edit` · `Delete`).
  - `editing`: textarea + Save / Cancel; opened either for an existing thread or for a new draft via `InlineDraftThread`.
  - `addressed-strip`: single 24px row `✓ L43 — first line of body…`; click expands; `↺` reopens.
  - Calls `onMeasureChange()` after every render so the mount bridge can resize the view-zone.
- `src/features/review/components/InlineDraftThread.tsx` — transient editing-state thread for a new comment. Same submit contract as the form, no `comment.id` yet.
- `src/features/review/components/ReviewQueuePanel.tsx` — replaces `ReviewCommentSidebar`. Header: title, open-count chip, overflow menu (`Clear all addressed`, `Hide addressed`). Body: file groups (filename + count); compact rows (range + first body line + status dot). Empty state mirrors the existing sidebar copy. **Carries forward the existing `AgentInstallCta` slot** — accepts `installCtaVisible` / `onOpenInstall` props (same shape as today's sidebar) and renders `<AgentInstallCta/>` at the bottom of the panel. The CTA is the discoverable entry point for `agent-install` fix-review setup, so it must not regress in this redesign. `ReviewArea` wires the props identically to today (see `src/app/components/ReviewArea.tsx` lines 525–526).

### Reused / removed

- `ReviewCommentForm.tsx` — kept, slimmed; presentational textarea + Save/Cancel actions used by `InlineCommentThread` (editing) and `InlineDraftThread`.
- `AgentInstallCta.tsx` — kept as-is. Host moves from `ReviewCommentSidebar` to `ReviewQueuePanel` (same props, same visual position at the bottom of the panel).
- `ReviewCommentSidebar.tsx` — removed.
- The `shell-review-floating-add` button block in `ReviewArea.tsx` — removed; gutter-"+" / selection-pill replace it.
- `services/review/*`, `shared/models/review-comment.ts`, MCP review tools — untouched aside from one new IPC route and one bulk-remove route (see below).

## Data flow

```
user action              →  hook surface                →  service / IPC
─────────────────────────────────────────────────────────────────────────
hover-"+" or selection   →  setDraft(range)             →  local UI state
submit draft             →  reviewState.create(...)     →  reviewComments.create
edit body                →  reviewState.update(id,body) →  reviewComments.update          ★ NEW
mark addressed / reopen  →  markAddressed / reopen      →  existing
delete                   →  reviewState.remove(id)      →  existing
"Clear all addressed"    →  reviewState.clearAddressed  →  reviewComments.bulkRemoveAddressed(...) ★ NEW
```

**Two derived slices from one source.** `use-review-comments` returns the worktree's full `comments[]`. `ReviewArea` derives **two** distinct inputs from it:

1. **Inline mount input** (`useInlineThreadMounts(editor, inlineComments)`) — filtered by current file path **and** by active review mode (see below).
2. **Queue panel input** (`<ReviewQueuePanel comments={allComments} activeMode={...} />`) — the full worktree list, grouped client-side by the panel into the active-mode bucket and an "Other modes" bucket. The queue is intentionally wider than the inline view so users can find comments authored in another mode.

These are different shapes by design — do not collapse them into one filtered slice.

**Inline filter by review mode (required).** Inline rendering attaches a comment to specific line numbers in a displayed diff. Because `ReviewComment` carries `source` (`"working-tree" | "commit"`) and `commitSha`, a comment authored in one mode can target line numbers that no longer mean the same thing in another mode. `ReviewMode` is `"files" | "changes" | "commits"` (see `shared/models/worktree-session.ts`). Filter rules:

- `reviewMode === "changes"` (working-tree diff against base) → include only `source === "working-tree"`.
- `reviewMode === "commits"` → include only `source === "commit"` AND `commitSha === activeSession.selectedCommitSha`.
- `reviewMode === "files"` (plain file editor, no diff) → inline mount is disabled entirely; no comments are mounted. The queue panel still lists everything; clicking a row switches the session into the correct mode + selection before scrolling (see below).

Comments that don't match the active inline filter live in the queue's "Other modes" bucket. Implementation must add a unit test asserting both the filter predicate and the `files`-mode disable behavior.

**Queue row → editor jump (explicit contract).** Clicking a row in `ReviewQueuePanel` calls `onJump(comment)`. The handler in `ReviewArea` MUST set every piece of session state the target editor needs **before** calling `scrollToLineRange`. The existing workspace reducer (`src/features/workspace/logic/workspace-state.ts`) already exposes the right actions; the design uses those names verbatim (do NOT invent new action types):

- `source === "working-tree"` → dispatch one action:
  - `{ type: "session/selectChangedFile", worktreeId, relativePath: comment.filePath }`
  - The reducer sets `reviewMode = "changes"` and `selectedChangedFilePath = comment.filePath` as one step.
- `source === "commit"` → dispatch two actions, in order:
  1. `{ type: "session/selectCommit", worktreeId, sha: comment.commitSha }` — sets `reviewMode = "commits"` and `selectedCommitSha`. `commitSha` is guaranteed non-null by the Zod schema for `source === "commit"`.
  2. `{ type: "session/selectCommitFile", worktreeId, relativePath: comment.filePath }` — sets `selectedCommitFilePath`. Must follow `selectCommit` so the file is resolved against the just-selected sha.

After the dispatch(es), wait for `diff-editor-registry.get(filePath)` to return non-null (poll across a microtask / one-frame `requestAnimationFrame` if the editor is still mounting), then call `scrollToLineRange(editor, comment)`. If the editor never registers within ~500ms (file missing from the changed-set or commit), surface a non-blocking toast `"File no longer in this diff"` and leave the comment in the queue.

Without this explicit sequencing a commit-mode jump can land on the wrong commit (stale `selectedCommitSha`) or on no mounted editor (`selectedCommitFilePath` not yet switched).

**Draft state.** `addingDraft` remains local to `ReviewArea`. While a draft is open it renders as `InlineDraftThread` in the active editor. If the user switches files mid-draft, the draft is preserved keyed by file path; the queue panel shows a `📝 Pending L43 in foo.ts` row so it isn't lost.

**Line tracking.** v1 keeps existing `startLine`/`endLine` semantics (line numbers captured at creation time). `snippet` is captured for context. Drift compensation deferred.

**New IPC surface**

- `reviewComments.update(id, { body })` — body-only patch; service rejects if status ≠ `open`. Returns the updated record or `{ ok: false, error }`. **On success, emits a `changed` event with kind `"updated"`** so the refresh-driven hook can pick it up. This requires extending the existing change contract:
  - `services/review/review-comment-service.ts` — add `"updated"` to the `ChangeKind` union.
  - `shared/contracts/review-comments.ts` — extend `ReviewCommentChangedEventSchema` to include `"updated"`.
  - `use-review-comments.ts` — already calls `refresh()` on every change event, so no branching needed; the new kind flows through transparently.
- `reviewComments.bulkRemoveAddressed({ worktreeId, ids[] })` — atomic batch deletion used by `Clear all addressed`. **Guard rails (server-enforced):**
  - Every `id` MUST exist and belong to `worktreeId`; any mismatch fails the batch with `error: "worktree_mismatch"` and persists nothing.
  - Every targeted comment MUST currently have `status === "addressed"`; any `open` id fails the batch with `error: "not_addressed"` and persists nothing.
  - Returns `{ ok: true, removed: number }` on success.

These constraints prevent a renderer bug (or a stale `ids[]` after a reopen race) from permanently deleting open comments or comments belonging to another worktree. The existing `delete(id)` route remains for single-comment deletion and is untouched.

## Error handling & edge cases

**IPC failures.** `create` / `update` / `bulkRemoveAddressed` errors surface via `shell-toast` with a retry-friendly message. Draft text is preserved on error so the user does not retype.

**State model — refresh-driven, not optimistic.** `use-review-comments` today is purely refresh-driven: every mutating call (`create` / `markAddressed` / `reopen` / `remove`) returns from IPC, the service emits `reviewComments:changed`, and the hook re-`list`s. This spec keeps that pattern unchanged — we do NOT introduce optimistic updates in this iteration. The two new methods on the hook follow the same shape:

- `update(id, body)` → awaits IPC → relies on the `changed` event for the re-render.
- `clearAddressed()` → awaits `bulkRemoveAddressed` → relies on the `changed` event.

The trade-off (a one-event-tick latency between click and UI update) is acceptable and matches current behaviour. Adding an optimistic layer is deferred and listed as a follow-up.

**View-zone lifecycle.** When an editor disposes (file switch, tab close) `useInlineThreadMounts` cleans up every zone and unmounts its React portal. Pending `requestAnimationFrame` height re-measures are cancelled. If a comment arrives before the editor is registered for that path, the mount is queued until `diff-editor-registry` resolves it.

**Draft invariants.** Only one `addingDraft` per session. Starting a new draft while another exists prompts confirm-discard if dirty, otherwise replaces silently. Editing an existing thread occupies the same single-slot draft. Switching files with a dirty draft keeps it in memory keyed by file path and surfaces it via the queue's pending row.

**Selection-pill positioning.** Pill anchors to the modified side of the diff. If the selection lies entirely on the original (pre-change) side, the pill is suppressed — comments can only be authored on the modified side. Collapsing the selection removes the pill.

**Gutter-"+" suppression.** Hidden on unchanged lines outside the visible diff hunk window. Hidden while a draft thread is open in the same file.

**Addressed-strip.** Clicking anywhere on the strip expands the thread inline. `↺` flips status back to `open` and re-expands. The `Hide addressed` toggle in the queue header hides strips inline AND filters the queue list — one switch controls both surfaces.

**Commit vs working-tree mode.** Both modes use the same UI. The `source` and `commitSha` fields on `create` are derived from `activeSession.reviewMode` (unchanged from today). The queue groups by file regardless of mode; the panel header indicates which mode is active.

**Concurrency.** Two writes to the same comment id last-write-wins; the service throws on stale writes and the toast surfaces it.

## Testing

### Unit (vitest)

- `inline-thread-mount.test.ts` — given `comments[]` and a fake `IStandaloneDiffEditor`, asserts the correct `addZone` / `removeZone` calls on add / remove / edit. Reuses the `fakeEditor` pattern from `tests/unit/review/diff-editor-registry.test.ts`.
- `inline-comment-widgets.test.ts` — gutter-"+" shows/hides per hovered line; selection-pill anchors to selection end; both suppressed under the conditions in §Error handling.
- `diff-editor-decorations.test.ts` — extend for addressed-status colors and gutter glyphs.
- `comment-key-bindings.test.ts` — `⌘⇧A` starts a draft at caret; `j`/`k` cycle threads; `e` enters edit; `x` toggles addressed.
- `use-review-comments.test.ts` — extend with `update(id, body)` and `clearAddressed()`. Assert refresh-driven shape: each method awaits IPC then relies on a `reviewComments:changed` event to update `comments`. No optimistic-state assertions.
- `review-mode-filter.test.ts` — given a mixed `comments[]` (working-tree + multiple commit shas) and a `reviewMode` / `commitSha`, asserts the inline-mount filter returns the correct subset and that `ReviewQueuePanel` shows the others under an "Other modes" section.
- `bulk-remove-addressed.test.ts` — service-level guard tests for the new IPC: rejects on `worktree_mismatch`, rejects on `not_addressed` (any `open` id in the batch fails the whole batch), succeeds and emits one `deleted` event for a valid batch.
- `ReviewQueuePanel.test.tsx` — RTL: groups by file, count chip math, "Clear all addressed" fires bulk handler, row click fires `onJump(comment)` with the full comment object, groups by active/other modes correctly.
- `queue-jump.test.ts` — given a stub dispatch and a `diff-editor-registry`, assert `onJump` for a `working-tree` comment dispatches `{ type: "session/selectChangedFile", relativePath }` then scrolls; for a `commit` comment dispatches `{ type: "session/selectCommit", sha }` then `{ type: "session/selectCommitFile", relativePath }` in that order then scrolls. Also assert the ≤500ms editor-registration timeout surfaces the "File no longer in this diff" toast and leaves the comment in the queue.
- `InlineCommentThread.test.tsx` — RTL: state transitions `open → editing → save → open`; `open → addressed-strip`; strip click expands; `↺` reopens.

### E2E (playwright)

**Precondition — unskip the suite.** `tests/e2e/review-comments.test.ts` currently calls `test.skip(...)` at line 128 with the note "Blocked: contextBridge/preload not surfacing window.ai14all under Playwright 1.59 + Electron 41 — all E2E tests broken in this environment". Rewriting the cases below is meaningless until that block is removed and the underlying preload-surfacing issue is resolved. The implementation plan MUST treat this as an in-scope task (investigate, fix or upgrade Playwright/Electron, then unskip). If the fix turns out to be larger than this redesign can absorb, the e2e cases get scaffolded but the task explicitly notes they remain skipped and tracks the blocker — the redesign is not "done" until the suite runs.

Cases to cover once unskipped:

- Hover gutter "+", click, type, save → inline thread visible at correct line.
- Select 3 lines → pill appears → click → multi-line thread created.
- Edit body, save → body updated; cancel → unchanged.
- Mark addressed → folds to strip; click strip → expands; `↺` reopens.
- "Clear all addressed" empties strips inline and rows in queue.
- Queue row click jumps to correct file + scrolls + flash highlight on thread.
- Draft preservation across file switch (pending row + restore on return).

### Manual gate

Before claiming complete, run `pnpm dev` and walk the golden path plus each edge case from §Error handling. Verification rule applies (global rule 14, verification-before-completion skill).

## Implementation notes

- Reuse `diff-editor-registry` to resolve an editor for a given file path before mounting widgets / view-zones.
- View-zone DOM target is a host `<div>` returned by `inline-thread-mount.ts`; React renders into it via `createPortal`. The mount bridge owns measurement and calls `editor.changeViewZones` to update `heightInPx`.
- Decorations and content widgets are created and disposed in the same registration that owns view-zones — one teardown unwinds everything.
- File-tree badge is a `data-comment-count` attribute on the changed-files row consumed by existing styles; no new component.

## Open follow-ups (out of scope)

- Line-drift / snippet-match anchoring when code changes after a comment is created.
- Threaded replies including agent-authored messages tied to the fix-review MCP flow.
- Animated transitions for fold / expand / mount.
- Multi-file overview tab.
- Optimistic state in `use-review-comments` (mutate → immediate local apply → rollback on IPC error). This iteration stays refresh-driven to match the current hook shape.
