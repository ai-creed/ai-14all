# Throwaway Shell — Design

- **Date:** 2026-06-25
- **Branch:** `throwaway-shell`
- **Status:** Approved design, pending implementation plan
- **Author:** Vu Phan (with Claude)

## 1. Motivation & Problem

The app's terminals live in a grid of layout **slots** (1–6 slots; layouts like
`2-v`, `4-grid`, `6-hm`). Spawning any shell today places it into a slot, and the
`terminal-layout-planner` promotes/demotes the layout as shells come and go. That
is correct for the working set of terminals a session cares about, but it is the
wrong behavior for a **one-off command**: launching VS Code (`code .`), running a
quick `npm install`, or poking at `git fetch` reshuffles the carefully arranged
grid just to run something you will discard seconds later.

We want a way to spawn a real interactive shell for transient work **without
disturbing the slot layout** — and, when a transient shell turns out to be worth
keeping, a one-click way to promote it into the grid.

## 2. Goals / Non-goals

### Goals
- Spawn a real interactive login shell in the **current session's cwd** (same
  backend path as the `+ Shell` button) that does **not** occupy a grid slot.
- Present it as a floating, minimizable window — Facebook-Messenger "chatbox"
  feel — anchored to the terminal header.
- Allow **pinning** a floating shell into the layout, where it becomes a normal
  slotted pane (reusing its existing PTY — no respawn).
- Scope floating shells **per worktree-session**: hide on leave, restore on
  return, with scrollback intact.

### Non-goals (v1)
- A general command palette (deferred to its own feature; see §8).
- Unpinning (moving a slotted pane back out to floating).
- Free dragging / arbitrary resizing of the popover.
- Persisting floating shells across app restart.
- Swapping a slot out to make room when pinning into a full grid.

## 3. User Experience

### 3.1 Placement
Floating shells surface as **pills** in `TerminalChromeHeader`'s right-hand
action group (`TerminalActions`), positioned **just left of the `+ Shell`
button**. Clicking a pill expands its shell as a **popover that drops down from
the header, overlaying the grid** (not splitting it). Exactly **one popover is
expanded at a time**; the others remain as pills.

```
┌ Terminal controls ───────────────────────────────────────────────┐
│ ▷ Claude  ▷ Codex            [● zsh ✕] [● build ✓ ✕] │ ＋Shell  ▦Layout  ⚙Presets ▾ │
└───────────────────────────────────────────────────┬──────────────┘
                                                     ▼ (popover drops down over grid)
                                          ┌──────────────────────────┐
                                          │ ● zsh — ~/repo   📌 — ✕   │
                                          │ $ code .                  │
                                          │ $ ▍                       │
                                          └──────────────────────────┘
```

### 3.2 Pill states
- **Running:** green status dot, label (default: shell basename, e.g. `zsh`).
- **Exited:** amber dot + an "exited" affordance (shows the shell ended; the user
  dismisses it manually — see §3.4).
- Each pill has a small **✕** (kill that shell + remove the pill).
- Clicking the pill **body** expands its popover (and collapses whichever was
  previously expanded).

### 3.3 Popover header controls
Three controls, left to right after the title:
- **📌 Pin** — promote this shell into the layout as a slot (§5.6). Disabled (greyed +
  tooltip) when the grid is full (§4) or after the shell has exited.
- **— Minimize** — collapse the popover back to its pill; the **PTY keeps
  running**.
- **✕ Kill** — terminate the PTY and remove the shell (same effect as the pill's ✕).

### 3.4 Lifecycle display
While running, the popover shows the live shell. When the shell process exits on
its own (`exit`, or a one-off command that ends the shell), the popover
**lingers**: it keeps showing the final scrollback and the exit code, and the
pill gains the amber "exited" badge. Nothing is auto-removed — the user closes it
with **✕** when done reading.

## 4. Behavior summary

| Aspect | Behavior |
|---|---|
| **Launch** | `⌘⇧T` (mac) / `Ctrl+Shift+T` (other). Spawns a new floating shell, expanded and focused. No toolbar button. |
| **Discovery** | Auto-listed in the `⌘⇧P` "Show shortcuts" overlay (registry-driven). |
| **Multiplicity** | Many per worktree; one expanded popover at a time; the rest are pills. |
| **Cap** | Maximum **6** floating shells per worktree-session. At the cap, `⌘⇧T` no-ops with a brief hint. |
| **Nav scope** | Per worktree-session. Leaving the worktree hides pills + popover (PTY stays alive); returning restores them with scrollback. |
| **Natural exit** | Popover lingers with final output + exit code; pill shows "exited"; user dismisses. |
| **Kill** | Pill ✕ or popover ✕ terminates the PTY and removes the shell. |

## 5. Architecture

The feature is **renderer-only**. No backend protocol or `TerminalService`
changes are required.

### 5.1 Backend (unchanged)
`TerminalService.create(workspaceId, worktreeId, cwd)`
(`services/terminals/terminal-service.ts`) already spawns a generic login shell
in an arbitrary cwd and is agnostic to how the renderer arranges sessions.
Floating shells call the same path with the worktree's cwd. "Floating" vs
"slotted" is purely a renderer/`workspace-state` concept; the backend never
distinguishes them.

### 5.2 Renderer data model (`workspace-state`)
A floating shell's `ProcessSession` lives in `processSessionsById` exactly as a
slotted one does, but its id is **not** in `slotProcessIds`. Add per
worktree-session state:

- `floatingShellIds: string[]` — ids of floating shells for this worktree, in
  pill order. Never overlaps `slotProcessIds`.
- `expandedFloatingShellId: string | null` — which pill is currently expanded
  (enforces "one at a time").
- Minimized state is implied: a floating id that is not `expandedFloatingShellId`
  is a pill.

These are **not** added to the persisted snapshot schema
(`shared/models/persisted-workspace-state.ts`) — floating shells do not survive
app restart (§8).

> **Naming caution:** `ProcessSession.pinned` /
> `session/toggleProcessPinned` already exist and mean something different (a
> per-process flag). The layout-pin action below must use distinct naming to
> avoid confusion.

### 5.3 New reducer actions
- `session/registerFloatingShell` — register the `ProcessSession` in
  `processSessionsById` and append its id to `floatingShellIds`; set
  `expandedFloatingShellId` to it. Includes a **defensive** cap-6 guard (no-op at
  cap), but this is a backstop only — the cap is enforced **before spawning** in
  the launch flow (§5.7) so no backend PTY is ever created at the cap.
- `session/expandFloatingShell` — set `expandedFloatingShellId` (collapse others).
- `session/minimizeFloatingShell` — clear `expandedFloatingShellId` if it matches.
- `session/closeFloatingShell` — remove the id from `floatingShellIds` and
  `processSessionsById` (the actual PTY kill is dispatched via the existing
  terminal client, mirroring `session/closeProcess`). The dismissal path must
  **also call `clearReplayOutput(terminalSessionId)`** — because a floating
  shell's replay buffer is now retained past exit (§5.4), dismissal is the point
  where it is freed.
- `session/pinFloatingShellToSlot` — see §5.6.

### 5.4 Replay buffer reuse (avoids the blanking bug)
`use-terminal-runtime` (`src/app/hooks/use-terminal-runtime.ts`) feeds **every**
session's raw PTY output into the renderer-side ring buffer
(`recordReplayOutput`, `src/features/terminals/logic/replay-buffer.ts`)
**regardless of whether any pane is mounted**. `TerminalPane` replays
`getReplayOutput(id)` synchronously on mount before wiring its live subscription.

This means the popover can freely **unmount its xterm on minimize** and on
worktree switch, and **re-mount with full scrollback** on expand/restore while
the shell is still running — no special handling needed. This directly avoids the
known failure mode where an unmount/remount drops xterm scrollback and renders
the terminal blank (gotcha `mem-2026-06-18-terminal-blanks-on-in-workspace-session`).

**Exit-time lifecycle change (required for "exited-and-lingering").** Today
`use-terminal-runtime`'s `onExit` handler clears the replay buffer the instant a
PTY exits (`clearReplayOutput(event.sessionId)`,
`src/app/hooks/use-terminal-runtime.ts:191-195`; deletion in
`replay-buffer.ts:62-64`). Under that behavior a floating popover that is
minimized — or whose worktree was switched away — and then remounted **after** the
shell exited would replay nothing and render blank, violating §3.4 and the
"shell exits while minimized" edge case (§7). So replay reuse alone is **not**
sufficient; an explicit lifecycle change is required:

- Make the exit clear **floating-aware.** When the exiting session belongs to a
  floating shell (its `ProcessSession.id` is in that worktree-session's
  `floatingShellIds`), `onExit` **skips** `clearReplayOutput` and retains the
  buffer. `onExit` already resolves the owning process via
  `findProcessByTerminalSessionId`, so the floating check is a cheap membership
  test on the resolved worktree-session.
- The retained buffer is freed only when the user dismisses the shell
  (`session/closeFloatingShell`, §5.3).
- Slotted shells — including a shell that was **pinned** and is therefore no
  longer floating — keep the existing clear-on-exit behavior unchanged.

Retained scrollback is bounded by `REPLAY_LIMIT` (256 KiB, `replay-buffer.ts:27`),
sufficient for a one-off command's final output. (Rejected alternative:
snapshotting a separate frozen copy of the final output at exit time — it
duplicates state and adds a second render path; deferring the existing buffer's
clear is the smaller change.)

### 5.5 Components
- **`FloatingShellPills`** — renders the pills inside `TerminalActions`'
  group, left of `+ Shell`. Reads `floatingShellIds` + statuses; handles click
  (expand), ✕ (kill).
- **`FloatingShellPopover`** — the drop-down window. Header controls
  (pin/minimize/kill) + body. The body **reuses `TerminalPane`** so it inherits
  replay-on-mount and the existing xterm key handling.

### 5.6 Pin mechanism
Pinning reuses the existing add-ad-hoc placement path so a pinned shell is
indistinguishable from a normally-spawned slotted shell:

1. Compute the promoted layout + target slot exactly as the `+ Shell` flow does
   (`resolvePromotedLayout` / `compactIntoLayout` in
   `src/features/terminals/logic/terminal-layout-planner.ts`).
2. Dispatch `session/placeProcessInNewSlot` with the **existing** floating
   `ProcessSession` (same PTY id — no respawn). This writes it into the slot,
   promotes `terminalLayoutId`, and sets it active.
3. Dispatch `session/pinFloatingShellToSlot` (or fold into the above) to remove
   the id from `floatingShellIds` and clear `expandedFloatingShellId`.

**Disabled when full:** the grid maxes at 6 slots. The existing `addDisabled`
signal is `runningShells >= 6` where `runningShells` counts only **slotted**
shells (`activeSession.slotProcessIds` non-null entries — see `App.tsx:485-490`).
Reuse it to grey out 📌 with a "Layout full — free a slot first" tooltip when
there is no room to promote (equivalently, `resolvePromotedLayout` returns
`{ kind: "full" }`). Because `runningShells` excludes floating shells, adding
floating shells never disables `+ Shell` or pinning — the floating cap (6) is a
**separate** count over `floatingShellIds`.

### 5.7 Launch flow & cap enforcement (no orphan PTYs)
Floating launch mirrors the ad-hoc spawn helper (`spawnAdHocProcess` /
`handleAddAdHoc` in `src/app/hooks/use-process-actions.ts`), which creates the
**backend** terminal first
(`createSession(workspaceId, worktree.id, worktree.path)`, `:75-79`) and only then
dispatches the reducer registration (`:115-125`). Because the PTY exists before
registration, a reducer-only cap check would **leak an orphaned PTY** — created in
the backend but absent from `processSessionsById` and the UI, never killed.

Therefore the cap is enforced **pre-spawn**:

1. The `⌘⇧T` handler reads the active worktree-session's
   `floatingShellIds.length`. If it is already `6`, it returns early with a
   transient hint and **does not call `createSession`** — no backend PTY is
   created. (Mirrors how the `⌘T` slotted handler returns early on `addDisabled`,
   `App.tsx:1405`.)
2. Otherwise it spawns (reusing `spawnAdHocProcess`'s `try/catch`, which already
   returns `null` and toasts on failure so the caller dispatches nothing — no
   orphan slot), then dispatches `session/registerFloatingShell`.
3. **Defensive backstop:** if `registerFloatingShell`'s guard ever rejects (a race
   where two launches pass the pre-check concurrently), the handler must kill the
   just-created terminal (`stopSession` + `removeSession`) so no PTY is orphaned.

Net invariant: **at the cap, no backend or runtime terminal session is ever
created**, and any session that *is* created is always either registered or torn
down.

## 6. Launch & shortcuts
Add one entry to `SHORTCUT_REGISTRY` (`src/app/shortcut-registry.ts`):

- `id: "terminal.newFloating"`, `label: "New throwaway shell"`,
  `mac: "⌘⇧T"`, `other: "Ctrl+Shift+T"`.
- Predicate mirrors `isTerminalLayoutShortcut`: key `t`/`T`, `shiftKey` required,
  `metaKey` (mac) / `ctrlKey` (other), not `altKey`.
- **Gate with `targetOwnsTyping(target, { allowXterm: true })`**
  (`src/app/target-owns-typing.ts`) so the shortcut fires even when a terminal is
  focused — xterm parks focus in a hidden `<textarea>`, and the default gate
  would otherwise swallow it (gotcha
  `mem-2026-06-15-xterm-s-focus-sink-is-a-hidden-textarea`).
- The handler enforces the floating cap **before** spawning (§5.7), so a no-op at
  the cap never creates a backend PTY.

`⌘T` (`terminal.new`) is the existing slotted-shell shortcut and explicitly
excludes Shift, so `⌘⇧T` does not collide. The binding fits the existing
`⌘⇧`-letter terminal-management family (`⌘⇧X` close, `⌘⇧D/A` cycle, `⌘⇧L`
layout). Being in the registry, it auto-appears in the `⌘⇧P` shortcuts overlay.

## 7. Edge cases
- **Spawn at cap (6 floating):** `⌘⇧T` no-ops with a transient hint; the cap is
  checked **before** spawning, so no backend PTY is created (§5.7) — no orphan.
- **Pin into a full grid (6 slots):** 📌 disabled with tooltip; shell stays
  floating.
- **Pin after exit:** 📌 disabled (nothing useful to promote).
- **Minimize the expanded popover:** PTY stays alive; xterm unmounts; re-expand
  replays scrollback.
- **Worktree switch with a popover open:** pills + popover hide; PTYs alive; the
  previously-expanded one re-expands on return.
- **Shell exits while minimized (or after a worktree switch):** the retained
  replay buffer (§5.4) is **not** cleared on exit, so expanding/returning to the
  pill replays the final scrollback; the pill shows the "exited" badge.
- **Kill the expanded popover:** removes it; no popover is expanded afterward.
- **Pin promotes layout for a returning worktree:** standard planner behavior; no
  special case.

## 8. Out of scope / YAGNI (v1)
- **Command palette** — there is no general command palette in the app today
  (`⌘P` is a file finder, `⌘⇧P` is the shortcuts overlay). A real palette is a
  separate future feature; the throwaway shell will register as one command then.
- Unpin (slot → float), drag/free-resize of the popover, restart persistence,
  and swap-on-full pinning.

## 9. Testing plan
**Unit (`workspace-state` reducer + planner):**
- `registerFloatingShell` adds to `floatingShellIds`, not `slotProcessIds`; sets
  expanded; the defensive cap-6 backstop no-ops at cap (primary enforcement is
  pre-spawn, §5.7).
- `expand`/`minimize` enforce single-expanded invariant.
- `closeFloatingShell` removes from both `floatingShellIds` and
  `processSessionsById`; the dismissal handler frees the retained replay buffer
  (`clearReplayOutput` called for the shell's `terminalSessionId`).
- `pinFloatingShellToSlot` moves the id out of `floatingShellIds` and into a slot,
  promotes the layout, reuses the same `ProcessSession` id, sets it active.
- Pin disabled selector returns true at 6 slots.

**Component:** `FloatingShellPills` / `FloatingShellPopover` render states
(running/exited, expanded/minimized), controls dispatch the right actions, pin
disabled rendering.

**e2e (`tests/e2e`):**
- `⌘⇧T` spawns a floating shell (expanded, focused); not in the grid; layout
  unchanged.
- Minimize ↔ re-expand preserves scrollback.
- Worktree switch hides then restores the floating shell with scrollback.
- Natural exit lingers with final output + exit indicator until dismissed.
- **Exit while minimized**, then re-expand → final scrollback still shown (replay
  retained past exit, §5.4).
- **Exit, switch worktree away and back**, then expand → final scrollback still
  shown; after dismissal the buffer is freed.
- Pin moves the shell into the grid (layout grows) reusing the PTY.
- Pin disabled at 6 slots.
- **Spawn at the 6-floating cap is a no-op AND creates no backend terminal
  session** — assert the backend/runtime session count is unchanged (guards
  against orphan PTYs, §5.7).
- `⌘⇧T` fires while a terminal pane is focused (xterm-focus gate).

## 10. Key files & references
- `services/terminals/terminal-service.ts` — backend shell spawn (unchanged).
- `shared/models/terminal-session.ts`, `shared/models/process-session.ts`.
- `src/features/terminals/components/TerminalChromeHeader.tsx`,
  `TerminalActions.tsx` — header + action group (`addDisabled`).
- `src/features/terminals/components/TerminalPane.tsx` — reused popover body.
- `src/features/terminals/logic/replay-buffer.ts`,
  `src/app/hooks/use-terminal-runtime.ts` — replay feed; `onExit` clear
  (`:191-195`) must become floating-aware (§5.4).
- `src/app/hooks/use-process-actions.ts` — `spawnAdHocProcess` / `handleAddAdHoc`;
  the spawn-before-register order that mandates pre-spawn cap gating (§5.7).
- `src/features/workspace/logic/workspace-state.ts` — reducer, slot model,
  `placeProcessInNewSlot`.
- `src/features/terminals/logic/terminal-layout-planner.ts` —
  `resolvePromotedLayout`, `compactIntoLayout`.
- `src/app/shortcut-registry.ts`, `src/app/target-owns-typing.ts` — shortcuts.
- Gotchas: `mem-2026-06-18-terminal-blanks-on-in-workspace-session`,
  `mem-2026-06-15-xterm-s-focus-sink-is-a-hidden-textarea`.

## 11. Decisions log
- Model: floating, minimizable scratch terminal anchored to the terminal header.
- Nav scope: per worktree-session (hide & restore; PTY persists).
- Multiplicity: multiple per worktree, one expanded at a time; cap 6.
- Pin when full: disable with hint (no swap, one-way float → slot).
- Launch: `⌘⇧T` + auto-listing in shortcuts overlay; no toolbar button; command
  palette deferred.
- On natural exit: linger with final output + exit code. **Requires** deferring
  the replay-buffer clear for floating shells from exit-time to dismissal-time
  (§5.4) — replay reuse alone is insufficient (reviewer finding).
- Cap enforcement is **pre-spawn**, not reducer-only, so a no-op at the cap never
  creates an orphan backend PTY (§5.7) (reviewer finding).
- Placement: header pills left of `+ Shell`; expanded = drop-down popover.
- Window controls: minimize + pin + kill.
