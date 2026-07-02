# UI Design Critique — ai-14all

**Date:** 2026-07-02
**Scope:** Session view (workspace sidebar, header, agent launcher row, terminal slots, review bar), based on two live screenshots + code survey.
**Status:** Draft for refinement

## Context

ai-14all is mission control for parallel AI coding agents: session-per-worktree isolation, real PTY terminals as source of truth, an attention model rolled up in the sidebar, and in-window diff review. The center panes are embedded agent CLIs (Claude Code, Codex, etc.) — their internal rendering (message styling, task lists, permission-mode line) is owned by the CLI, not this app. This critique covers only what the app owns: the chrome and the terminal *container* (columns, font size, theme mapping).

## Priority Findings

### 1. Terminal container ergonomics — no manual font size, no measure cap 🔴

- Terminal font auto-scales by slot count only (no user override). A single-slot layout renders ~12px text across an ~1100px+ pane; prose output wraps into full-width paragraphs well past readable measure.
- **Recommendation:** per-terminal (or global) font size setting, default 13–14px; optional max-column cap (~120–140 cols) with centered gutters for single-slot layouts. Highest-impact fix; purely a container decision — does not touch CLI rendering.

### 2. Launcher row affordance confusion 🔴

- Agent badges (Claude / Codex / Ezio / Cursor / Antigravity) are *launchers* — one click mounts that agent into the focused terminal — but they're styled as passive filter pills. The adjacent collab pill ("collab · ready for workflows" / "need 1 more" / "mount an agent") is pure status in nearly identical clothing.
- **Recommendation:** give launchers action affordance (e.g. `+` glyph, button treatment, hover lift); restyle the collab pill as a clearly non-interactive status chip (or make it interactive and route it to the collab workflow). Interactive and status elements must not share a costume.

### 3. Attention model: color/animation-only, hard truncation 🔴

- The seven-state attention model is the app's core promise ("see who needs you at a glance") and its motion hierarchy is genuinely good (quiet dot → breathing → pulsing ring). But state is encoded by color/animation alone, and sidebar task text truncates hard ("Refine demo recording … ", "stale: qu…") with no tooltip.
- **Recommendation:** tooltips with full task text on all truncated sidebar rows; add a text label or distinct shape for `actionRequired` — the one state that must never be missed, including by colorblind users.

### 4. Chrome vs. PTY color separation 🟡

- The app's chrome accent (histogram bars, collab warning, Claude badge) shares the amber band with Claude's own ANSI output and provider accents. Frame and content speak the same color language, so app-level warnings can visually merge with agent output.
- **Recommendation:** reserve one hue for app-level status that is never used by provider badges or terminal ANSI mapping. Per-provider accent tokens already exist, so this is a cheap token-level change.

### 5. Telemetry chip discoverability 🟡

- The token/cost chip ("444.3M ~$4813") already has a popover and W/M range toggle, but nothing signals interactivity — the chevron reads as noise at ~10px, and the cost figure (real money) is the smallest text on screen.
- **Recommendation:** hover state, larger hit area, slightly larger cost text. Consider a labeled form ("$4,813 / mo") in the chip.

### 6. No settings surface 🟡

- Only setting is the theme picker (4 themes) in the sidebar footer. Users will want knobs that already exist implicitly: terminal font size, layout presets, telemetry range, collab defaults.
- **Recommendation:** minimal preferences panel now, so future knobs have a home instead of being invented ad hoc.

### 7. Empty-workspace repetition 🟢

- "Open this workspace to load its worktree sessions" appears verbatim for every unloaded workspace (3× in one screenshot). Instructional noise; the text is also not actionable.
- **Recommendation:** collapse unloaded workspaces to a single-line row with a load affordance (click row or a small button); keep the explanatory sentence for hover/first-run only.

### 8. Redundant "clean" badges 🟢

- "clean" appears in both the session header (git status) and the REVIEW bar (review state) with identical styling and no source labeling.
- **Recommendation:** differentiate visually or label the source (e.g. `git: clean` vs `review: clean`).

### 9. Secondary-text contrast 🟢

- Dimmed sidebar metadata (timestamps, "stale:" labels, session paths) appears below WCAG AA 4.5:1 against the dark background across themes. Verify tokens per theme; small dense text needs the contrast most.

## Engineering-Side Risk (not user-facing)

- `src/app/shell.css` is 6,106 lines across 4 themes (dark/light/warm/tui, oklch tokens). At that size, theme drift is a when, not an if. Consider splitting per-surface and adding a token-lint pass to CI.

## What Works Well — Keep

- Attention-state motion hierarchy maps urgency to animation correctly (8s rotation for activity, pulse for actionRequired).
- SF Mono chrome vs. Meslo terminal: subtle, effective frame-vs-content distinction.
- Chrome and terminal ANSI palettes are theme-coordinated — rare and worth preserving (modulo finding #4).
- Review-in-window flow with SDD / round chips in the sidebar surfaces workflow state without leaving the tree.
- Density is appropriate for the audience; don't soften it — make it legible.

## Out of Scope (CLI-owned, do not fix here)

- User/agent message differentiation inside panes, `ctrl+o` expansion hints, the bypass-permissions status line, in-CLI task checklists — all rendered by the agent CLIs themselves.

## Suggested Order of Work

1. Terminal font size setting + optional measure cap (#1)
2. Launcher row affordance + collab status chip split (#2)
3. Sidebar tooltips + non-color actionRequired signal (#3)
4. App-status hue reservation (#4) and telemetry chip polish (#5)
5. Settings panel scaffold (#6), then sweep #7–#9
