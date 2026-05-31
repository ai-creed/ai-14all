# UI Overhaul: Migrate to Tailwind CSS + shadcn/ui

**Date:** 2026-05-31
**Goal:** Modernize the styling system — replace the monolithic `shell.css` (4,326 lines) with Tailwind CSS utility classes and shadcn/ui components. Keep the current UI layout and UX unchanged.
**Approach:** Big bang — convert everything at once, delete `shell.css` when done.

---

## 1. Infrastructure Setup

### New Dependencies

**Production:**
- `tailwindcss` + `@tailwindcss/vite` (Tailwind v4, Vite plugin)
- `class-variance-authority` — variant styling utility (shadcn dep)
- `clsx` — conditional class joining (shadcn dep)
- `tailwind-merge` — deduplicates conflicting Tailwind classes (shadcn dep)
- `lucide-react` — icon library used by shadcn components

**Dev / CLI:**
- `shadcn` (via `pnpm dlx`) — not a permanent dependency; used to init and add components

### Packages to Remove

All `@radix-ui/*` packages are removed from `package.json` — shadcn bundles its own Radix internally:
- `@radix-ui/react-context-menu`
- `@radix-ui/react-dialog`
- `@radix-ui/react-dropdown-menu`
- `@radix-ui/react-scroll-area`
- `@radix-ui/react-separator`
- `@radix-ui/react-tabs`
- `@radix-ui/react-tooltip`

### Config Changes

**`electron.vite.config.ts`** — add Tailwind Vite plugin to the renderer section:
```ts
import tailwindcss from "@tailwindcss/vite";

// In renderer.plugins:
plugins: [react(), tailwindcss()],
```

**`tsconfig.json`** — add path aliases for `@/` imports:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

**`components.json`** (new) — shadcn configuration:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "hooks": "@/hooks"
  }
}
```

**`src/lib/utils.ts`** (new) — shadcn utility (cn function):
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**`src/index.css`** (new) — replaces `shell.css` as the app's entry CSS. Contains:
- `@import "tailwindcss"`
- CSS variable definitions for all three themes
- `@font-face` for the powerline terminal font
- `@keyframes` for the 6 attention animations
- xterm/Monaco global style overrides
- `prefers-reduced-motion` media query

---

## 2. Theme System

### Variable Mapping

shadcn uses HSL-based CSS variables. All three themes are defined in `src/index.css`.

#### Dark Theme (`:root` / default)

| shadcn variable | Source | Value |
|---|---|---|
| `--background` | `--app-bg` | `#0b1116` |
| `--foreground` | `--text-primary` | `#eef7fa` |
| `--card` | `--panel-bg` | `#111a21` |
| `--card-foreground` | `--text-primary` | `#eef7fa` |
| `--popover` | `--panel-bg-elevated` | `#16232c` |
| `--popover-foreground` | `--text-primary` | `#eef7fa` |
| `--primary` | `--accent` | `#67d4b0` (teal) |
| `--primary-foreground` | — | `#0b1116` (dark text on teal) |
| `--secondary` | `--panel-bg-elevated` | `#16232c` |
| `--secondary-foreground` | `--text-secondary` | `#8fa4b1` |
| `--muted` | `--panel-bg-elevated` | `#16232c` |
| `--muted-foreground` | `--text-muted` | `#6f8593` |
| `--accent` | `--accent-strong` | `#15383d` |
| `--accent-foreground` | `--accent` | `#67d4b0` |
| `--destructive` | `--danger` | `#d98c8c` |
| `--border` | `--panel-border` | `#24313d` |
| `--input` | `--panel-border` | `#24313d` |
| `--ring` | `--accent` | `#67d4b0` |

#### Light Theme (`[data-theme="light"]`)

| shadcn variable | Value |
|---|---|
| `--background` | `#f0f2f5` |
| `--foreground` | `#1e2530` |
| `--card` | `#ffffff` |
| `--primary` | `#1a7fc1` (blue) |
| `--primary-foreground` | `#ffffff` |
| `--muted` | `#f5f7f9` |
| `--muted-foreground` | `#7a8a9a` |
| `--destructive` | `#c0404a` |
| `--border` | `#d0d7e0` |

#### Warm Theme (`[data-theme="warm"]`)

| shadcn variable | Value |
|---|---|
| `--background` | `#221c15` |
| `--foreground` | `#f6efe4` |
| `--card` | `#2a231b` |
| `--primary` | `#e58a5e` (terracotta) |
| `--primary-foreground` | `#221c15` |
| `--muted` | `#342c22` |
| `--muted-foreground` | `#9a8366` |
| `--destructive` | `#d97058` |
| `--border` | `#4a3f31` |

### Custom Extensions (all themes)

These variables are not part of shadcn's defaults but are needed for app-specific semantics:

| Variable | Purpose |
|---|---|
| `--warning` | Amber/yellow status (#f0c37a / #b07800 / #dda85e) |
| `--sha` | Git SHA purple (#a78bfa / #6d4cbc / #c4a0db) |
| `--provider-claude` | Claude agent badge color |
| `--provider-codex` | Codex agent badge color |
| `--pane-border-sessions` | Sessions pane border (semi-transparent blue) |
| `--pane-border-session-info` | Session info pane border (semi-transparent amber) |
| `--pane-border-terminal` | Terminal pane border (semi-transparent green) |
| `--pane-border-review` | Review pane border (semi-transparent red) |

### Theme Switching

- Keeps the existing `data-theme` attribute on `<html>`, managed by `useTheme()` hook
- shadcn's default `.dark` class convention is overridden to use `data-theme` instead
- System preference detection via `prefers-color-scheme` remains unchanged

### Typography

- Font stack: `SF Mono`, `SFMono-Regular`, `ui-monospace`, `Menlo`, `Monaco`, `monospace` — configured in Tailwind's `fontFamily` as the default
- Terminal powerline font stays as `@font-face` in `src/index.css`
- Base font size: 13px (`--font-size-body`), label size: 16px (`--font-size-label`)

### Border Radius

- shadcn `--radius`: `0.25rem` (4px) — matches current `--radius-lg`
- Tighter than shadcn defaults (6-8px), preserving the compact terminal-app feel

---

## 3. Component Migration Map

### Direct Replacements

| Current CSS / Radix | shadcn Component | Variant/Size Mapping |
|---|---|---|
| `.shell-button` | `Button` | default variant |
| `.shell-button--primary` | `Button` | `variant="default"` (primary is shadcn's default) |
| `.shell-button--danger` | `Button` | `variant="destructive"` |
| `.shell-button--compact` | `Button` | `size="sm"` |
| `.shell-button--xs` | `Button` | `size="xs"` (custom size added) |
| `.shell-button--icon` | `Button` | `size="icon"` |
| `.shell-button--round` | `Button` | Add `rounded-full` class |
| `.shell-input` | `Input` | Direct swap |
| `.shell-label` | `Label` | Direct swap |
| `.shell-toggle-switch` | `Switch` | Drop custom track/thumb entirely |
| `.shell-app-dialog` | `Dialog` | Standard variant |
| `.shell-app-dialog--wide` | `Dialog` | Custom `className` for 640px width |
| `.shell-note-sheet` | `Sheet` | `side="right"`, width via className |
| `.shell-files-overlay` | `Command` | cmdk-based; CommandInput + CommandList + CommandItem |
| `.shell-toast` | `Sonner` | Replace custom toast stack |
| `.shell-review-comment-card` | `Card` | CardHeader + CardContent |
| `.shell-sidebar__workspace-badge` | `Badge` | Count badges |
| `.shell-commit-diff-section` | `Collapsible` | CollapsibleTrigger + CollapsibleContent |
| `.shell-md-modal` | `Dialog` | Wide variant, scrollable body |
| `.shell-editor-modal` | `Dialog` | Extra-wide variant (1400px), 80vh height |
| `.shell-shortcuts-help` | `Dialog` | Two-column masonry body |
| `@radix-ui/react-tabs` | shadcn `Tabs` | TabsList + TabsTrigger + TabsContent |
| `@radix-ui/react-tooltip` | shadcn `Tooltip` | TooltipProvider + TooltipTrigger + TooltipContent |
| `@radix-ui/react-scroll-area` | shadcn `ScrollArea` | Direct swap |
| `@radix-ui/react-separator` | shadcn `Separator` | Direct swap |
| `@radix-ui/react-dropdown-menu` | shadcn `DropdownMenu` | Swap wrappers |
| `@radix-ui/react-context-menu` | shadcn `ContextMenu` | Swap wrappers |
| Usage popover | shadcn `Popover` | PopoverTrigger + PopoverContent |

### Custom Components (Tailwind utilities, no shadcn equivalent)

| Component | Migration |
|---|---|
| `.shell-layout` | `className="grid h-screen gap-4 p-4"` + dynamic `grid-template-columns` |
| `.shell-sidebar-column` | `className="relative flex min-h-0"` + resize handle logic |
| `.shell-main-column` | `className="flex flex-col gap-4 min-w-0 min-h-0 overflow-hidden"` |
| `.shell-top-band` | `className="relative grid gap-0 p-4 pr-[52px]"` + dynamic columns |
| `.shell-sidebar` | `className="grid grid-rows-[auto_minmax(0,1fr)_auto] h-full"` |
| `.shell-sidebar__row` | Tailwind utilities + data-attribute driven state classes |
| `.shell-chip-bar` | `className="flex items-center h-9"` |
| `.shell-terminal-section` | `className="grid grid-rows-[minmax(0,1fr)] flex-1 overflow-hidden"` |
| `.shell-terminal-slot` | Tailwind flex + custom header/badge styling |
| `.shell-review-grid` | `className="grid gap-0"` |
| `.shell-review-rail` | `className="grid grid-rows-[auto_minmax(0,1fr)]"` |
| `.shell-commit-list` | Tailwind grid + pseudo-element timeline (via `before:` utilities) |
| `.shell-inline-thread` | Tailwind utilities (Monaco integration stays custom) |
| `.shell-terminal-find` | `className="absolute top-2 right-2 z-10 flex"` + shadow |
| `.shell-review-expanded-portal` | Tailwind fixed positioning + flex column |

---

## 4. Globals CSS (`src/index.css` remainder)

After Tailwind import and theme variables, these stay as global CSS:

### `@font-face`
```css
@font-face {
  font-family: "AI14All Terminal Powerline";
  src: url("./assets/fonts/meslo-lg-m-dz-powerline-regular.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
```

### Animations (6 keyframes)
- `shell-sidebar-attention-rotate` — 360-degree conic gradient ring (4s)
- `shell-sidebar-attention-pulse` — opacity breath (2.5s)
- `shell-sidebar-attention-shimmer` — background position shift (3.2s)
- `shell-sidebar-action-ring` — opacity pulse (1.4s)
- `shell-sidebar-action-glow` — box-shadow pulse (1.4s)
- `shell-sidebar-process-dot-pulse` — halo pulse (1.4s)

Plus `@property` declarations for `--attention-angle` and `--attention-opacity`.

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  /* Disable all keyframe animations */
}
```

### xterm Overrides
```css
.xterm { /* bg, font overrides */ }
.xterm-screen { /* viewport constraints */ }
```

### Monaco Overrides
Minimal — only if custom theme tokens are injected.

### Body Gradient
```css
body {
  background: radial-gradient(circle at top, #10181f 0%, var(--background) 55%);
}
[data-theme="light"] body {
  background: radial-gradient(circle at top, #e8edf4 0%, var(--background) 55%);
}
[data-theme="warm"] body {
  background: radial-gradient(circle at top, #2c2318 0%, var(--background) 60%);
}
```

---

## 5. Execution Phases

### Phase 1 — Foundation
1. Install Tailwind + shadcn dependencies
2. Configure `electron.vite.config.ts` (add tailwindcss plugin to renderer)
3. Configure `tsconfig.json` (add baseUrl + paths)
4. Run `shadcn init`, install full component catalog to `src/components/ui/`
5. Create `src/index.css` with Tailwind import + three theme definitions
6. Create `src/lib/utils.ts` (cn function)
7. Verify the app builds with both CSS systems coexisting

### Phase 2 — Base Components
8. Replace `.shell-button` → shadcn `Button` across all components
9. Replace `.shell-input` → `Input`, `.shell-label` → `Label`
10. Replace `.shell-toggle-switch` → `Switch`
11. Replace `.shell-app-dialog` → shadcn `Dialog`
12. Replace `.shell-note-sheet` → shadcn `Sheet`
13. Swap all direct Radix imports to shadcn equivalents (Tabs, Tooltip, ScrollArea, Separator, DropdownMenu, ContextMenu)

### Phase 3 — Feature Components
14. `.shell-files-overlay` → shadcn `Command`
15. `.shell-toast` → `Sonner`
16. `.shell-review-comment-card` → `Card`, badges → `Badge`
17. `.shell-commit-diff-section` → `Collapsible`
18. Modal dialogs (markdown preview, editor, shortcuts help) → `Dialog` variants
19. Usage popover → shadcn `Popover`

### Phase 4 — Layout Conversion
20. Convert app shell layout classes to inline Tailwind (`.shell-layout`, `.shell-sidebar-column`, `.shell-main-column`)
21. Convert `.shell-top-band`, `.shell-session-info`, `.shell-session-note` to Tailwind
22. Convert `.shell-sidebar` grid, `.shell-chip-bar` flex to Tailwind
23. Convert `.shell-review-grid`, `.shell-review-rail`, `.shell-review-tabs` to Tailwind
24. Convert `.shell-terminal-panel__grid`, `.shell-terminal-slot` to Tailwind
25. Convert all remaining one-off classes (spacing, typography, colors, states)

### Phase 5 — Cleanup
26. Consolidate `@keyframes`, `@font-face`, xterm/Monaco overrides, body gradients into `src/index.css`
27. Delete `shell.css`
28. Delete `src/features/updater/UpdateBanner.css`
29. Remove all `@radix-ui/*` packages from `package.json`
30. Run `pnpm install` to clean lockfile
31. Run typecheck (`pnpm typecheck`)
32. Run lint + fix (`pnpm lint:fix`)
33. Run build (`pnpm build`)
34. Visual QA: verify all three themes render correctly
35. Test keyboard shortcuts, attention animations, terminal rendering, Monaco editor

---

## 6. Risk Areas

| Risk | Mitigation |
|---|---|
| **electron-vite + Tailwind plugin** | Tailwind's `@tailwindcss/vite` plugin should work in electron-vite's renderer config since it's standard Vite under the hood. Verify in Phase 1, step 7. |
| **xterm.js DOM** | xterm manages its own DOM. Global CSS selectors targeting `.xterm` / `.xterm-screen` stay in `src/index.css`. Do not attempt to Tailwind-ify xterm internals. |
| **Monaco editor** | Same as xterm — Monaco controls its own styling. Theme token injection stays as-is. |
| **Attention animations** | `@property` declarations and conic-gradient rings are cutting-edge CSS. Keep as global keyframes in `src/index.css`, reference via Tailwind's `animate-*` or inline `style`. |
| **`@tanstack/react-virtual`** | Virtualized lists apply inline styles for positioning. Tailwind classes on the container are fine; don't fight the virtualizer's inline `style` props. |
| **shadcn Radix version conflicts** | Removing explicit `@radix-ui/*` deps and relying on shadcn's bundled versions eliminates conflicts. Verify no other dep pulls in Radix. |

---

## 7. Out of Scope

- No UI/UX redesign — layouts, navigation, information hierarchy stay the same
- No new features or pages
- No changes to Electron main process, preload, or IPC
- No changes to business logic, hooks, or state management
- No changes to terminal or Monaco editor integration beyond CSS
