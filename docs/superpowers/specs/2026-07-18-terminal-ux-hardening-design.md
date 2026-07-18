# ai-14all — Terminal UX Hardening (slot chrome)

**Status:** design approved (brainstorm 2026-07-18, interactive mockup validated as Artifact
<https://claude.ai/code/artifact/488eeecf-4f9c-49dc-87da-0105abafd215>). **Owner:** Vu Phan.
**Repo:** ai-14all. **Branch:** `master`.

## 1. Context & goal

Four small hardening items for the terminal slot chrome, collected 2026-07-18:

1. **D1 / D1b** — the slot header shows no agent identity: which provider runs in a pane, and
   whether the pane belongs to a whisper collab pair, is invisible.
2. **D2** — the header's Restart and Close buttons kill the pane's process with no confirmation.
3. **D3** — nothing indicates which pane's pty currently captures keyboard input.
4. **D4** — the TUI theme renders terminal slot borders at 2px, visibly heavier than every other
   theme.

The validated mockup is **normative for all visual decisions** (geometry, tints, dialog layout,
settings rows, focus border colors). This spec records data sources, conditions, contracts, and
scope.

## 2. Current state (verified against master @49a52235)

- Slot header markup: `src/app/components/TerminalPanel.tsx:153-214` — status badge dot, label,
  promote / refit / restart / close buttons. No provider identity.
- `ProcessSession.provider: AgentProvider | null` and sticky `agentDetected` already exist
  (`shared/models/process-session.ts:31-32`), populated by agent detection.
- Provider registry with per-provider `brand` CSS tokens: `shared/models/agent-provider.ts`;
  token values `--provider-*` in `src/app/shell.css:55-59` (dark), `:81-85` (light), and the
  warm block.
- Collab launches record `command = "whisper collab mount <provider>"` and
  `label = "collab: <agent>"` on the ProcessSession (`src/app/App.tsx:906-927`).
- Whisper renderer state: `WhisperWorktreeState { daemonAlive, bindings[]: { agentType,
  bindingState } }` (`shared/models/ecosystem-plugin.ts:106-117`), streamed per worktree
  (`whisperStates` map in App).
- Restart/close handlers: `handleRestartProcess` / `handleCloseProcess`
  (`src/app/hooks/use-process-actions.ts:262` / `:145`), threaded to TerminalPanel as
  `onRestartSlot` / `onCloseSlot` (`src/app/App.tsx:2451-2452`).
- No styled confirm dialog exists; five `window.confirm` call sites elsewhere. Radix dialog
  primitive at `src/components/ui/dialog.tsx`. TUI motion-kill already covers Radix overlays
  (`src/styles/tui.css:18-21`).
- Settings: `PersistedSettingsV1Schema` + `SettingsPatchSchema`
  (`shared/models/persisted-settings.ts`). Nested patch schemas must be **bare**
  (non-`.default()`) — zod v4 re-injects defaults on parse otherwise; the gotcha and its repro
  are documented in-file. Settings dialog: `src/features/settings/components/SettingsDialog.tsx`.
- Focus: `TerminalPane` receives `focused` (active-pane selection) but nothing renders it.
  Slot CSS: `src/app/shell.css:4833-4913`.
- TUI borders: `--shell-border-width: 2px` (`src/styles/tui.css:33-42`, deliberate per
  `docs/tui-css-spec.md` D3); slot border consumes it (`shell.css:4838`), slot-header
  border-bottom too (`shell.css:4858`). The stacked-pane `border-top: 2px` separator
  (`shell.css:4857`) is hardcoded identically in **all** themes.

## 3. D1 — provider logo in the slot header

- New `ProviderLogo` component (`src/features/terminals/components/ProviderLogo.tsx`): one
  inline monochrome SVG per `AgentProviderId`, stroke-based, `currentColor`, `viewBox 0 0 24 24`,
  rendered at 13px. Ezio wears the 14all pyramid mark (in-house agent). The mockup's glyph
  shapes are placeholders; final paths are traced at implementation under the same
  monochrome-currentColor contract (TUI aesthetic constraint: monochrome glyphs, never colorful
  badges).
- Rendered in the slot header between the status dot and the label, tinted
  `providerDef(provider).brand`. Tooltip (`title`) = provider label.
- Condition: `process.provider` is a known `AgentProviderId`. `null` or `"other"` → no glyph;
  plain shells' headers stay byte-identical to today.

## 4. D1b — whisper collab pair glyph

- Pure helper in `src/features/terminals/logic/agent-launch.ts`:

  ```ts
  collabGlyphState(
    process: ProcessSession,
    whisper: WhisperWorktreeState | undefined,
  ): { pairLabel: string } | null
  ```

  Returns non-null when ALL hold:
  1. `process.command?.startsWith("whisper collab mount ")`;
  2. `whisper?.daemonAlive === true`;
  3. the binding whose `agentType` matches the mount command's provider tail has
     `bindingState === "bound"`.

  `pairLabel` joins the bound bindings' agentTypes: two bound →
  `"collab: claude ⇄ codex"`; only this pane's binding bound yet →
  `"collab: claude · waiting for peer"`.
- Rendering: link glyph (Nerd Font via `Icon`, fallback `⧉`) next to the provider logo on every
  pane whose helper returns non-null; native `title` tooltip = `pairLabel` plus
  `· ready for workflows` when both slots are bound. The `ICON_GLYPHS` registry
  (`src/components/ui/icon.tsx:18`) has **no link entry today** — D1b-ii adds
  `link: { fallback: "⧉", nf: "<nf-fa-link codepoint>" }` following the registry's
  \u-escape + trailing-comment convention.
- Tint: `--info` in dark/light/warm (near-white `--primary` would vanish beside label text —
  mockup-validated); `--primary` teal under `[data-theme="tui"]` via a tui.css re-point rule,
  matching the chrome bar's accent-tone collab pill.
- Live behavior: `activeWhisperState` is threaded into `TerminalPanel` as a new prop; collab
  death or binding drop removes the glyph on the next state push. Panes in other worktrees
  receive their own worktree's state (TerminalPanel already renders per-workspace).
- A collab mounted by hand-typing the mount command into an existing shell has no matching
  `process.command` and shows no glyph — accepted, out of scope (§9).

## 5. D2 — restart / close confirmation

### 5.1 ConfirmDialog component

New `src/components/ui/confirm-dialog.tsx` on the Radix dialog primitive:

```ts
type ConfirmDialogProps = {
  open: boolean;
  title: string;            // "Restart shell?" / "Close shell?"
  body: ReactNode;          // names the shell label + consequence
  confirmLabel: string;     // "Restart" / "Close"
  checkboxLabel: string;    // "Don't ask again for restart/close"
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
};
```

Destructive styling on the confirm button (`--danger` border/text). Confirm button receives
initial focus; Esc / scrim click cancels (Radix defaults). Square corners and zero-duration
motion come free from the existing theme layers. Reusable later by the five `window.confirm`
call sites (not migrated here).

### 5.2 Gating

In `TerminalPanel`, restart/close clicks route through a gate before calling
`onRestartSlot` / `onCloseSlot`:

- process `status === "running"` AND the matching pref is `ask` → open dialog;
- otherwise (exited / error / restarting, or pref `silent`) → invoke immediately.

One dialog state per panel (`{ kind: "restart" | "close"; processId } | null`); a second click
while open retargets the dialog.

### 5.3 Settings

`shared/models/persisted-settings.ts`:

- `PersistedSettingsV1Schema` gains
  `terminalConfirm: z.object({ restart: z.boolean().default(true), close: z.boolean().default(true) }).default({ restart: true, close: true })`
  (`true` = ask).
- `SettingsPatchSchema` gains a **bare** `TerminalConfirmPatchSchema { restart?: boolean;
  close?: boolean }` — per the in-file zod v4 nested-patch gotcha.
- `services/settings/settings-service.ts` — `writeState()` gains a `terminalConfirm`
  deep-merge branch alongside the existing `usageTelemetry` / `phoneBridge` branches
  (`settings-service.ts:122-141`). Without it a partial patch replaces the whole nested
  object and zod re-defaults the omitted sibling to `true` (e.g. suppressing restart would
  silently re-enable a suppressed close warning). That merge block stays the single source of
  truth for nested patches.
- Renderer reads via the SettingsProvider (`initialSettings()` + `onSettingsChanged`); ticking
  "Don't ask again" writes `settings.write({ terminalConfirm: { restart: false } })` (or
  `close`).
- **Optimistic shared store** (`src/app/hooks/use-settings.tsx`): today `update()`
  (`use-settings.tsx:66-71`) commits local state only after `settings.write` resolves, so a
  rejected write would drop the suppression on the floor. `update()` becomes optimistic:
  (1) apply the patch to context state synchronously (nested-merge mirroring `writeState`);
  (2) fire the bridge write with a pending-writes counter; on resolve converge to the
  returned merged settings, on reject swallow — suppression continues in-memory for the
  session; (3) skip `onSettingsChanged` echoes while writes are in flight (the rewind guard
  proven in `use-terminal-font-size.ts:100-107`). Because every confirm surface (slot panel,
  floating handler, SettingsDialog) reads the same SettingsProvider context, the optimistic
  value is shared — no panel-local state.
- `SettingsDialog.tsx` gains two toggle rows (mockup normative) so suppressed warnings can be
  re-enabled.

### 5.4 Floating throwaway shell — close-only, gated at the shared handler

Floating shells expose **two** Kill surfaces, both destructive and both routing to the same
handler: the popover Kill button (`FloatingShellPopover.tsx:285-290`,
`data-testid="floating-shell-close"`) and the minimized-pill Kill button
(`FloatingShellPills.tsx`, `data-testid="floating-shell-pill-close-<id>"`); App wires both
`onClose` props to `handleCloseFloatingShell` (`use-floating-shell-actions.ts:50`). **No
restart affordance exists on floating shells and none is added** (§9).

The gate therefore lives **inside `handleCloseFloatingShell`** — the single choke point —
so both surfaces inherit it without touching either click site: process live AND
`terminalConfirm.close` is ask → the hook parks a pending-close (`{ processId } | null`)
that App renders as the shared ConfirmDialog; exited or pref silent → immediate close. One
preference (`terminalConfirm.close`), every close surface.

## 6. D3 — hybrid focus indicator

- The slot div in `TerminalPanel` carries `data-focus="typing" | "active" | "none"`:
  - `typing` — DOM focus is inside the **TerminalPane section** (`.shell-terminal-pane`),
    NOT the whole slot div. The pane section contains exactly the surfaces whose keystrokes
    stay local to the pty: xterm's focus sink, the hidden
    `<textarea class="xterm-helper-textarea">` (mem-2026-06-15-xterm-s-focus-sink), and the
    find bar. The slot header (Promote / Refit / Restart / Close buttons) is a **sibling**
    of the pane section — a focused header button must NOT read as typing, since the pty
    cannot receive keystrokes then. Contract: `TerminalPane` gains an
    `onTypingFocusChange(hasFocus: boolean)` prop, driven by React `onFocus`/`onBlur` on its
    root section with a `currentTarget.contains(relatedTarget)` check to ignore intra-pane
    moves; `TerminalPanel` combines that with active-pane state to stamp `data-focus`. No
    shortcut-gating change: `targetOwnsTyping` is untouched.
  - `active` — `process.id === activeSession.activeProcessSessionId` and not `typing`.
  - `none` — otherwise.
- CSS (`shell.css`, all themes):

  ```css
  .shell-terminal-slot[data-focus="typing"] { border-color: var(--primary); }
  .shell-terminal-slot[data-focus="active"] {
    border-color: color-mix(in srgb, var(--primary) 45%, var(--panel-border));
  }
  ```

  Border **color** only — width stays the theme's slot width (1px after D4), so no layout
  shift. TUI inherits; its `--primary` teal matches the theme's selection language.
- The floating shell gets no indicator (overlay focus is self-evident) — out of scope (§9).

## 7. D4 — TUI slot border exemption

`src/styles/tui.css` (the TUI-scoped block):

```css
[data-theme="tui"] .shell-terminal-slot { border-width: 1px; }
[data-theme="tui"] .shell-terminal-slot__header { border-bottom-width: 1px; }
```

Everything else keeps `--shell-border-width: 2px`. This is a **scoped amendment to
`docs/tui-css-spec.md` D3**: box-drawing weight remains the theme's identity; terminal slots are
the one exemption because the pane grid multiplies every border by adjacent panes and the weight
compounds. The all-theme `border-top: 2px` stacked separator already has parity and is untouched.

## 8. Testing

Placement follows AGENTS.md §Test File Layout: new tests live under `tests/unit/<domain>/`
mirroring their source names; `tests/unit/components/` is a legacy catch-all and receives
**no new files**.

- **`tests/unit/terminals/`**: `agent-launch.test.ts` — `collabGlyphState` (bound pair /
  single bound / daemon dead / `pending_attach` / non-mount command / hand-typed mount);
  `TerminalPanel.test.tsx` —
  - provider glyph per provider; for null/`"other"` a **structural guard**, not mere glyph
    absence: the header's child-node sequence is identical to today's (no wrapper node, no
    extra gap element) — assert via a header-children snapshot for both null and `"other"`;
  - collab glyph condition + it renders through `Icon name="link"` (registry entry from
    D1b-ii);
  - confirm gate matrix: restart click on `status === "running"` opens the dialog; confirm
    invokes `onRestartSlot`, cancel does not; **`Escape` cancels; scrim click cancels; the
    confirm button holds initial focus**; `status === "exited"`, `"error"`, and
    `"restarting"` all bypass the dialog; don't-ask-again writes the patch and the next
    click is silent; **a second Restart/Close click while the dialog is open retargets the
    single dialog** (title/action swap, no stacking);
  - `data-focus` transitions, **including the negative case: a focused header button
    (Restart/Close) yields `active`/`none`, never `typing`**;
  `ProviderLogo.test.tsx` — glyph set renders per id; `TerminalPane.test.tsx` (extends
  existing coverage location if already drained, else new domain file) —
  `onTypingFocusChange` fires on pane focus/blur only.
- **`tests/unit/app/`**: `use-floating-shell-actions.test.ts` — the gated
  `handleCloseFloatingShell`: live + ask → pending-close parked (dialog state), confirm
  closes, cancel does not; pref silent → immediate close; exited → immediate close. Both
  entry surfaces (popover Kill, pill Kill) call the same handler, so this covers both;
  `use-settings.test.tsx` (extend) — **optimistic update: a rejected `settings.write` keeps
  the patched value in context (silent), and a consumer reading the context after the
  rejection still sees the suppression** (cross-surface sharing = same provider context);
  echo received mid-flight does not rewind the optimistic value.
- **`tests/unit/settings/`**: `persisted-settings.test.ts` — schema defaults + bare-patch
  behavior; `settings-service.test.ts` — **sequential partial writes preserve siblings:
  write `{ terminalConfirm: { close: false } }`, then `{ terminalConfirm: { restart:
  false } }` → both remain `false`**; `SettingsDialog.test.tsx` — the two confirm toggles
  render and write.
- **Focus-test pitfall** (mem-2026-06-15): simulate terminal focus with a real
  `<textarea class="xterm-helper-textarea">` inside the pane as the focus target — a plain
  `<div>` stand-in has previously produced false-passing focus tests in this repo.
- **E2E** (AGENTS.md §Verification: new user-visible behavior is not done until the e2e
  suite covers it; extend, never replace): new `tests/e2e/terminal-slot-chrome.spec.ts` —
  (a) agent pane header shows the provider glyph, plain shell does not; (b) **Close** on a
  live shell opens the confirm dialog; cancel keeps the pty alive; confirm removes the
  process from the panel (slot empties); (c) **Restart** on a live shell opens the dialog;
  confirm **replaces the terminal session** — the pane's `data-terminal-session-id`
  changes, the slot remains populated, and the new shell is running (restart must never be
  satisfiable by a close); (d) don't-ask-again → subsequent click is silent, and the
  Settings toggle re-arms the warning; (e) `data-focus` flips to `typing` when the pane is
  clicked and away when an overlay input takes focus; (f) TUI theme, three computed values:
  slot `border-width` is `1px`, slot-header `border-bottom-width` is `1px`, and a
  **non-top-row** slot header's `border-top-width` stays `2px` (stacked separator
  preserved) — while a sidebar panel keeps `2px` chrome. Existing suites' `data-testid` /
  `data-attention` contracts are unchanged.
- TDD throughout (project workflow).

## 9. Out of scope

- Migrating the five existing `window.confirm` call sites to ConfirmDialog.
- Focus indicator on the floating throwaway shell.
- A restart affordance for floating shells (none exists today; D2 gates the existing Kill
  button only).
- Provider logos on other surfaces (sidebar process rows, chrome bar).
- Collab glyph for hand-typed `whisper collab mount` in a pre-existing shell.
- Any change to attention states, blink animations, or the stacked-pane separator.

## 10. Edge cases

- `provider: "other"` / null → no glyph; header identical to today.
- Two panes with the same provider, one collab-mounted → the `process.command` check
  distinguishes them.
- Binding `pending_attach` → no glyph until `bound`.
- Restarting an exited pane is a respawn, not destructive → no dialog.
- Settings write failure → warning suppressed for the session only; toggle in Settings remains
  the recovery path.
- No new animation introduced; `prefers-reduced-motion` posture unchanged.

## 11. File map (plan slices per item; each slice ≤3 files)

Each slice touches at most three source files; its tests live in the mirrored domain per §8
and accompany the slice.

| Slice | Files (≤3 each) |
| --- | --- |
| D1 (glyph) | `ProviderLogo.tsx` (new), `TerminalPanel.tsx`, `shell.css` |
| D1b-i (helper) | `agent-launch.ts` |
| D1b-ii (wiring) | `TerminalPanel.tsx`, `App.tsx`, `icon.tsx` (link registry entry) |
| D2a (persistence) | `persisted-settings.ts`, `services/settings/settings-service.ts`, `use-settings.tsx` (optimistic update) |
| D2b (dialog) | `confirm-dialog.tsx` (new), `shell.css` |
| D2c (slot wiring) | `TerminalPanel.tsx`, `SettingsDialog.tsx` |
| D2d (floating close) | `use-floating-shell-actions.ts` (gate at shared handler), `App.tsx` (dialog render) — popover/pills click sites unchanged |
| D3 (focus) | `TerminalPane.tsx`, `TerminalPanel.tsx`, `shell.css` |
| D4 + D1b tint (TUI) | `tui.css` (slot 1px exemption + collab glyph `--primary` re-point) |
| E2E | `tests/e2e/terminal-slot-chrome.spec.ts` (new) |
