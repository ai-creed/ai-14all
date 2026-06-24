# Spec: Workspace Panel Rework — Git-Tree Worktree Navigator

**Status:** Design approved (2026-06-24) via an interactive prototype iterated with the
user. Not yet implemented.
**Scope:** Restructure the left **Workspace** sidebar from a flat worktree list into a
collapsible **repo → worktree git tree**, with a unified icon set, a tightened typography
ladder, a solid 2px tree rail, and a palette-based theme switcher.
**Reference prototype:** `docs/design-specs/2026-06-24-workspace-panel-rework-prototype.html`
(self-contained, on the app's real tokens — open in a browser to see every interaction).
**Source of the target design:** user mockup (see commit image history) of the desired
panel.

## 1. Goal

The Workspace panel today renders each repo ("workspace group") as a chromeless section
with a **flat, always-visible list** of bordered worktree cards — no tree connectors, no
per-repo collapse, scattered font sizes, and a settings affordance that doesn't read as
"theme." The mockup asks for a proper **file-tree** presentation: each repo is a
collapsible node, its worktrees hang off a vertical rail with `├─`/`└─` elbows, and the
chrome (icons, type scale, bottom bar) is consistent and legible.

This rework is **structural** — the tree, typography ladder, icon unification, and layout
land in `shell.css` + the panel components, so **all four themes** (dark/light/warm/tui)
benefit. Color comes from the existing per-theme tokens; nothing here is palette-specific
except the new `--rail` token, which is defined once per theme.

The existing TUI spec already lists `marker-tree` for `WorktreeTree` as
*specced-but-not-built* (`docs/design-specs/tui-css-spec.md` §12.2); this spec supersedes
and concretizes that line item.

## 2. Current state → gap

| Area | Today | Target |
|---|---|---|
| Hierarchy | Flat list of worktree cards under a chromeless repo section (`SessionSidebar.tsx`) | 2-depth tree: repo node → worktree rows on a rail |
| Repo header | Plain name button, no expander | Chevron + git-branch icon + UPPERCASE name; collapsible |
| Connectors | None | 2px **solid** CSS rail + square `├─`/`└─` elbows |
| Remove workspace | Close affordance exists in `WorkspaceSwitcher` | `×` on the repo title, **revealed on hover** |
| Worktree row | Rich card (branch, path, chips, process dot); active row bordered + `×` | Unchanged content, re-parented under the rail |
| Typography | 16/17px name, 14px title, 13px branch, 0.7rem chips (scattered) | One `--ws-fs-*` ladder |
| Bottom bar | "Load workspace" + a gear | "Load workspace" + **palette** theme switcher |
| Collapsed panel | Letter badges with borders | Centered git-icon **+ initial**, no borders, even padding |

## 3. Design decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Option A** tree rendering: 2px solid CSS rail + square elbows | Crisp like the mockup, reflows with variable-height rich rows, themeable via one token, square corners match the radius-0 design system. (Rejected: B box-drawing glyphs — heavier, font-dependent; C indent-guide only — loses the "connects to item" read.) |
| D2 | Tree is **2 depths only** (repo → worktree) | The data model is workspace(repo) → worktrees; no deeper nesting exists. |
| D3 | **Every worktree renders as a rich row**; chips degrade gracefully when there's no session | User chose "always rich rows." Discovered/unloaded repos (no provider/state) show branch + path only — see CAPSTONE-IELTS in the prototype. |
| D4 | Repo groups are **collapsible and persisted** | Matches the chevron in the mockup; collapse state survives restart. |
| D5 | **Keep filled provider pills** (e.g. `claude` on amber); retune spacing only | User choice. Deliberate deviation from the mockup's dot+label provider — see §15. |
| D6 | **Unify all panel icons** on the Nerd Font `<Icon>` registry | "Replace icons to stay consistent with others." Adds `git-branch` + `palette`; reuses `caret-*`, `close`, `dot`, `plus`. |
| D7 | Bottom gear → **palette** icon, opens a theme menu | A palette reads as "pick a visual theme" better than a settings gear (4 color themes, not light/dark). |
| D8 | New **solid** `--rail` token per theme (no alpha) | User: "hairline should be solid color without opacity." `--border` carries alpha in dark; a dedicated solid token keeps the rail crisp and tunable. |
| D9 | CTAs ("+ New worktree", "Load workspace") sized at `--ws-fs-branch` (13px) | User-selected after trying header/repo sizes. |

## 4. Information architecture

```
WORKSPACE                                   [◧ collapse panel]
│
├─ ▾  ⎇ AI-14ALL                            [× on title hover]   ← repo node (depth 0)
│     ├─ master            [× when active]   ← worktree row (depth 1, boxed when active)
│     │     tui-polish-1
│     │     [claude] ● CL active
│     ├─ product-document
│     │     main
│     │     [claude] ● stale
│     └─ + New worktree                       ← last node on the rail (loaded repos only)
│  ── separator ──
└─ ▾  ⎇ CAPSTONE-IELTS                                            ← unloaded repo
      ├─ master
      │     main                              ← rich row, no chips (no session)
      └─ product-document
            main
                                             [ Load workspace ]   [palette ⊕]
```

- **Repo node**: `role="treeitem" aria-expanded`. Clicking the header (or chevron)
  toggles collapse. A hover-revealed `×` removes the workspace.
- **Worktree rows**: inside `role="group"`. Selecting one moves the bordered box + close
  `×` to it. `+ New worktree` is the last child on the rail (loaded repos), so it carries
  the `└─` elbow.
- A flat 1px `--border` separator sits between repo groups (replaces today's gradient
  `::before` divider).

## 5. Typography ladder — `tokens.css`

New workspace-scoped tokens (layered on the existing `--font-size-body: 13px`):

```css
:root {
  --ws-fs-header: 11px;   /* "WORKSPACE" panel title  — 600, uppercase, tracking .12em, --muted-foreground */
  --ws-fs-repo:   15px;   /* repo name                — 700, uppercase, tracking .04em, --foreground */
  --ws-fs-branch: 13px;   /* worktree branch + CTAs   — 600, --foreground */
  --ws-fs-path:   12px;   /* path subtitle            — 400, --muted-foreground */
  --ws-fs-chip:   11px;   /* provider pill + state    — 500/600 */
}
```

This consolidates today's scattered values (`shell.css` repo name 16/17px, worktree title
14px, branch 13px, chips 0.7rem). **CTAs use `--ws-fs-branch` (13px)** (D9).

## 6. Tree rail — `shell.css`

Locked geometry from the prototype. The trunk is centered on the chevron: the header has
`padding-left: 4px` and the chevron is a `12px`, `text-align:center` box, so the chevron's
center sits at **x = 10px**; the 2px trunk is drawn at `left: 9px` (spanning 9–11px,
center 10px). Worktree rows sit inside `.ws-repo__children` (no horizontal padding) so
their left edge aligns with the header's.

```css
/* Each worktree row + the New-worktree button is wrapped in a .ws-node */
.ws-node { position: relative; padding-left: 24px; }

/* vertical trunk (2px solid, centered on the chevron at x=10) */
.ws-node::before {
  content: ""; position: absolute; left: 9px; top: 0; bottom: 0;
  border-left: 2px solid var(--rail);
}
/* last child stops the trunk at the elbow -> └─ */
.ws-node:last-child::before { bottom: auto; height: 18px; }

/* horizontal elbow, aligned to the branch-name line */
.ws-node::after {
  content: ""; position: absolute; left: 9px; top: 17px;
  width: 13px; height: 2px; background: var(--rail);
}
```

### 6.1 Solid `--rail` token (D8) — `tokens.css`, one per theme block

```css
[data-theme="dark"], :root { --rail: oklch(0.42 0.02 256); }
[data-theme="light"]      { --rail: oklch(0.80 0.012 256); }
[data-theme="warm"]       { --rail: #6b5d48; }
[data-theme="tui"]        { --rail: oklch(0.44 0.015 240); }
```

(Implementation note: in the prototype the four theme blocks precede `:root`; because
attribute selectors and `:root` have equal specificity, `--rail` is defined **only** in
the theme blocks so a later `:root` rule can't override them. In `tokens.css` the dark
defaults live in `:root`, so put dark's `--rail` there and the others in their
`[data-theme]` blocks.)

## 7. Icons — `src/components/ui/icon.tsx`

Route every panel icon through `<Icon>`; extend `ICON_GLYPHS`:

- **Add** `git-branch` (repo header + collapsed rail) and `palette` (bottom theme
  switcher). Pick Nerd Font codepoints from the bundled Symbols Nerd Font — candidates:
  `git-branch` → nf-oct-git_branch (`󰈥` / ``), `palette` → nf-oct-paintbrush
  or nf-md-palette (``). Each entry keeps a text `fallback` per the registry contract.
- **Reuse** `caret-down`/`caret-right` (chevron), `close` (`×`), `dot` (status), `plus`.
- The registry already has `gear`; it is **replaced at the call site** by `palette` for
  the theme switcher (D7) — do not remove `gear` (other call sites may use it).

The prototype draws `git-branch` and `palette` as inline SVG only because Nerd Font isn't
guaranteed in a bare browser; in-app they are Nerd Font glyphs via `<Icon>`.

## 8. Status chips — `shell.css`

Unchanged rendering, retuned to the ladder (D5):

- **Provider**: filled pill `.shell-sidebar__provider-badge[data-provider=…]` — `claude`
  amber (`--provider-claude`), `codex` blue, etc. (`background: color-mix(... 14%)`,
  `color: <provider>`). Set `font-size: var(--ws-fs-chip)`.
- **Process state**: 6px `.shell-sidebar__process-indicator[data-state=…]` dot —
  `active` = `--warning`, `idle` = muted, `actionRequired` = `--danger` (pulsing halo),
  `exited` = hollow. Paired with a `--ws-fs-chip` label ("CL active", "stale").
- Provider pill + state dot+label share one row under the path with `gap` ≈ 10px.

## 9. Collapse behavior + persistence

- Chevron rotates (`▾` open → `▸` collapsed via `transform: rotate(-90deg)`).
- Collapsing hides `.ws-repo__children`.
- **Persistence**: store the set of collapsed repo IDs in the workspace state
  (`src/features/workspace/logic/workspace-state.ts` reducer, backed by the app's
  better-sqlite3 / settings persistence) so it survives restart. (The prototype uses
  `localStorage` as a stand-in.)

## 10. Collapsed panel (mini-rail) — `SidebarPanel.tsx`

When the panel is collapsed (`◧` top-right):

- Width ~56px; header and footer center their single icon (`justify-content: center`).
- Each workspace shows the **git icon + first initial side by side** (row layout,
  `gap: 5px`), centered, **no borders**, clicking expands the panel.
- The mini list has **even top/bottom padding** (`18px 0`, `gap: 18px`) so the last
  workspace matches the rest.
- All icons (top collapse, repo icons, bottom palette) share the centered vertical column.

Reconcile with the existing `WorkspaceSwitcher.tsx` (today's compact letter-badge view) —
this becomes its rendering.

## 11. Theme switcher — `SidebarPanel.tsx` + `use-theme.ts`

- "Load workspace" CTA stays; beside it the **palette** icon opens a theme menu
  (dark / light / warm / tui) rendered with the shadcn dropdown-menu, driving the existing
  `src/lib/use-theme.ts`. The active theme is checkmarked.

## 12. Component / file changes

| File | Change |
|---|---|
| `src/features/workspace/components/SessionSidebar.tsx` | Tree restructure (repo node → `.ws-node` rows), chevron + git icon header, hover `×` remove-workspace, `role=tree/treeitem/group` + `aria-expanded`, rail markup |
| `src/app/components/SidebarPanel.tsx` | Collapsed mini-rail (icon + initial, centered, even padding), bottom palette theme switcher |
| `src/features/workspace/components/WorkspaceSwitcher.tsx` | Folded into the collapsed mini-rail rendering |
| `src/components/ui/icon.tsx` | Add `git-branch` + `palette` to `ICON_GLYPHS` |
| `src/app/shell.css` | Rail CSS (§6), typography ladder application, repo separator, chip spacing, collapsed centering, CTA sizes |
| `src/styles/tokens.css` | `--ws-fs-*` tokens (§5), solid `--rail` per theme (§6.1) |
| `src/features/workspace/logic/workspace-state.ts` | Persisted per-repo collapse state |
| `src/lib/use-theme.ts` | Reused by the palette switcher (no API change expected) |

## 13. Accessibility

- Rails/elbows are decorative — drawn via `::before`/`::after`, no DOM nodes, not announced.
- Tree semantics: `role="tree"` on the container, `role="treeitem" aria-expanded` on repo
  headers, `role="group"` on `.ws-repo__children`.
- Repo `×` and worktree `×` are real buttons (or `role="button"` with key handlers) with
  `aria-label`; `stopPropagation` so they don't toggle collapse/selection.
- Keep `focus-visible` outlines (per `tui-css-spec.md` D6). Hover-revealed `×` must also
  appear on `:focus-within` (already in the prototype).

## 14. Testing

- **Vitest**: tree renders repo → worktree hierarchy; collapse toggles + persists;
  last-child gets the `└─` (trunk-stop) treatment; rich row degrades to branch+path when
  no session; icon registry contains `git-branch` + `palette`; repo `×` removes a
  workspace.
- **Playwright screenshots**: add Workspace-panel captures (expanded + collapsed) per
  theme into `tests/__screenshots__/`, extending the existing gallery flow, for
  before/after review.

## 15. Deviations from the mockup (deliberate)

- **Provider chip**: the mockup shows `● claude` as a dot+label; we keep the existing
  **filled amber pill** (D5, user's call). Session-state/staleness stays dot+label.
- **Repo icon**: the mockup's diamond `◈` is replaced by a **git-branch** glyph
  (user request).
- **Bottom-right icon**: gear → **palette** (D7).

## 16. Out of scope / open questions

- No deeper-than-2 nesting; no drag-reorder of worktrees.
- `+ New worktree` shown under **loaded** repos only (matches mockup); confirm whether
  unloaded/discovered repos should also offer it.
- Exact Nerd Font codepoints for `git-branch`/`palette` to be confirmed against the
  bundled Symbols Nerd Font at implementation time (§7).
- Whether the collapse-state store should be per-workspace or global is left to the
  reducer design.

## 17. Reference prototype

`docs/design-specs/2026-06-24-workspace-panel-rework-prototype.html` is the approved,
fully-interactive reference (real tokens; A/B/C tree toggle; theme switch; collapse,
select, close, add-worktree, remove-workspace, panel-collapse interactions). It is the
visual source of truth for spacing and the locked Option-A geometry above.
