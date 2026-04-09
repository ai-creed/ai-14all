# Dark / Light Mode — Design Spec

**Date:** 2026-04-09
**Status:** Approved

---

## Summary

Add dark/light theme support to ai-14all. The app currently ships dark-only. This feature makes it respond to the macOS system appearance preference, with the architecture designed so a manual in-app toggle can be added later with minimal effort.

---

## Goals

- App follows the macOS system appearance (light/dark) automatically.
- Switching the system preference updates the app in real time, no restart needed.
- Monaco editor (FileViewer, DiffViewer) switches theme in sync.
- A future manual toggle requires only: calling `setTheme('light' | 'dark' | 'system')` and adding a UI button. No structural changes.

## Non-Goals

- No in-app toggle UI for this iteration.
- No persisted preference for this iteration (localStorage added when toggle ships).
- No custom Monaco theme — use built-in `vs` / `vs-dark`.

---

## Light Theme Palette

Classic IDE Light aesthetic — white/light-gray backgrounds, blue accent (VS Code-style).

| Variable | Light value | Dark value (existing) |
|---|---|---|
| `--app-bg` | `#f0f2f5` | `#0b1116` |
| `--panel-bg` | `#ffffff` | `#111a21` |
| `--panel-bg-elevated` | `#f5f7f9` | `#16232c` |
| `--panel-border` | `#d0d7e0` | `#24313d` |
| `--panel-border-strong` | `#a8b8cc` | `#345767` |
| `--text-primary` | `#1e2530` | `#eef7fa` |
| `--text-secondary` | `#4a5a70` | `#8fa4b1` |
| `--text-muted` | `#7a8a9a` | `#6f8593` |
| `--accent` | `#1a7fc1` | `#67d4b0` |
| `--accent-strong` | `#ddeeff` | `#15383d` |
| `--pane-border-sessions` | `rgba(30, 120, 220, 0.4)` | `rgba(79, 179, 255, 0.5)` |
| `--pane-border-session-info` | `rgba(180, 120, 30, 0.4)` | `rgba(246, 169, 74, 0.5)` |
| `--pane-border-terminal` | `rgba(30, 160, 100, 0.4)` | `rgba(67, 211, 158, 0.5)` |
| `--pane-border-review` | `rgba(200, 60, 80, 0.4)` | `rgba(243, 107, 138, 0.5)` |
| `--warning` | `#b07800` | `#f0c37a` |
| `--danger` | `#c0404a` | `#d98c8c` |

`body` background in light mode: `radial-gradient(circle at top, #e8edf4 0%, #f0f2f5 55%)` (mirrors the existing dark radial gradient).

---

## Architecture

### CSS Layer — `src/app/shell.css`

The existing `:root` block remains as-is (dark theme defaults). A new `[data-theme="light"]` block overrides all color variables and the `body` background. No media query — the attribute is set by JS so a future toggle can override it.

```css
[data-theme="light"] {
  --app-bg: #f0f2f5;
  /* ... all variables ... */
}

[data-theme="light"] body {
  background: radial-gradient(circle at top, #e8edf4 0%, #f0f2f5 55%);
}
```

### Theme Hook — `src/lib/useTheme.ts`

A small hook that:
1. Reads `window.matchMedia('(prefers-color-scheme: light)')` on mount.
2. Sets `document.documentElement.setAttribute('data-theme', 'light' | 'dark')`.
3. Subscribes to `matchMedia` `change` events to update reactively when the system preference changes.
4. Returns `{ resolvedTheme: 'light' | 'dark', setTheme }`.

`setTheme(mode: 'light' | 'dark' | 'system')` is wired in the hook but the app only uses `'system'` for now. When a toggle UI ships, it calls `setTheme` and the rest works automatically.

```ts
export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export function useTheme(): {
  resolvedTheme: ResolvedTheme;
  setTheme: (mode: ThemeMode) => void;
}
```

State is kept in React local state. Persistence (localStorage) is added alongside the toggle UI — one line in `setTheme`.

### App Integration — `src/app/App.tsx`

`useTheme()` is called once at the root of `App`. `resolvedTheme` is passed as a prop to the two Monaco consumers: `FileViewer` and `DiffViewer`. No context is needed — both are rendered directly in `App`.

### Monaco Integration — `FileViewer.tsx` + `DiffViewer.tsx`

Both files have `theme="vs-dark"` hardcoded on the Monaco `Editor` / `DiffEditor`. This becomes:

```tsx
theme={resolvedTheme === 'light' ? 'vs' : 'vs-dark'}
```

`vs` is Monaco's built-in light theme, `vs-dark` is its built-in dark theme. No custom theme registration needed.

---

## Files Changed

| File | Change |
|---|---|
| `src/app/shell.css` | Add `[data-theme="light"]` variable overrides + light body background |
| `src/lib/useTheme.ts` | New hook (system preference → DOM attribute) |
| `src/app/App.tsx` | Call `useTheme()`, pass `resolvedTheme` to FileViewer + DiffViewer |
| `src/features/viewer/FileViewer.tsx` | Accept `resolvedTheme` prop, pass to Monaco `Editor` |
| `src/features/viewer/DiffViewer.tsx` | Accept `resolvedTheme` prop, pass to Monaco `DiffEditor` |

---

## Future Toggle (not in scope now)

When ready, adding the toggle requires:
1. A UI button that calls `setTheme('light' | 'dark' | 'system')`.
2. One line in `useTheme` to persist to `localStorage`.
3. One line on mount to read from `localStorage` before falling back to system.

No structural changes to CSS, hook signature, or App wiring.

---

## Testing

**Unit tests:**
- `useTheme` hook: mock `matchMedia`, assert correct `data-theme` attribute is set on mount and on `change` event.
- Verify `setTheme('light')` overrides system preference; `setTheme('system')` reverts to matchMedia result.

**Manual / E2E:**
- Switch macOS appearance in System Settings → app updates without reload.
- FileViewer and DiffViewer Monaco editors switch theme in sync.
- No flash of wrong theme on cold start.
