# Keyboard Shortcut System — Design

**Date:** 2026-04-18
**Status:** Approved for implementation planning

## 1. Goal

Add a centralized, user-configurable keyboard shortcut system that accelerates common daily workflow actions — worktree and workspace navigation, terminal management, review pane switching, and layout control — without conflicting with terminal input.

## 2. Non-goals

- In-app settings UI for rebinding shortcuts (v1 is file-based only; UI is a follow-up)
- Linux or Windows support (macOS only for v1; platform detection is built in for future extension)
- Shortcuts for every action in the app — only common workflow actions in v1
- Global shortcuts that fire when the app is backgrounded

## 3. Approach

Use a renderer-only centralized shortcut hook. All shortcuts are registered and dispatched in the renderer. `Cmd+` combinations are safe to intercept on macOS because terminals only use `Ctrl+` for control codes; `Cmd` (Meta) is unused by terminal programs.

xterm cooperates by returning `false` from its `attachCustomKeyEventHandler` for keys that match the registry. This prevents xterm from calling `preventDefault()`, letting the event bubble to the document-level listener mounted by the hook.

## 4. Architecture

### 4.1 File structure

```
src/features/keyboard/
  default-keybindings.ts     — built-in defaults, grouped by platform
  keybindings-schema.ts      — Zod schema for keybindings.json validation
  shortcut-registry.ts       — parses bindings, normalizes to KeyboardEvent matchers, exposes matchesAny / resolve
  keyboard-context.ts        — React context exposing ShortcutRegistry to TerminalPane
  useKeyboardShortcuts.ts    — main hook: loads config via IPC, builds registry, mounts document listener
  ShortcutsHelpModal.tsx     — help overlay (Cmd+/)
```

### 4.2 New IPC endpoint

```
keyboard:loadKeybindings() → Promise<string | null>
```

Main handler reads `<userData>/keybindings.json` (`app.getPath('userData')` — resolves to `~/Library/Application Support/ai14all/` on macOS). Returns the raw JSON string, or `null` if the file does not exist or cannot be read. The renderer owns parsing and validation.

- Zod schema in `shared/contracts/commands.ts` (no parameters, returns `string | null`).
- Preload bridge exposes `keyboard.loadKeybindings()`.
- Renderer client `src/lib/desktop-client.ts` forwards the call.

### 4.3 Platform abstraction

`detectPlatform()` reads `navigator.userAgent` (renderer-safe, no IPC needed) and returns `"macos" | "linux" | "windows"`.

Binding strings use a platform-neutral modifier token `cmd`. At parse time, `cmd` resolves to `metaKey` on macOS, and will resolve to `ctrlKey` on Linux/Windows when those platforms are added:

```ts
const PLATFORM_MODIFIER: Record<Platform, "metaKey" | "ctrlKey"> = {
  macos:   "metaKey",
  linux:   "ctrlKey",   // future
  windows: "ctrlKey",   // future
};
```

### 4.4 Shortcut registry

`shortcut-registry.ts` exposes:

```ts
type ShortcutRegistry = {
  /** O(1) lookup — used by TerminalPane's attachCustomKeyEventHandler */
  matchesAny(event: KeyboardEvent): boolean;
  /** Returns the matched action ID, or null */
  resolve(event: KeyboardEvent): string | null;
};
```

Parsing `"cmd+shift+]"` on macOS produces `{ metaKey: true, shiftKey: true, altKey: false, ctrlKey: false, key: "]" }`. The lookup key is a stable string built from the normalized fields — O(1) Map lookup.

### 4.5 useKeyboardShortcuts hook

Lifecycle:

1. **Mount** — call `keyboard.loadKeybindings()`, validate with Zod (invalid entries skipped with a console warning), build registry from user bindings or defaults, expose via `KeyboardContext`.
2. **Mount document listener** — `document.addEventListener('keydown', handler)`. Handler calls `registry.resolve(event)`, looks up the action in the provided action map, calls it, then calls `event.preventDefault()`. Unknown action IDs (user config references a future action) are silently ignored.
3. **Unmount** — remove the document listener.

Action handlers are passed as a stable map from `App.tsx`:

```ts
useKeyboardShortcuts({
  actions: {
    "worktree.selectNext": () => dispatch({ type: "session/selectWorktree", worktreeId: nextId }),
    "terminal.new": () => handleNewTerminal(),
    // ...
  }
});
```

`App.tsx` wraps its render tree in `<KeyboardContext.Provider value={registry}>` so `TerminalPane` can read the registry without prop drilling through `TerminalTabs`.

### 4.6 xterm integration

`TerminalPane.tsx` — `attachCustomKeyEventHandler` gains one check at the top, before the existing Shift+Enter and Cmd+K handlers:

```ts
const registry = useContext(KeyboardContext);

term.attachCustomKeyEventHandler((event) => {
  // Pass registered shortcuts to the document-level handler
  if (registry?.matchesAny(event)) return false;

  // Existing Shift+Enter handler (unchanged) ...
  // Existing Cmd+K clear handler (unchanged) ...
});
```

Returning `false` means xterm skips `preventDefault()` and does not send the key to the PTY. The event then bubbles to the document listener. `Cmd+K` is kept as a terminal-local handler and is excluded from the global shortcut defaults to avoid conflict.

## 5. Keybindings file format

Location: `~/Library/Application Support/ai14all/keybindings.json` (macOS).

```json
{
  "version": 1,
  "bindings": [
    { "action": "worktree.selectNext", "key": "cmd+]" },
    { "action": "terminal.new",        "key": "cmd+t" }
  ]
}
```

User bindings **replace** the full default set — no merging or patching. If the file is absent, entirely invalid JSON, or produces zero valid bindings after Zod filtering, built-in defaults are used. This keeps the mental model simple: the file is the complete active configuration.

Supported modifier tokens: `cmd`, `shift`, `alt`, `ctrl`. Key names follow `KeyboardEvent.key` values (case-insensitive in the parser).

## 6. Default shortcuts (macOS, v1)

| Action ID | Default key | Description |
|---|---|---|
| `worktree.selectNext` | `Cmd+]` | Select next worktree |
| `worktree.selectPrev` | `Cmd+[` | Select previous worktree |
| `workspace.selectNext` | `Cmd+Shift+]` | Select next workspace |
| `workspace.selectPrev` | `Cmd+Shift+[` | Select previous workspace |
| `terminal.new` | `Cmd+T` | New terminal in active worktree |
| `terminal.close` | `Cmd+Shift+W` | Close active terminal |
| `terminal.selectNext` | `Cmd+Shift+K` | Next terminal tab |
| `terminal.selectPrev` | `Cmd+Shift+J` | Previous terminal tab |
| `terminal.toggleSplit` | `Cmd+D` | Toggle split terminal mode |
| `layout.toggleTopBand` | `Cmd+B` | Collapse / expand terminal band |
| `review.files` | `Cmd+1` | Switch review pane to Files |
| `review.changes` | `Cmd+2` | Switch review pane to Changes |
| `review.commits` | `Cmd+3` | Switch review pane to Commits |
| `ui.openWorkspacePicker` | `Cmd+O` | Open workspace picker (existing menu accelerator) |
| `ui.showShortcuts` | `Cmd+/` | Show shortcuts help overlay |

`Cmd+W` is intentionally avoided — it conflicts with the macOS "Close Window" menu accelerator from `{ role: "windowMenu" }` in `menu.ts`.

`ui.openWorkspacePicker` is already handled by the Electron menu accelerator. The shortcut system registers it too for completeness (the document listener fires first in the renderer; if the menu fires it, the renderer action map handles the `workspace/openPicker` IPC event as it does today).

## 7. Help overlay

`ShortcutsHelpModal` is triggered by `ui.showShortcuts` (`Cmd+/`). It reads the active registry directly — no separate data source — so it always reflects the user's actual config (overrides or defaults).

Shortcuts are displayed grouped by category with macOS glyphs (`⌘`, `⇧`, `⌥`) on macOS, plain text tokens on other platforms.

Dismissed with `Escape` or clicking outside. No persistence needed.

## 8. Error handling

- **File unreadable / parse error** — log a console warning, fall back to built-in defaults silently. Do not surface an error to the user for a missing config file.
- **Invalid individual binding** — skip that entry, warn in console, keep the rest.
- **Action ID in config with no registered handler** — silently ignored. Forward-compatible with actions added in future versions.
- **Duplicate key combo in user config** — last binding wins (standard convention).

## 9. Testing

### 9.1 Unit (vitest)

- `shortcut-registry.test.ts`
  - `"cmd+]"` parses to `{ metaKey: true, key: "]" }` on macOS
  - `matchesAny` returns `true` for a matching event, `false` otherwise
  - `resolve` returns the correct action ID
  - Duplicate key combo: last binding wins
  - Unknown modifier token in binding string: entry is skipped
- `default-keybindings.test.ts`
  - No two default bindings share the same key combo (uniqueness assertion)
- `useKeyboardShortcuts.test.ts`
  - Mocked IPC returning valid JSON: user bindings replace defaults
  - Mocked IPC returning `null`: falls back to built-in defaults
  - Mocked IPC returning invalid JSON: falls back to built-in defaults
  - `document` keydown event matching a registered action calls the correct handler
  - `document` keydown event for an unregistered action ID is ignored without throwing

### 9.2 E2E (Playwright)

Extend `tests/e2e/cumulative-flow.phase-9.test.ts` (or the latest phase file):

- Focus a terminal → press `Cmd+]` → assert active worktree changes to the next one
- Press `Cmd+/` → assert shortcuts help modal is visible → press `Escape` → assert modal is dismissed

## 10. Rollout / follow-ups

- **Phase 1 (this spec):** implement the full system described above.
- **Phase 2 (follow-up, not in this spec):**
  - In-app settings UI for rebinding shortcuts visually
  - Conflict detection with a warning when two actions share a key
  - Linux support (map `cmd` → `ctrl+shift` in the platform layer)
  - Reveal-in-config button in the help overlay

## 11. Risks

- **`Cmd+` combos claimed by macOS system shortcuts** (e.g. `Cmd+Space` for Spotlight) — the document listener will never fire for these since the OS consumes them first. The default set avoids known system shortcuts. User config may accidentally hit these; silent no-op is acceptable for v1.
- **Future xterm.js upgrades** — if xterm starts intercepting additional `Cmd+` combos, the `attachCustomKeyEventHandler` check still returns `false` first, so our registry intercept remains safe.
- **`Cmd+K` clash** — the existing terminal-local clear handler in `TerminalPane` fires before the registry check. As long as `Cmd+K` is absent from the default shortcut set (it is), there is no conflict.
