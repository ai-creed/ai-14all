# Clickable Review Chips — Design

Date: 2026-05-23
Status: Approved (pending implementation)

## Problem

The review chip bar (`src/app/components/ReviewChipBar.tsx`) shows two
informational chips as static text:

- `"x changed"` — the count of changed files (shown when the worktree is dirty).
- `"N open · M addressed"` — review comment counts.

These read like calls to action but do nothing when clicked. Users expect them
to behave as shortcuts to the thing the count refers to.

## Goal

Make the actionable chips clickable so they navigate directly to what they
describe:

- **Changed-files chip** → open the review overlay in **Files** mode with the
  first changed file selected.
- **Open-comments chip** → open the review overlay, open the comment sidebar,
  and jump to the first active (unaddressed) comment.

Non-actionable states stay static (no misleading affordance):

- `"✓ clean"` (no changes) — not clickable.
- `"M addressed"` portion / addressed-only state — not clickable. (Addressed
  comments are explicitly out of scope.)

## Decisions (confirmed with user)

1. Comment chip click **jumps to the comment in the diff** (reuses the existing
   `handleJump` path: selects file → waits for editor → scrolls to line range →
   focuses thread), not merely scrolling the sidebar list.
2. Only **actionable** chips are clickable. `"✓ clean"` and addressed-only stay
   static.
3. Changed-files chip **forces Files mode** and selects the first changed file.

## Architecture & Data Flow

Two independent flows. The Files flow is entirely App-level; the comment flow
needs a signal into `ReviewArea` because the jump logic lives there.

### Files chip (App-level only)

On click:

```
const target = firstViewableChangedFile   // first change with status !== "D"
if (target) dispatch({ type: "session/selectFile", worktreeId, relativePath: target.path })
setReviewOpen(true)
```

`changes` comes from `activeSummary.changedFiles`.
`firstViewableChangedFile = changes.find(c => c.status !== "D")`.

**Why skip deleted (`status === "D"`) files:** Files mode renders the on-disk
file content via `FileViewer`. A deleted file has no working-tree content —
`file-service.ts` returns `{ ok: false, reason: "not-found" }` (line 176) — so
selecting it lands on a "file not found" state. We therefore pick the first
**non-deleted** changed file as the default. `GitChangeStatus` is
`"M" | "A" | "D" | "R" | "??"` (`shared/models/git-change.ts:1`).

**Why `session/selectFile`, not `handleSelectChangedFile`:** the
`session/selectChangedFile` action (which `handleSelectChangedFile` dispatches)
forces `reviewMode: "changes"` in the reducer
(`src/features/workspace/logic/workspace-state.ts:1072`). To land in **Files**
mode we use `session/selectFile`, which the same reducer maps to
`reviewMode: "files"`, `viewerMode: "file"`, and `selectedFilePath`
(`workspace-state.ts:1065`). `setReviewOpen` already exists in `App.tsx`. The
button is only reachable when `firstViewableChangedFile` exists (see
`canOpenFiles` gate), so `target` is present in practice; the guard is defensive.

### Comment chip (App signal → ReviewArea reaction)

The jump logic (`handleJump`) currently lives **inside** the
`commentSidebarOpen && (() => { ... })()` IIFE in `ReviewArea.tsx:764-784`, so it
is not reachable from a component-scope effect. This flow requires lifting it
out (see ReviewArea changes below). The chip is at App level, so App raises a
signal that `ReviewArea` consumes.

On click:

```
setReviewOpen(true)
setCommentSidebarOpen(true)
setPendingCommentJump(n => n + 1)   // monotonic nonce
```

`ReviewArea` receives `pendingCommentJump` (number) and
`onConsumePendingCommentJump` (callback) as props. The nonce-reacting effect is
extracted into a dedicated hook, `usePendingCommentJump`, so the
timeout-wiring contract can be unit-tested without rendering all of `ReviewArea`:

```
usePendingCommentJump({
    nonce: pendingCommentJump,
    comments: reviewState.comments,
    jump: jumpToComment,                 // (comment, { editorTimeoutMs }) => void
    onConsume: onConsumePendingCommentJump,
})
// hook body:
//   if (nonce <= 0) return
//   const first = comments.find(c => c.status === "open")
//   if (first) jump(first, { editorTimeoutMs: COLD_JUMP_TIMEOUT_MS })
//   onConsume()
```

The hook — not `ReviewArea` inline code — owns the choice of
`COLD_JUMP_TIMEOUT_MS`, which is what makes the cold-timeout contract directly
testable (see Testing). A nonce (rather than a boolean) lets repeated clicks
re-trigger the jump.

**Cold-open editor race (must handle).** `jumpToComment` (the lifted
`handleJump`) dispatches the file-selection action, then polls
`diffEditorRegistry` via `waitForEditor`. But selecting the file kicks off an
**async** diff load (`useDiffLoader` → `git.readDiff` IPC,
`src/app/hooks/use-diff-loader.ts:27`), and Monaco only registers the editor
**after** that resolves and mounts. `waitForEditor`'s default timeout is 500ms
(`src/features/review/logic/queue-jump.ts:44`) — fine when the overlay is
already open and the editor is mounted (the existing sidebar-jump case), but
from a freshly opened overlay the diff fetch + mount can exceed 500ms, producing
a false "File no longer in this diff" toast.

Mitigation: parameterize `waitForEditor`'s timeout (already an argument) and have
the chip-initiated path pass a generous `COLD_JUMP_TIMEOUT_MS` (e.g. 5000ms).
`waitForEditor` polls every 16ms and returns as soon as the editor registers, so
the larger budget only affects the genuine "never mounts" failure case; the
common path still resolves the instant the diff finishes loading. The existing
sidebar-jump call keeps the 500ms default — its editor is already mounted.

"First active comment" = first element of `reviewState.comments` with
`status === "open"` (matches the `openCommentCount` definition in `App.tsx`).

## Components

### `ReviewChipBar.tsx`

- New props: `onOpenFiles: () => void`, `onOpenComments: () => void`,
  `canOpenFiles: boolean`.
- `"x changed"` → `<button>` only when **`canOpenFiles`**; `onClick =
  onOpenFiles`. `canOpenFiles` is computed in App as `isDirty &&
  firstViewableChangedFile != null` — it is false both when there are no changes
  and when every change is a deletion, so the button is never a no-op. When
  `isDirty` is true but `canOpenFiles` is false, the "x changed" count still
  renders as a plain `<span>` (informational, not actionable).
- `"N open"` span → `<button>` (only when `openCommentCount > 0`);
  `onClick = onOpenComments`.
- `"✓ clean"` and `"M addressed"` remain plain `<span>`.
- Native `<button>` gives keyboard accessibility and focus handling for free.
- Styling reuses existing chip classes plus a hover/cursor affordance so the
  chips read as clickable; visual weight unchanged otherwise.

### `App.tsx`

- Add `pendingCommentJump` state (number, default 0) and its setter.
- Compute `firstViewableChangedFile = changes.find(c => c.status !== "D")` and
  `canOpenFiles = (activeSummary?.isDirty ?? false) && firstViewableChangedFile != null`.
- Define `onOpenFiles` / `onOpenComments` handlers as above.
- Pass the two callbacks plus `canOpenFiles` to `ReviewChipBar`.
- Pass `pendingCommentJump` and `onConsumePendingCommentJump={() =>
  setPendingCommentJump(0)}` to `ReviewArea`.

### `ReviewArea.tsx`

- **Lift `handleJump` to component scope** as a `useCallback` (call it
  `jumpToComment`), out of the `commentSidebarOpen && (() => {...})()` IIFE where
  it is defined today (`ReviewArea.tsx:764-784`). It captures only `dispatch`,
  `diffEditorRegistry`, `toast`, and `setFocusedThreadId` — none of the IIFE's
  `reviewMode`/`commitSha` locals — so the lift is mechanical. The IIFE passes
  the lifted `jumpToComment` to `ReviewQueuePanel`'s `onJump` (behavior
  unchanged; existing 500ms timeout retained for that call site).
- Add `editorTimeoutMs` as an option to `jumpToComment`, forwarded to
  `waitForEditor` (default 500ms).
- Accept `pendingCommentJump` and `onConsumePendingCommentJump` props and drive
  them through the `usePendingCommentJump` hook (which owns
  `COLD_JUMP_TIMEOUT_MS`), rather than an inline effect.
- Expose the focused thread on the review grid container as
  `data-focused-thread-id={focusedThreadId ?? ""}` so the e2e (and assistive
  tooling) can observe which comment the jump focused.

## Error / Edge Handling

- `changes` empty while `isDirty`, or **every change is a deletion** (`status
  === "D"`) → `canOpenFiles` is false, so the files chip renders as static text
  (no actionable, no-op affordance). `onOpenFiles` additionally guards on
  `firstViewableChangedFile`.
- First changed file is deleted but a later one is viewable → `onOpenFiles`
  selects the first non-deleted file, not `changes[0]`.
- `openCommentCount === 0` (only addressed, or none) → comment chip text stays
  static; no button, no signal.
- Comment's file no longer in the diff → `jumpToComment` shows the
  "File no longer in this diff" toast; no extra handling needed.
- Cold-open editor race → covered by the larger `COLD_JUMP_TIMEOUT_MS` on the
  chip-initiated jump (see Comment chip section).

## Testing

- **Unit (`ReviewChipBar`)**: renders a button for "x changed" only when
  `canOpenFiles` (static text when `isDirty` but `canOpenFiles` is false);
  renders a button for "N open" only when `openCommentCount > 0`; "✓ clean" and
  "M addressed" render as non-interactive text; clicking each button invokes the
  matching callback exactly once.
- **Unit (App `canOpenFiles` / `firstViewableChangedFile` selection)**: with a
  mix of changes, picks the first non-`D` file; with only `D` changes,
  `canOpenFiles` is false; with a leading `D` then an `M`, picks the `M`.
- **Unit — cold-open race (REQUIRED, deterministic regression guard)**: the
  contract at the "Cold-open editor race (must handle)" section above must be
  proven by a test that does **not** depend on machine speed. Drive
  `waitForEditor`/`jumpToComment` with fake timers and an editor-registry getter
  that returns `null` until a simulated delay **strictly greater than 500ms**
  (e.g. 1500ms), then returns a stub editor. Assert both directions so the test
  fails if the chip path silently reverts to the 500ms default:
    1. With the **default 500ms** timeout (the sidebar-jump call site), the
       getter never resolves in time → `waitForEditor` returns `null` →
       `jumpToComment` shows the "File no longer in this diff" toast and does
       **not** scroll/focus. This pins the regression: 500ms is insufficient for
       a delayed mount.
    2. With **`COLD_JUMP_TIMEOUT_MS`** (the chip-initiated call site), the same
       delayed getter resolves → `waitForEditor` returns the editor →
       `jumpToComment` calls `scrollToLineRange` and sets the focused thread, and
       no "File no longer" toast is shown.
  The test must assert `COLD_JUMP_TIMEOUT_MS > 500`.
- **Unit — `usePendingCommentJump` wiring (REQUIRED)**: render the hook (e.g.
  `renderHook`) with `nonce = 1`, a `comments` array whose first `status: "open"`
  entry is `C`, and spy `jump`/`onConsume`. Assert `jump` is called exactly once
  with `C` **and** an options object whose `editorTimeoutMs === COLD_JUMP_TIMEOUT_MS`
  (not 500, not undefined), and that `onConsume` is called. Add a second case
  with `nonce = 0` asserting `jump` is **not** called. This pins the contract
  that the chip-initiated path widens the timeout — an implementation that
  forgets and passes the default fails this test, independently of the e2e.
- **e2e — changed-files chip**: seed a deterministic, viewable first change by
  writing a text file that sorts first (`changedFiles` is sorted by
  `path.localeCompare`, `services/git/git-service.ts:244`) — e.g.
  `AAA-first.ts` — into the worktree, then refresh. Click the "x changed" chip
  and assert: (1) the review overlay is open, (2) the Files tab is active, and
  (3) the file viewer (`.shell-viewer__title`) shows that seeded file's path —
  i.e. the first non-deleted changed file is actually selected and rendered, not
  merely that the tab switched.
- **e2e — open-comments chip**: create one open comment in a known file
  (`src/index.ts`) via the inline-draft flow, close the overlay, then click the
  "N open" chip and assert: (1) the review overlay is open with the comment
  queue panel (`[data-testid="review-queue-panel"]`) visible, (2) the changed
  file selected is the comment's file (the `[data-selected="true"]` row /
  `.shell-viewer__title` reflects `src/index.ts`), (3) the comment's inline
  thread (`.shell-inline-thread` containing its body) is visible — i.e. the jump
  navigated to and revealed the comment, and (4) the review surface exposes the
  focused thread (`data-focused-thread-id` is non-empty on the review grid),
  proving focus was set, not just that the sidebar opened.

## Scope

The feature centers on three UI surfaces — `ReviewChipBar.tsx`, `App.tsx`,
`ReviewArea.tsx` — plus a small set of supporting files that exist solely to
make this feature's behavior testable per the verification contract above. No
unrelated refactoring. Full file list:

- `src/app/components/ReviewChipBar.tsx` — clickable chips (new props/buttons).
- `src/app/App.tsx` — gate computation, handlers, nonce state, prop wiring.
- `src/app/components/ReviewArea.tsx` — lifted `jumpToComment`, hook usage,
  `data-focused-thread-id`.
- `src/features/review/logic/queue-jump.ts` (modify) — `COLD_JUMP_TIMEOUT_MS`
  and the extracted, fake-timer-testable `runCommentJump`. (The spec's cold-open
  contract explicitly names this "supporting existing jump logic".)
- `src/features/review/hooks/use-pending-comment-jump.ts` (new) — the
  nonce-reacting hook that owns `COLD_JUMP_TIMEOUT_MS`; isolated so the
  timeout-wiring contract is unit-testable without rendering `ReviewArea`.
- `src/app/logic/review-chip-target.ts` (new) — pure `firstViewableChangedFile`
  helper; isolated so the deleted-file selection rule is unit-testable without
  rendering `App`.
- `src/app/shell.css` (modify) — button affordance for the actionable chips.
- Tests (unit + e2e) for all of the above.

The two new helper modules and the `queue-jump.ts` change are not scope creep —
each is the minimal seam required by a REQUIRED deterministic test in the
Testing section, and none adds behavior beyond what this spec describes.
