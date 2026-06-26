# Command Palette — v1 Design

**Project:** ai-14all
**Date:** 2026-06-26
**Status:** Approved (brainstorm) — ready for implementation planning
**Branch:** command-pallete

## 1. Summary

Add a first-version in-app **command palette**: a searchable overlay, opened with
**⌘⇧K / Ctrl+Shift+K**, that lists the application's commands, fuzzy-matches them
as the user types, and runs the selected command on **Enter**.

The palette is an *actionable launcher*. It turns the app's existing keyboard
commands — and a few actions that have no keybinding today — into a single
discoverable, runnable surface. It does **not** replace the existing read-only
`ShortcutsHelp` cheat sheet (⌘⇧P / ⌘/), which stays as-is.

## 2. Background

The codebase already has most of the supporting pieces:

- `src/app/shortcut-registry.ts` — `SHORTCUT_REGISTRY`, a list of ~25 entries
  shaped `{ id, label, mac, other, predicate }`. Predicates match keyboard events;
  **the registry holds no action handlers.**
- `src/app/hooks/use-keyboard-shortcut.ts` — `useKeyboardShortcut(id, platform,
  handler, deps)`. Subscribes a handler to a registered shortcut via a
  capture-phase `keydown` listener.
- Handler wiring is **distributed**: ~18 commands are wired in `src/app/App.tsx`;
  4 review-navigation commands are wired in `src/app/components/ReviewArea.tsx`,
  where they close over review-internal scroll/selection state.
- `src/features/shortcuts/ShortcutsHelp.tsx` — a read-only, grouped cheat-sheet
  Dialog bound to ⌘⇧P / ⌘/.
- `src/features/files/FilesOverlay.tsx` — a fuzzy file finder on ⌘P. Its
  open-state pattern (a `useState` boolean in `App.tsx`, flipped by a shortcut,
  passed to the overlay component) is the template the palette mirrors.
- UI primitives present: `@radix-ui/react-dialog`, `Input`, `scroll-area`,
  `Button`, `lucide-react` icons. **No `cmdk` or fuzzy-scoring library is
  installed.**

The gap the palette fills: commands are not addressable as *runnable data* that a
UI can enumerate, filter, and execute — handlers are bound imperatively and
scattered.

## 3. Locked decisions

| Decision | Choice |
| --- | --- |
| Core purpose | Actionable command launcher (not a file finder or omni-finder) |
| Trigger | ⌘⇧K / Ctrl+Shift+K (⌘K is taken by terminal-clear). `ShortcutsHelp` stays on ⌘⇧P, unchanged |
| Command set | Superset of `SHORTCUT_REGISTRY` (all ~25) **plus** a few palette-only actions |
| Availability | Context-filtered: unavailable commands are **hidden** in v1 |
| Architecture | Registration-based command registry (React context + registration hook) |
| UI | Hand-rolled on existing Radix primitives; **no new dependency** |

## 4. Out of scope (v1)

Deliberately excluded to keep v1 focused:

- Recents / MRU ranking of commands.
- Command arguments, parameters, or nested sub-palettes.
- Fusing file search (⌘P) into the palette.
- A fuzzy-scoring dependency (`cmdk`, `fuse.js`, `fuzzysort`, …).
- User-customizable commands or keybindings.
- Greyed-out "unavailable" rows (hidden instead — see §6).

## 5. Architecture

### 5.1 Command data model

A new feature directory `src/features/command-palette/` owns the palette. Because
the feature has more than one role, it is organized into role folders per
`AGENTS.md` §"Frontend Structure And Naming" — `components/` for React components
(`PascalCase.tsx`), `hooks/` for React hooks (`kebab-case.ts`), and `logic/` for
non-component modules incl. types and pure logic (`kebab-case.ts`) — mirroring the
existing `src/features/review/` layout. No files are placed flat once a second
role exists.

```ts
// src/features/command-palette/logic/command.ts
export interface Command {
  /** Stable, unique id, e.g. "terminal.new". Last registration for an id wins. */
  id: string;
  /** Display label in the palette, e.g. "New terminal". */
  title: string;
  /** Section header for grouping, e.g. "Terminal". */
  group: string;
  /** Extra search aliases beyond the title. */
  keywords?: string[];
  /**
   * Links to a SHORTCUT_REGISTRY entry so the palette can render the key hint.
   * Omit for palette-only commands (no keybinding).
   */
  keybindingId?: string;
  /** Executes the command. */
  run: () => void;
  /** Defaults to always-available. When it returns false, the command is hidden. */
  isAvailable?: () => boolean;
}
```

Keys are **single-sourced** in `SHORTCUT_REGISTRY`. The palette renders a row's
key hint by looking up `keybindingId` and using the existing platform-aware
`mac` / `other` strings (and `shortcutHint`/`detectPlatform` helpers). Key
strings are never duplicated into command definitions.

### 5.2 Registry: provider + hooks

The registry is split across role folders (component vs hooks vs non-component
plumbing):

```
src/features/command-palette/logic/command-registry-context.ts   // createContext + context-value type (no JSX → .ts)
src/features/command-palette/components/CommandRegistryProvider.tsx // the provider component
src/features/command-palette/hooks/use-command-registry.ts         // useRegisterCommands + useCommands
```

The context object lives in `logic/` so both the provider component and the hooks
import it without a component↔hook dependency cycle (components and hooks both
depend on `logic/`, never the reverse).

- `CommandRegistryProvider` wraps the application subtree. It holds a
  `Map<id, Command>` and notifies consumers when the map changes.
- `useRegisterCommands(commands: Command[], deps: ReadonlyArray<unknown>): void`
  — mirrors `useKeyboardShortcut`'s deps discipline exactly. Inside a
  `useEffect` gated by `deps`, it registers (replaces by id) each command and
  returns a cleanup that unregisters them. Because callers pass the same `deps`
  they already pass to the matching `useKeyboardShortcut`, the captured
  `run` / `isAvailable` closures stay in sync with current state — identical
  mental model to the existing shortcut wiring.
- `useCommands(): Command[]` — returns the aggregated list: dedup by id
  (last-wins, dev-warn on collision), sorted by group then title.

### 5.3 Where commands are registered

Registration happens *beside* the existing shortcut wiring, honoring the current
distributed ownership — no handler is lifted or moved:

- **`App.tsx`** registers its ~18 commands. Each command's `run` is the **same
  handler function** the corresponding `useKeyboardShortcut` already invokes — no
  duplicated command logic, just an additional registration referencing it.
- **`ReviewArea.tsx`** registers its 4 review-navigation commands
  (`review.fileNext`, `review.filePrev`, `review.diffNext`, `review.diffPrev`),
  with `isAvailable` reflecting review-open state and `run` = its existing
  handlers.
- **Palette-only commands** (e.g. "Show shortcuts", "Open plugins") register with
  no `keybindingId`. The exact initial palette-only set is finalized during
  implementation; candidates: open the shortcuts help, open the plugins panel,
  refresh changes.

### 5.4 Trigger wiring

- Add a `command-palette` entry to `SHORTCUT_REGISTRY` (`⌘⇧K` / `Ctrl+Shift+K`)
  with a predicate `isCommandPaletteShortcut`. **⌘K / Ctrl+K is deliberately
  avoided**: `TerminalPane`'s `attachCustomKeyEventHandler`
  (`src/features/terminals/components/TerminalPane.tsx`) binds ⌘K / Ctrl+K
  (matched with `!shiftKey`) to *clear the terminal* (`term.clear()`). ⌘⇧K
  carries a Shift, so it never matches that handler and never clears the
  terminal. The binding also follows the app's existing ⌘⇧-<letter> convention
  for terminal-management shortcuts (⌘⇧T, ⌘⇧X, ⌘⇧D, ⌘⇧A, ⌘⇧L); ⌘⇧K is currently
  unused.
- The predicate uses `allowXterm` so the palette opens even when a terminal pane
  is focused (consistent with the rule that global navigation shortcuts must work
  from the terminal). Because `useKeyboardShortcut` listens in the capture phase
  and the handler calls `preventDefault`, the keystroke is consumed before xterm
  treats it as input.
- `App.tsx` holds `const [commandPaletteOpen, setCommandPaletteOpen] =
  useState(false)`, flips it from the shortcut handler, and renders
  `<CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />`
  (mirroring the `filesOverlayOpen` pattern).

## 6. Availability

In v1, commands whose `isAvailable()` returns false are **hidden** from the list
(no dead rows, no extra rendering). Greyed-out "unavailable, here's why" rows are
a deliberate fast-follow, not part of v1.

## 7. UI / UX

The palette component:

```
src/features/command-palette/components/CommandPalette.tsx
```

- Built on `@radix-ui/react-dialog` + `Input` + `scroll-area` + `lucide-react`,
  mirroring `FilesOverlay`. **No new dependency.**
- Reads `useCommands()`, filters by `isAvailable()`, then filters by the query.
- **Matcher** lives in a pure, unit-testable module
  `src/features/command-palette/logic/command-match.ts`: case-insensitive
  subsequence/substring match over `title` + `keywords`. No fuzzy-scoring
  library.
- Results are grouped by `group` with section headers.
- Keyboard: **↑/↓** move the selection, **Enter** runs the selected command then
  closes the palette, **Esc** / backdrop click closes it (Dialog handles).
- Each row shows the command `title` and, right-aligned, its keybinding hint
  resolved from `keybindingId` (omitted cleanly for palette-only commands).
- Empty query shows all available commands. No matches shows a "No matching
  commands" empty state.

*Alternative considered and rejected for v1:* adding the `cmdk` library. The
codebase hand-rolls Radix primitives and already ships its own overlay filtering
(`FilesOverlay`); a new dependency is not warranted yet.

## 8. File plan & phasing

Roughly 9 files are touched, which exceeds the "≤3 files per task" guideline, so
the work is pre-decomposed into three sequenced phases. Each phase is a natural
review checkpoint; the implementation plan will break these into concrete tasks.
New files follow the `AGENTS.md` role-folder contract (`components/`, `hooks/`,
`logic/`).

**New files**

1. `src/features/command-palette/logic/command.ts` — `Command` type.
2. `src/features/command-palette/logic/command-match.ts` — pure matcher.
3. `src/features/command-palette/logic/command-registry-context.ts` — `createContext`
   + context-value type (non-component plumbing).
4. `src/features/command-palette/components/CommandRegistryProvider.tsx` — provider
   component.
5. `src/features/command-palette/hooks/use-command-registry.ts` —
   `useRegisterCommands` + `useCommands`.
6. `src/features/command-palette/components/CommandPalette.tsx` — palette UI.

**Edited files**

7. `src/app/shortcut-registry.ts` — add `command-palette` (⌘⇧K) predicate + entry.
8. `src/app/App.tsx` — open-state, shortcut wiring, mount provider, register
   global commands, render palette.
9. `src/app/components/ReviewArea.tsx` — register its 4 review-nav commands.

**Phases**

- **Phase 1 — Registry core:** files 1–5 (`logic/` modules + provider + hooks) +
  unit tests. Self-contained, no palette UI.
- **Phase 2 — Palette UI:** file 6 + unit tests, driven by a mock registry.
- **Phase 3 — Wiring:** files 7–9 + e2e test.

## 9. Testing strategy

Test-driven, per project workflow. Test files use the source filename + `.test`
and live in a folder mirroring the source domain (per `AGENTS.md`) — e.g.
`command-match.test.ts` and `use-command-registry.test.tsx` alongside or mirroring
their `logic/` and `hooks/` sources.

**Unit**

- `command-match`: subsequence ordering, case-insensitivity, no-match, keyword
  hits, empty query returns all.
- Registry: aggregation, dedup by id (last-wins), group/title sort,
  `isAvailable` filtering, register/unregister lifecycle, re-register on deps
  change.
- `CommandPalette`: query filters rows; ↑/↓ change selection; Enter calls the
  selected command's `run` and closes; Esc closes; palette-only rows render with
  no key hint.

**e2e**

- ⌘⇧K opens the palette.
- Typing "term" surfaces "New terminal"; Enter runs it and a terminal appears.
- ⌘⇧K opens the palette even when a terminal pane is focused (not swallowed by
  xterm), and the terminal is not cleared.

## 10. Edge cases

- Empty query → show all available commands.
- No matches → empty state.
- Rapid open/close/re-open.
- A command whose `isAvailable()` flips while the palette is open.
- Duplicate command ids → last registration wins, dev-time warning.
- Platform-specific key hints (mac vs other) render correctly.
- Palette-only commands (no `keybindingId`) render with no key hint.
- ⌘⇧K is chosen specifically to avoid the terminal-clear binding (⌘K / Ctrl+K,
  which is matched with no Shift); the palette shortcut carries Shift, so it never
  triggers `term.clear()`. It must still not leak to a focused terminal as input
  (capture-phase + preventDefault).
