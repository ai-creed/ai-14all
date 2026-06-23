# Devel smoke-test UI fixes: cursor, note drawer, dirty bar, double close

Date: 2026-06-10
Status: Approved — implementing
Branch: `smoke-test-fixes-2` (off `devel`)

## Problem

A manual smoke pass on `devel` (post PR #15) surfaced five UI regressions. Four
were already fixed on `fix/smoke-test-ui-fixes`, but that branch was never
merged into `devel` and is slated for deletion, so the fixes must be carried
over. The fifth needs a new (one-line) change.

1. **Buttons without pointer cursor.** Tailwind v4 preflight sets
   `cursor: default` on `button`; `src/styles/tokens.css` on `devel` has no
   restoring rule, so enabled buttons read as inert.
2. **Notes chrome renders as a centered dialog.** shadcn `DialogContent`'s
   `left-[50%]` utility wins over `.shell-note-sheet`'s `right: 0`
   (`src/app/shell.css:1864`) — when both `left` and `right` are set with an
   explicit width, `left` wins in LTR. The session-note drawer therefore
   appears centered instead of docked.
3. **Save/Discard buttons in the file edit view have no button layout.**
   `EditorDirtyBar.tsx` still references `.shell-btn` / `.shell-btn--primary`,
   but that CSS was purged from `shell.css` during the shadcn migration
   (0 matches on `devel`), leaving bare unstyled text buttons.
4. **Double X (close) in the notes dialog.** `src/components/ui/dialog.tsx`
   renders its built-in `DialogPrimitive.Close` unconditionally; `NoteSheet`
   renders its own header close button, so two X buttons appear.
5. **Note drawer appear animation.** `DialogContent`'s default
   `data-[state=open]` zoom/fade animation is center-anchored and unwanted for
   an edge-docked drawer. Desired behavior: docked to the right edge, appears
   instantly, no animation.

Issues 2 and 5 (position) share one root cause; issue 5's animation half needs
the new change.

## Fix

Cherry-pick the four existing fix commits from `fix/smoke-test-ui-fixes` onto
`smoke-test-fixes-2`, in order, then add one new commit:

| # | Commit | Change |
|---|--------|--------|
| 1 | `5c29804` | `tokens.css`: restore `cursor: pointer` on enabled buttons (7 lines). |
| 2 | `216023e` | `shell.css`: `left: auto;` on `.shell-note-sheet` so the drawer re-docks right. |
| 3 | `5e76bef` | `EditorDirtyBar.tsx`: migrate Save/Discard to shadcn `Button` (default + secondary variants). |
| 4 | `b18b802` | `dialog.tsx`: add `hideClose` prop (default `false`, built-in close shown); opt out `NoteSheet`, `MarkdownPreviewModal`, `ShortcutsHelp`; update their unit tests. |
| 5 | new | `shell.css`: `animation: none;` in the `.shell-note-sheet` rule, killing the center-anchored open animation. |

Explicitly **not** cherry-picked: `7cf05be` (`bea1850` on
`fix/smoke-test-ui-fixes`), the 400ms slide-in for the note drawer — the
decided behavior is no appear animation at all. Commit 5 is that commit's
`animation: none;` hunk without the keyframes.

## Out of scope

- Restyling other dialogs' animations (shortcuts help, markdown preview,
  files overlay keep stock behavior).
- The TUI theme work (`feat/terminal-ui-theme`); `docs/tui-css-spec.md` covers
  it separately.

## Verification

1. Unit: `pnpm test` — must pass, specifically
   `tests/unit/components/NoteSheet.test.tsx` (gains a no-built-in-close
   assertion via commit 4) and `tests/unit/components/MarkdownPreviewModal.test.tsx`.
2. Build: `pnpm exec electron-vite build` — clean.
3. Manual smoke, one check per issue:
   - hover any enabled button → pointer cursor; disabled → default;
   - open session notes → drawer docked flush to the right edge;
   - drawer appears instantly, no zoom/fade/slide;
   - exactly one X in the notes drawer header;
   - edit a file → Save (primary) and Discard (secondary) render as buttons.
4. Push `smoke-test-fixes-2` to origin.
