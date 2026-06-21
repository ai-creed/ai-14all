# Theme Toggle Button — Design Spec

**Date:** 2026-06-21
**Status:** Approved

---

## Overview

Add a theme toggle button to the sidebar footer so users can switch between light, dark, and system themes without going through the OS app menu. The button sits to the right of the "Load workspace" button in the expanded sidebar, and stacks above it in the collapsed state.

---

## Behaviour

### Cycle order

```
dark → system → light → dark → …
```

Each click advances to the next mode. The icon reflects the **current** mode; the tooltip describes what the next click will do.

| Current mode | Icon | Tooltip |
|---|---|---|
| `dark` | 🌙 | "Switch to system theme" |
| `system` | ⊙ | "Switch to light theme" |
| `light` | ☀️ | "Switch to dark theme" |

### Persistence

No persistence across restarts. The app defaults to `system` on every launch (existing behaviour). The toggle is session-only.

### Modes excluded

`warm` is not part of the toggle cycle. It remains accessible via the OS app menu only.

---

## Layout

### Expanded sidebar

Footer row uses `display: flex; gap: 6px`. "Load workspace" takes `flex: 1` (remaining space); the icon button is `width: 30px`, pinned to the right.

```
[ Load workspace          ] [🌙]
```

### Collapsed sidebar

Footer uses `display: flex; flex-direction: column; align-items: center; gap: 6px`. Icon button renders above the "Load" dot.

```
[🌙]
[L ]
```

---

## Components & Props

### `useTheme()` — `src/lib/use-theme.ts`

No changes. Already exposes `palette: Palette` and `setTheme: (mode: ThemeMode) => void`. Called once in `App.tsx`.

### `App.tsx` — `src/app/App.tsx`

Pass two new props to `SidebarPanel`:
- `themePalette: Palette` — current palette value from `useTheme()`
- `onThemeToggle: () => void` — calls `setTheme` with the next mode in the cycle

The cycle logic lives here as a small helper (or inline arrow):

```ts
function nextThemeMode(palette: Palette): ThemeMode {
  if (palette === "dark") return "system";
  if (palette === "light") return "dark";
  return "light"; // system (or warm) → light
}
```

### `SidebarPanel` — `src/app/components/SidebarPanel.tsx`

Add to `Props`:
```ts
themePalette: Palette;
onThemeToggle: () => void;
```

Thread both straight through to `<SessionSidebar>`.

### `SessionSidebar` — `src/features/workspace/components/SessionSidebar.tsx`

Add to `Props`:
```ts
themePalette: "light" | "dark" | "warm";
onThemeToggle: () => void;
```

Add the toggle button in `shell-sidebar__footer--global`. Button uses existing classes:
`shell-button shell-button--icon shell-button--compact`

Icon and aria-label derived from `themePalette`:
```ts
const themeIcon = palette === "light" ? "☀️" : palette === "dark" ? "🌙" : "⊙";
const themeLabel = palette === "light" ? "Switch to dark theme"
                 : palette === "dark"  ? "Switch to system theme"
                 :                       "Switch to light theme";
```

Footer markup (expanded — flex row):
```tsx
<div className="shell-sidebar__footer shell-sidebar__footer--global">
  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
    <button
      type="button"
      className="shell-button shell-button--compact"
      style={{ flex: 1 }}
      onClick={onLoadWorkspace}
      aria-label="Load workspace"
    >
      {collapsed ? "Load" : "Load workspace"}
    </button>
    <button
      type="button"
      className="shell-button shell-button--icon shell-button--compact"
      aria-label={themeLabel}
      title={themeLabel}
      onClick={onThemeToggle}
    >
      {themeIcon}
    </button>
  </div>
</div>
```

When collapsed, the outer `div` switches to `flex-direction: column; align-items: center`.

---

## Files Changed

| File | Change |
|---|---|
| `src/app/App.tsx` | Pass `themePalette` and `onThemeToggle` to `SidebarPanel` |
| `src/app/components/SidebarPanel.tsx` | Add two props, thread to `SessionSidebar` |
| `src/features/workspace/components/SessionSidebar.tsx` | Add two props + toggle button in footer |

No new files. No CSS additions (reuses existing button classes).

---

## Edge Cases & Test Suggestions

- **Warm palette**: `nextThemeMode("warm")` falls through to `"light"` — warm palette is set only via app menu and the button correctly escapes it to light.
- **System theme resolution**: When mode is `system`, the displayed icon is ⊙ regardless of whether the OS is currently light or dark — the toggle reflects the *selected mode*, not the resolved palette.
- **Collapsed state visual**: Both buttons must be centered and equally sized (30×30) so the footer doesn't look misaligned.
- **Tooltip consistency**: `aria-label` and `title` should always match the next mode (not current mode).

### Suggested test cases

1. Clicking the toggle from dark mode switches palette to system (⊙ icon appears).
2. Clicking the toggle from system mode switches palette to light (☀️ icon appears).
3. Clicking the toggle from light mode switches palette to dark (🌙 icon appears).
4. In collapsed state, theme button renders above Load button.
5. `aria-label` on the button describes the *next* mode, not the current one.
6. Starting in warm mode (set via app menu) and clicking toggle moves to light.
