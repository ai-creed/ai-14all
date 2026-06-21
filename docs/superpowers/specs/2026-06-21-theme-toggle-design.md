# Theme Toggle Button — Design Spec

**Date:** 2026-06-21
**Status:** Approved (revised after spec review)

---

## Overview

Add a theme toggle button to the sidebar footer so users can switch between light, dark, and system themes without going through the OS app menu. The button sits to the right of the "Load workspace" button in the expanded sidebar, and stacks above it in the collapsed state.

---

## Behaviour

### Cycle order

```
dark → system → light → dark → …
```

Each click advances to the next mode. The icon reflects the **selected mode** (`ThemeMode`), not the resolved palette. The tooltip describes what the next click will do.

| Selected mode (`ThemeMode`) | Icon | Tooltip |
|---|---|---|
| `dark` | 🌙 | "Switch to system theme" |
| `system` | ⊙ | "Switch to light theme" |
| `light` | ☀️ | "Switch to dark theme" |
| `warm` (set via app menu only) | 🌙 | "Switch to system theme" |

> **Why `ThemeMode`, not `Palette`?** `Palette` is always a resolved display value (`"light"`, `"dark"`, or `"warm"`). When the user selects `system` mode, `palette` resolves to the OS value — it never holds `"system"`. To show the ⊙ icon correctly, we must track the *selected* `ThemeMode`.

### Persistence

No persistence across restarts. The app defaults to `system` on every launch (existing behaviour). The toggle is session-only.

### Modes excluded from the cycle

`warm` is not part of the toggle cycle — it remains accessible via the OS app menu only. If the user arrives in `warm` mode (set via app menu), clicking the toggle moves them to `system`.

---

## Layout

### Expanded sidebar

Footer uses a flex row. "Load workspace" takes `flex: 1`; the icon button is fixed-width, pinned to the right.

```
[ Load workspace          ] [🌙]
```

### Collapsed sidebar

Footer switches to a column layout. Icon button renders above the "Load" dot.

```
[🌙]
[L ]
```

---

## Components & Props

### `useTheme()` — `src/lib/use-theme.ts`

Expose `mode: ThemeMode` in the return value (currently it stores `mode` internally but does not export it):

```ts
// Before
return { resolvedTheme: monacoThemeFor(palette), palette, setTheme: setMode };

// After
return { resolvedTheme: monacoThemeFor(palette), palette, mode, setTheme: setMode };
```

### `App.tsx` — `src/app/App.tsx`

Destructure `mode` from `useTheme()` alongside the existing `palette` and `resolvedTheme`. Pass two new props to `SidebarPanel`:

- `themeMode: ThemeMode` — the selected mode (not the resolved palette)
- `onThemeToggle: () => void` — calls `setTheme` with the next mode in the cycle

Cycle helper (place near the `App` function or as a module-level const):

```ts
// Takes ThemeMode (selected mode). "warm" is treated the same as "dark" —
// the cycle doesn't include warm, so this moves the user out of it to "system".
function nextThemeMode(current: ThemeMode): ThemeMode {
  if (current === "dark" || current === "warm") return "system";
  if (current === "system") return "light";
  return "dark"; // light → dark
}
```

### `SidebarPanel` — `src/app/components/SidebarPanel.tsx`

Add to `Props` (import `ThemeMode` from `src/lib/use-theme.ts`):

```ts
themeMode: ThemeMode;
onThemeToggle: () => void;
```

Thread both straight through to `<SessionSidebar>`.

### `SessionSidebar` — `src/features/workspace/components/SessionSidebar.tsx`

Add to `Props` (import `ThemeMode` from `src/lib/use-theme.ts`):

```ts
themeMode: ThemeMode;
onThemeToggle: () => void;
```

Derive icon and label from `themeMode`:

```ts
const themeIcon =
  themeMode === "light" ? "☀️" :
  themeMode === "dark"  ? "🌙" : "⊙"; // system or warm → ⊙

const themeLabel =
  themeMode === "light"   ? "Switch to dark theme" :
  (themeMode === "dark" || themeMode === "warm") ? "Switch to system theme" :
  "Switch to light theme";
```

Replace the existing `shell-sidebar__footer--global` block (currently a single button). The "Load workspace" button text `{collapsed ? "Load" : "Load workspace"}` is unchanged — only the wrapping layout and the new icon button are added:

```tsx
<div className="shell-sidebar__footer shell-sidebar__footer--global">
  <div
    style={{
      display: "flex",
      flexDirection: collapsed ? "column" : "row",
      alignItems: "center",
      gap: 6,
    }}
  >
    <button
      type="button"
      className="shell-button shell-button--compact"
      style={collapsed ? undefined : { flex: 1 }}
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

> **Note on collapsed order:** In column layout, the Load button renders first in DOM order (top), and the theme icon renders second (bottom) — matching the mockup. Wait, the approved mockup shows theme icon *above* Load when collapsed. Reverse the render order when collapsed, or use `flexDirection: "column-reverse"` — **use `column-reverse`** to keep a single JSX order and let CSS handle the visual flip.

Correction to the markup — use `column-reverse` so the icon appears above Load in collapsed state without reordering JSX:

```tsx
flexDirection: collapsed ? "column-reverse" : "row",
```

---

## Files Changed

| File | Change |
|---|---|
| `src/lib/use-theme.ts` | Export `mode: ThemeMode` from `useTheme()` return value |
| `src/app/App.tsx` | Destructure `mode`, pass `themeMode={mode}` and `onThemeToggle` to `SidebarPanel` |
| `src/app/components/SidebarPanel.tsx` | Add `themeMode` + `onThemeToggle` props, thread to `SessionSidebar` |
| `src/features/workspace/components/SessionSidebar.tsx` | Add props + toggle button + flex layout wrapper in footer |

4 files total (one additional from original spec: `use-theme.ts` needs to expose `mode`).

---

## Edge Cases & Test Suggestions

- **⊙ icon reachable**: `themeMode === "system"` correctly shows ⊙ because we track `ThemeMode`, not `Palette`.
- **Warm palette escape**: `nextThemeMode("warm")` returns `"system"` — the button correctly exits warm mode without including it in the cycle.
- **Collapsed visual order**: `column-reverse` ensures the theme icon is visually above the Load button without reordering JSX.
- **Tooltip accuracy**: `aria-label` and `title` always describe the *next* mode, not the current one.
- **System resolution**: When mode is `system`, the OS may be light or dark — the icon always shows ⊙ (selected mode), never ☀️ or 🌙.

### Suggested test cases

1. Clicking toggle from `dark` sets mode to `system` (⊙ icon appears).
2. Clicking toggle from `system` sets mode to `light` (☀️ icon appears).
3. Clicking toggle from `light` sets mode to `dark` (🌙 icon appears).
4. Starting in `warm` (set via app menu) and clicking toggle moves to `system` (⊙ icon appears).
5. In collapsed state, theme icon is visually above the Load button.
6. `aria-label` on the button describes the *next* mode, not the current one.
7. `useTheme()` return value includes `mode: ThemeMode` with correct value after `setTheme` is called.
