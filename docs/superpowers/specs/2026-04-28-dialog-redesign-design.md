# Dialog Redesign — Shared `<AppDialog>` Frame & Button Unification

## Problem

Confirm/discard dialogs in the app use three different frame implementations:

- **Radix + `.shell-modal`** (7 dialogs): NewWorktreeDialog, RemoveWorktreeDialog, ConfirmCloseDialog, SaveConflictDialog, DiscardChangeDialog, ForcePushDialog, LoadWorkspaceDialog (with `--workspace-picker` width modifier).
- **Radix + bespoke classes** (1 dialog): PresetManager uses `.shell-preset-overlay` / `.shell-preset-dialog` — its own one-off styling.
- **Hand-rolled, no overlay** (1 dialog): AgentInstallModal — raw `<div className="shell-modal">` with no backdrop, no focus trap, no Esc-to-close, and uses non-toolbar button classes (`shell-button-primary` / `shell-button-secondary` introduced for this dialog only).

Result: backdrop behavior, footer divider, max-height/scroll, button styling, and width modifiers are inconsistent dialog-to-dialog. The recently-added install dialog reads as a foreign control next to the rest of the terminal-aesthetic UI.

Buttons are also inconsistent. The toolbar uses `.shell-button` + `.shell-button--compact` (32 px tall, 2 px radius, panel-bg, subtle border, accent-on-focus). Recently-added dialog buttons use `.shell-button-primary` / `.shell-button-secondary` (accent-filled, different padding) which look like glossy web buttons, not terminal controls.

## Goals

1. One shared dialog component that all 9 confirm/discard dialogs use.
2. Dialog buttons match the toolbar visual language.
3. Affirmative and destructive intent signaled by **color only**, not shape — preserves the flat terminal aesthetic.
4. All dialog text inputs share one input style (the existing preset/note input look), with a thinner focus outline that applies globally (inputs, buttons, tabs).

## Non-Goals

- Restyle EditorModal or MarkdownPreviewModal (content viewers, out of scope).
- Change body-content layout inside individual dialogs.
- Tweak global design tokens (palette, radii, spacing, font sizes).
- Add animation, custom shadows, or new visual flourishes.

## Architecture

### `<AppDialog>` component

New file: `src/components/AppDialog.tsx`. Built on `@radix-ui/react-dialog` (existing dependency, already used by 7 of 9 target dialogs). Compound component pattern via attached static members.

```tsx
<AppDialog open={open} onOpenChange={fn} size?="default" | "wide">
  <AppDialog.Title>...</AppDialog.Title>
  <AppDialog.Description>...</AppDialog.Description>  {/* optional */}
  <AppDialog.Body>...</AppDialog.Body>
  <AppDialog.Footer>
    <button className="shell-button shell-button--compact">Cancel</button>
    <button className="shell-button shell-button--compact shell-button--primary">Confirm</button>
  </AppDialog.Footer>
</AppDialog>
```

API contract:

| Prop / slot | Type | Notes |
|---|---|---|
| `open` | `boolean` | Forwarded to `Dialog.Root`. |
| `onOpenChange` | `(open: boolean) => void` | Fired on overlay click, Esc, or `AppDialog.Close`. |
| `size` | `"default" \| "wide"` | `default` = 460 px (replaces `.shell-modal`); `wide` = 640 px (replaces `.shell-modal--workspace-picker`, `.shell-preset-dialog`). |
| `<AppDialog.Title>` | `ReactNode` | Wraps `Dialog.Title`. Required for a11y. |
| `<AppDialog.Description>` | `ReactNode` | Wraps `Dialog.Description`. Optional. Renders intro/help text. |
| `<AppDialog.Body>` | `ReactNode` | Scroll container (overflow:auto, flex-grow). Fills remaining space. |
| `<AppDialog.Footer>` | `ReactNode` | Flex row, justify-end, top divider. Caller chooses buttons. |

Buttons are caller's responsibility — `<Footer>` is just a flex row. This avoids forcing a procrustean prop API on PresetManager (which has multi-row actions) and lets each dialog pick the appropriate button modifiers.

### Visual frame

Lives in `src/app/shell.css` under a new section (`.shell-app-dialog*`):

```css
.shell-app-dialog__overlay {
	position: fixed;
	inset: 0;
	background: rgba(3, 8, 12, 0.7);
	z-index: 51;
}
.shell-app-dialog {
	position: fixed;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	width: min(460px, calc(100vw - 32px));
	max-height: calc(100vh - 64px);
	display: flex;
	flex-direction: column;
	padding: var(--space-4);
	background: var(--panel-bg-elevated);
	border: 1px solid var(--panel-border-strong);
	border-radius: var(--radius-md);
	z-index: 52;
}
.shell-app-dialog--wide {
	width: min(640px, calc(100vw - 32px));
}
.shell-app-dialog__title {
	font-size: var(--font-size-label);
	font-weight: 600;
	margin: 0 0 var(--space-3);
}
.shell-app-dialog__description {
	color: var(--text-secondary);
	font-size: var(--font-size-body);
	margin: 0 0 var(--space-3);
}
.shell-app-dialog__body {
	flex: 1;
	min-height: 0;
	overflow: auto;
}
.shell-app-dialog__footer {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: var(--space-4);
	padding-top: var(--space-3);
	border-top: 1px solid var(--panel-border);
}
```

Notes:

- Inherits `--font-ui` (no monospace switch — terminal aesthetic comes from palette + tight radii + small body, not from the dialog font).
- `flex-column + max-height + overflow:auto` lets long bodies scroll while title and footer stay pinned. Today's `.shell-modal` doesn't constrain height — silently overflows on small viewports.
- Footer top divider (`--panel-border`) is the polish anchoring the action row consistently across all dialogs. No existing dialog has this; the consistency is the visual win.
- Frame palette/radius/border match the sidebar/file-overlay so the dialog reads as part of the same surface family.

### Button unification

Buttons inside dialogs use the existing toolbar base, plus a new `--primary` color modifier and the existing `--danger` color modifier:

```css
/* New */
.shell-button--primary {
	border-color: var(--accent);
	color: var(--accent);
}
.shell-button--primary:hover {
	background: var(--accent-strong);
}

/* Already exists — kept */
.shell-button--danger {
	border-color: rgba(217, 140, 140, 0.5);
	color: var(--danger);
}
.shell-button--danger:hover {
	background: rgba(217, 140, 140, 0.12);
}
```

Usage inside dialog footers:

| Action | Class |
|---|---|
| Cancel / Close / neutral | `shell-button shell-button--compact` |
| Confirm / Install / Save / affirmative | `shell-button shell-button--compact shell-button--primary` |
| Discard / Remove / Force-push / destructive | `shell-button shell-button--compact shell-button--danger` |

Identical shape/size/typography across toolbar and dialogs. Color signals intent.

`AgentInstallCta` (sidebar footer Install… button) keeps an emphasized look but switches from the deleted `.shell-button-primary` (filled accent) to `.shell-button shell-button--compact shell-button--primary` (accent border + text) — matches dialog buttons and toolbar shape.

### Input unification

The existing `.shell-note-input` is a slight misnomer — born for session notes, but already reused by PresetManager (label + command inputs), NewWorktreeDialog (name + session title), ContextPanel, NoteSheet, and WorktreeTree. The current rule:

```css
.shell-note-input {
	width: 100%;
	margin-top: var(--space-2);
	padding: var(--space-3);
	color: var(--text-primary);
	background: rgba(13, 20, 25, 0.22);
	border: 1px solid var(--panel-border);
	border-radius: var(--radius-sm);
	resize: vertical;
}
```

Renamed to `.shell-input` and applied to every dialog text input. The visual itself does not change — only the class name. RepositoryInput (LoadWorkspaceDialog's path field, currently a bare `<input>` with inline `style={{ width: 400 }}`) adopts `.shell-input` and drops the inline styles; the Browse and Submit buttons get `shell-button shell-button--compact` (Submit also takes `--primary`).

Affected files (rename consumers): `src/features/terminals/PresetManager.tsx`, `src/features/workspace/ContextPanel.tsx`, `src/features/workspace/NoteSheet.tsx`, `src/features/workspace/NewWorktreeDialog.tsx`, `src/features/viewer/WorktreeTree.tsx`, plus `src/app/shell.css`. RepositoryInput gains the class.

### Focus outline thinning

Today's rule:

```css
.shell-note-input:focus-visible,
.shell-button:focus-visible,
[role="tab"]:focus-visible {
	outline: 2px solid var(--accent);
	outline-offset: 2px;
}
```

Becomes:

```css
.shell-input:focus-visible,
.shell-button:focus-visible,
[role="tab"]:focus-visible {
	outline: 1px solid var(--accent);
	outline-offset: 2px;
}
```

Applies globally — inputs, buttons, and tabs all gain the lighter focus ring. Matches the terminal aesthetic (thin, precise borders rather than chunky web emphasis).

## Migration

| Dialog | Frame today | Frame after |
|---|---|---|
| LoadWorkspaceDialog | Radix + `shell-modal--workspace-picker` | `<AppDialog size="wide">` |
| NewWorktreeDialog | Radix + `shell-modal--worktree` | `<AppDialog>` |
| RemoveWorktreeDialog | Radix + `shell-modal` | `<AppDialog>` |
| PresetManager | Radix + `shell-preset-overlay/dialog` | `<AppDialog size="wide">` |
| AgentInstallModal | Hand-rolled, no overlay | `<AppDialog>` (gains backdrop, focus trap, Esc-close) |
| ConfirmCloseDialog | Radix + `shell-modal` | `<AppDialog>` |
| SaveConflictDialog | Radix + `shell-modal` | `<AppDialog>` |
| DiscardChangeDialog | Radix + `shell-modal` | `<AppDialog>` |
| ForcePushDialog | Radix + `shell-modal` | `<AppDialog>` |

Per-dialog steps:

1. Replace Radix `Portal/Overlay/Content` boilerplate with `<AppDialog open onOpenChange>`.
2. Wrap title in `<AppDialog.Title>`. Move any intro paragraph (typically `<p className="shell-modal__copy">`) into `<AppDialog.Description>`.
3. Move body content into `<AppDialog.Body>`.
4. Wrap the action row in `<AppDialog.Footer>`.
5. Normalize button classNames per the unification table above.

CSS cleanup commit (last):

- Remove `.shell-modal-overlay`, `.shell-modal`, `.shell-modal__preview`, `.shell-modal__actions`, `.shell-modal__copy`, `.shell-modal__field`, `.shell-modal__confirm-dirty`, `.shell-modal--worktree`, `.shell-modal--workspace-picker`.
- Remove `.shell-preset-overlay`, `.shell-preset-dialog`.
- Remove `.shell-button-primary`, `.shell-button-secondary` (replaced by `.shell-button--primary` modifier).
- Remove `.shell-note-input` (renamed to `.shell-input` in its own phase).

Pre-deletion grep confirms no other consumers (Editor/MarkdownPreview do not use `.shell-modal`; no remaining `shell-note-input` references after the rename phase).

## Testing

### Unit

- `tests/unit/components/AppDialog.test.tsx` (new):
  - Renders title, description (when present), body, footer slots.
  - Calls `onOpenChange(false)` on overlay click and on Esc.
  - Applies `--wide` modifier when `size="wide"`.
  - Description slot is omitted from DOM when not provided.
- Per-dialog test files already exist for the migrated dialogs. Update class-name assertions where they reference `.shell-modal*` (rename to `.shell-app-dialog*`). Logic and behavioral assertions unchanged.

### Manual

- Open each of the 9 dialogs in the running app. Verify:
  - Backdrop dims background.
  - Esc closes.
  - Overlay click closes (where the dialog allows it — destructive flows like ForcePush/Discard may want overlay clicks to be a no-op; preserve current per-dialog behavior).
  - Footer top divider is visible.
  - Buttons match the toolbar in height, radius, font.
  - Long-body dialogs (PresetManager, AgentInstallModal) scroll inside the body, with title and footer pinned.
  - All text inputs across dialogs share the same look (LoadWorkspace path, NewWorktree name/title, PresetManager label/command).
  - Focus rings on inputs, buttons, and tabs are 1 px (not 2 px).

## Error Handling

- Radix Dialog handles focus trap, restore on close, and Esc. Inherited.
- Per-dialog error banners (`.shell-error-banner`, `.shell-error`) live inside `<AppDialog.Body>` — unchanged.
- Overlay-click-to-dismiss is opt-out via existing per-dialog `onOpenChange` logic; no new behavior.

## Implementation Phasing

Per the rule against >3-file changes per task, split into reviewable plans:

1. **Component + CSS + button modifier** — `AppDialog.tsx`, new `.shell-app-dialog*` block in `shell.css`, new `.shell-button--primary` rule, AppDialog unit test. No dialog migrations yet; old `.shell-modal*` classes remain. (3 files.)
2. **Input rename + focus outline thin** — rename `.shell-note-input` → `.shell-input` in `shell.css`, update the 5 TSX consumers (PresetManager, ContextPanel, NoteSheet, NewWorktreeDialog, WorktreeTree), apply `.shell-input` to RepositoryInput (drop inline styles, apply `shell-button shell-button--compact` to its Browse + Submit buttons, Submit also `--primary`), thin the focus-outline rule from 2 px to 1 px. (1 CSS file + 6 TSX files — exceeds the 3-file rule, so this phase splits into two sub-tasks: 2a CSS rename + outline, 2b TSX consumer updates.)
3. **Migrate batch A** — LoadWorkspaceDialog, NewWorktreeDialog, RemoveWorktreeDialog. Update their tests' class-name assertions.
4. **Migrate batch B** — ConfirmCloseDialog, SaveConflictDialog, DiscardChangeDialog, ForcePushDialog. Update their tests.
5. **Migrate batch C** — PresetManager, AgentInstallModal. Update `AgentInstallCta` button to use the new `--primary` modifier. Update tests.
6. **CSS cleanup** — delete dead `.shell-modal*`, `.shell-preset-*`, `.shell-button-primary`, `.shell-button-secondary` rules. Pre-deletion grep verifies no remaining consumers. (1 file.)

Each phase ships independently and leaves the app in a working state.
