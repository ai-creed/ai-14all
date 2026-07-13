# Spec: Sidebar Status Legibility — Attention Model, Workflow Card, Density & Collapsed Rollup

**Status:** Design approved (2026-07-01) via interactive brainstorming with the user
(four annotated screenshots + Q&A). Not yet implemented.

**Scope:** The left **Workspace** sidebar only. Four coupled refinements:
1. Re-parent the "Last workflow" card so it reads as belonging to its worktree (item 1).
2. Cut worktree-list density via spacing, text trimming, and a process rollup (item 2).
3. Replace the current attention heuristic with an explicit **three-tier model** and fix a
   false-positive red border on idle/done worktrees (item 3 — bug + design).
4. Give **collapsed** workspace rows an at-a-glance summary: session count + attention dot (item 4).

**Non-goals:** The plugin/onboarding dialogs (`AgentInstallModal`, `PluginsPanelDialog`) — those
are **Spec B**. No change to how agents *report* status (MCP `report_session_status`, terminal
classifiers, whisper drivers); this spec only changes how reported status is **interpreted and
displayed**.

**Related prior work:** `2026-05-15-agent-attention-truthfulness-design.md` (attention sourcing),
`2026-06-24-workspace-panel-rework-design.md` (the git-tree sidebar this builds on),
`2026-06-26-ui-ux-hardening-slice-1/2-design.md` (the hardening series this continues).

---

## 1. Goal & context

The workspace-panel rework gave us a git-tree sidebar (repo → worktree rows on a rail, with
nested session/process rows and an optional "Last workflow" card). In daily use four legibility
problems surfaced:

- The **"Last workflow" card** renders as the last child inside `.shell-sidebar__row` with a
  `margin-top` but **no `margin-bottom`**, so it sits flush against the next worktree and reads as a
  floating block wedged *between* worktrees rather than belonging to one.
- The worktree list is **too dense**: tight vertical rhythm plus long, repeated `user@host:~/path …
  quiet for Ns` subtitles and up to three always-visible process rows per worktree.
- The **attention highlight lies**: a worktree showed the red "action required" ring while every
  nested session was idle/stale and its workflow was *done*. The red traces to a lingering session
  `mcp: waiting` reason that no terminal event retires — the render path applies no recency/clear
  gating to the session reason, and a cross-source `workflow: done` cannot supersede it (see §4.2).
- A **collapsed** workspace row shows only a chevron + icon + initial — you cannot tell how many
  sessions are inside or whether any needs you without expanding it.

All four live in the same files (`SessionSidebar.tsx`, `shell.css`, `tokens.css`, and the
attention-derivation logic under `src/features/workspace/logic/`), and item 4's rollup depends on
item 3's model, so they ship as one spec.

## 2. Current state → gap

| Area | Today | Target |
|---|---|---|
| Workflow card | Last child of `.shell-sidebar__row`; `margin-top: --space-2`, no bottom margin; full-width, same indent as worktree (`WorkflowRow.tsx`, `shell.css:4263`) | Indented under the owning worktree on the tree rail, lighter weight, real bottom margin |
| Attention (ring) | Render path `buildWorktreeAttentionDisplay`: session `mcp` reason mapped **directly** (no recency/clear gating) vs top process; `workflow`/`lifecycle` session sources ignored; a cross-source terminal signal cannot retire a stale `mcp: waiting` | Explicit **three tiers**: action-required (red) / ready (quiet dot) / calm; terminal events retire stale `waiting`/`failed` across sources |
| Done state | Maps to `idle` — invisible | New **ready** tier: a quiet, non-red dot ("come look, it's finished") |
| Active ring | Rotating amber conic ring + pulse (`shell.css:898-946`) | Same meaning, **calmer** motion/intensity |
| Worktree density | Tight rhythm; full `user@host:~/path … quiet for Ns` subtitle; up to 3 process rows + overflow | More gap + grouping; trimmed/relative subtitle; top process + "N more ›" inline-expand rollup |
| Collapsed workspace row | Chevron + git icon + initial only (`SessionSidebar.tsx:186-201`) | Adds right-aligned **session count + rolled-up attention dot** |

## 3. Design decisions

| # | Decision | Rationale / source |
|---|----------|--------------------|
| D1 | **Three-tier attention model**: action-required (red), ready (quiet dot), calm | User choice over two-tier-strict and "red-includes-done". Maps intent to signal honestly. |
| D2 | **Terminal events clear stale `waiting`/`failed` reasons** | Root-cause fix for the false-positive red. Done/exit must not stay red. |
| D3 | **Active ring kept but calmer** (reduced motion/intensity) | User choice. Keep the "working" signal; lower the sidebar noise. |
| D4 | **Ready tier = quiet dot only** (no row tint) | User choice over dot+tint. Never competes with the red ring. |
| D5 | **Workflow card nests under its worktree** (indent + rail elbow + lighter weight + bottom margin) | User choice over condense-to-one-line and hover/detail. Keeps glanceability, fixes the wedge. |
| D6 | **Density = breathing room + trim** (spacing + shortened subtitle + process rollup) | User choice over spacing-only and collapse-sessions-by-default. |
| D7 | **Process rollup expands inline on click**, state remembered per worktree | User choice over hover-popover and always-show-all. |
| D8 | **Collapsed workspace row = session count + one attention dot** (no separate "working" indicator) | User choice over count+dot+working and dot-only. |
| D9 | New `--ready` color token, defined once per theme | The ready dot needs a calm accent distinct from `--danger` (red) and `--warning` (amber). |

## 4. Attention model (item 3) — the foundation

### 4.1 Tiers

A single derivation maps every status source to one of three **display tiers**, surfaced via the
`data-attention` attribute on `.shell-sidebar__row` and reused by the workflow card dot (§5) and the
collapsed rollup (§7):

| Tier | `data-attention` | Triggers | Visual |
|---|---|---|---|
| Action required | `actionRequired` | agent `waiting` (needs input) or `failed`; whisper escalation or halted workflow | red ring + glow (existing `shell.css:947-986`) |
| Ready *(new)* | `ready` | task/workflow `done` and awaiting user review (agent lifecycle `ready`, workflow `done`) | quiet `--ready` dot on the row/card; **no ring, no tint** |
| Calm | `activity` / `idle` | `active` → `activity` (calmer ring, D3); `stale`/`idle` → `idle` (nothing) | calmer amber ring for activity; nothing for idle |

The sidebar ring is driven at render time by `buildWorktreeAttentionDisplay`
(`src/features/workspace/logic/sidebar-shell-summary.ts:204`), reduced into `attentionByWorktreeId`
and the `data-attention` attribute in `App.tsx:1945-1954`. Today that function takes the
higher-severity of two inputs: the session's **`mcp`** reason (mapped *directly* — no recency,
staleness, or clear gating — and ignoring the `workflow`/`lifecycle`/`terminal` session sources) and
the top process row (`processSummary.topRow`, which already runs `rankAgentAttention` + `deriveStale`).
A separate stored value, `session.attentionState`, is recomputed by `recalculateWorktreeAttention`
(`workspace-state.ts:347`) from process states only; it does **not** drive the ring and is out of
scope except where noted. This spec changes the render-time path to emit three tiers (adding `ready`,
which today collapses into `idle`) and to gate stale action-required reasons (§4.2). The
`AgentAttentionState` rank ladder in `shared/models/agent-attention.ts` is unchanged.

### 4.2 The false-red bug & the clearing contract (D2)

**Verified root cause.** The MYSTIQUE red comes through the **session `mcp` path**, not the process
rank path. `buildWorktreeAttentionDisplay` maps `session.agentAttentionReasons.mcp.state` straight to
a sidebar state with no recency, staleness, or clear gating — so a stale `mcp: waiting` (an answered
prompt that never decayed) stays red indefinitely. A finished workflow cannot rescue it: the workflow
signal is a *different* source (`workflow`), and (a) `buildWorktreeAttentionDisplay` ignores session
sources other than `mcp`, and (b) `shouldReplaceAgentAttentionReason`
(`src/features/terminals/logic/agent-attention.ts:173`) only lets an authoritative reason overwrite
**its own source**; a cross-source `workflow: ready` (rank 3) loses the rank gate to a lingering
`mcp: waiting` (rank 5) and never replaces it. The existing retirement helper doesn't cover this case
either: `clearStaleTerminalReasonsForSessionProcesses` (`workspace-state.ts:367`) only drops the
per-process `terminal` classifier reason, and the `mcp`-non-failed self-report that triggers it
requires the agent to *send* a fresh non-failed mcp push — which a gone-quiet agent never does.

**Required behavior (the contract — independent of mechanism):**
- A worktree is `actionRequired` **only** while a *current* `waiting`/`failed` is in effect. A stale
  one (quiet past `STALE_THRESHOLD_MS`, or superseded by a later terminal event) must not keep it red.
- A **terminal event** — agent mcp `ready`/`done`, workflow `done` (`workflow-lens.ts:92`), or process
  exit — must retire older `waiting`/`failed` **across sources** for that worktree, after which the
  worktree resolves to `ready` (if a done/awaiting-review signal is current) or `idle`.
- A genuinely fresh `waiting`/`failed` (reported after the last terminal event) still wins → red.

**Named gaps the implementation must close** (the implementation plan picks the exact mechanism; both
render-path and state changes are in scope — §9 fixes the behavior either must satisfy):
1. **Render path:** `buildWorktreeAttentionDisplay` must consider the authoritative session sources the
   tiers need (`mcp` **and** `workflow`) and apply recency/clear + staleness gating, instead of a raw
   direct map of `mcp`. It must be able to emit `ready`.
2. **Cross-source terminal clearing** needs a state mechanism that does not exist today. Two viable
   shapes: (a) add a session-level clear timestamp to `WorktreeSession` (mirroring
   `ProcessSession.agentAttentionClearedAt`), advance it on terminal events, and gate session
   `waiting`/`failed` by it; or (b) extend the reducer's terminal handling to drop cross-source stale
   action-required reasons at session scope — a session-scoped, cross-source analogue of
   `clearStaleTerminalReasonsForSessionProcesses`. Pick one in the plan.
3. **Process path consistency:** `deriveStale` already gates staleness via
   `ProcessSession.agentAttentionClearedAt`; extend the same gating so a process `waiting`/`failed` is
   retired on terminal/exit, keeping process- and session-level behavior consistent.

### 4.3 Active ring calming (D3)

Keep `data-attention="activity"` for actively-working worktrees but retune the
`shell-sidebar-attention-rotate` / `-pulse` animations (`shell.css:898-946`): slower or no rotation,
lower opacity, gentler pulse. Semantics unchanged.

## 5. Workflow card nesting (item 1, D5)

Re-parent the `WorkflowRow` (`WorkflowRow.tsx`, instantiated `SessionSidebar.tsx:430-439`) so it
hangs off the worktree's tree rail like a nested child rather than a flush full-width block:

- Indent to align under the worktree's nested-session column; attach a rail elbow/connector.
- Lighter visual weight than a worktree row (smaller, more muted chrome).
- Add a real **bottom margin** (`--space-2`/`--space-3`) so it never bleeds into the next worktree.
- The status badge adopts the §4 tiers: a `done` workflow shows the quiet `--ready` dot (D4), not a
  treatment that reads as alarming.

No content is removed — type badge, artifact filename, phase/round line, and daemon line all stay.

## 6. Density & trim (item 2, D6/D7)

- **Spacing:** increase vertical gap *between* worktrees and tighten the grouping of a worktree with
  its own sessions, so the eye reads worktree-clusters rather than a flat dense list. Tune via
  `--space-*` in `shell.css` (sidebar block ~535-1200) — no new tokens.
- **Subtitle trim:** de-emphasize and shorten the `user@host:~/path … quiet for Ns` line — relative
  duration (`quiet 3m`, `quiet 5h`) instead of raw seconds; full path/host available via `title`
  attribute on hover.
- **Process rollup (D7):** by default render only the top/most-severe process
  (`WorktreeProcessSummary.topRow`) plus a compact **"N more ›"** affordance. Clicking expands the
  full process list inline within that worktree; the expanded/collapsed choice is **remembered per
  worktree** (localStorage, mirroring `use-collapsed-workspaces.ts`).

## 7. Collapsed workspace rollup (item 4, D8)

The collapsed workspace header (`SessionSidebar.tsx:186-201`) gains a right-aligned summary:

- **Session count** — total sessions across the workspace's worktrees.
- **One rolled-up attention dot** — the highest §4 tier across the workspace's worktrees
  (`Math.max` over the relevant `attentionByWorktreeId` entries): red dot if any worktree is
  `actionRequired`; else the quiet `--ready` dot if any is `ready`; else **nothing**.
- No separate "working" indicator (D8) — `activity` does not produce a collapsed dot; the count
  already signals presence.

The rollup is computed once per workspace alongside `attentionByWorktreeId` (in `App.tsx` or a small
selector) and passed to the collapsed header.

## 8. Data model & files touched

**Logic**
- `src/features/workspace/logic/sidebar-shell-summary.ts` — `buildWorktreeAttentionDisplay` (:204):
  consider session `mcp` **and** `workflow` sources with recency/clear + staleness gating; emit the
  three tiers including `ready`.
- `src/features/workspace/logic/workspace-state.ts` — carries the clearing mechanism (§4.2 gap 2):
  `session/reportAgentAttention` (:1153) and the clear actions (:1245+), plus
  `recalculateWorktreeAttention` (:347) if the stored `session.attentionState` is folded into the
  tiers. `shouldReplaceAgentAttentionReason`'s cross-source rank gate is the specific blocker.
- `src/features/terminals/logic/agent-attention.ts` — `deriveStale` (:157) +
  `ProcessSession.agentAttentionClearedAt` already gate process staleness; extend to retire process
  `waiting`/`failed` on terminal/exit. `AgentAttentionState` + `AGENT_ATTENTION_RANK`
  (`shared/models/agent-attention.ts`) already include `ready` — no new state there.
- `src/features/workflows/logic/workflow-lens.ts` — `done` already emits a `ready` workflow reason
  (:92); ensure it reaches the render path and triggers the cross-source terminal clear.
- `src/app/App.tsx` (~1945-1954) — extend the `attentionByWorktreeId` reduction to carry `ready`;
  compute the per-workspace rollup (§7).

**View**
- `src/features/workspace/components/SessionSidebar.tsx` — card nesting (§5), process rollup (§6),
  collapsed-row count + dot (§7).
- `src/features/workflows/components/WorkflowRow.tsx` — dot tiers (§4/§5).
- new/extended per-worktree "process expanded" persistence hook (mirror `use-collapsed-workspaces.ts`).

**Style/tokens**
- `src/app/shell.css` — card indent/elbow/bottom-margin; `[data-attention="ready"]` quiet dot;
  active-ring calming; spacing tweaks; collapsed-row summary.
- `src/styles/tokens.css` — new `--ready` token per theme.

**Type touch points**
- `SidebarShellState` (`sidebar-shell-summary.ts:12`, today `actionRequired|active|idle|exited`) and
  the worktree display state gain a `ready` value; `App.tsx`'s `attentionByWorktreeId` and the
  `data-attention` attribute gain `ready`. `ProcessAttentionState`
  (`shared/models/process-session.ts:7`, raw per-process input) stays `idle|activity|actionRequired`
  — `ready` is a *derived* tier, not a raw process state.
- If §4.2 gap 2 approach (a) is chosen, `WorktreeSession` (`shared/models/worktree-session.ts`) gains
  `agentAttentionClearedAt: number | null` (today only `ProcessSession` has it) plus the reducer
  action that advances it.

## 9. Testing & edge cases

Following TDD: write the repro test first for the bug, then implement.

- **Bug repro (must fail first):** a worktree whose session holds a stale `mcp: waiting` **and** a
  `workflow: done` (or any terminal event after the waiting's `reportedAt`) resolves to **not**
  `actionRequired` via `buildWorktreeAttentionDisplay` / the reducer.
- **Cross-source clear:** a terminal `workflow done` retires a stale `mcp: waiting` — the case
  `shouldReplaceAgentAttentionReason`'s cross-source rank gate blocks today.
- **Ready tier:** a done workflow with no current `waiting`/`failed` → `ready` (quiet dot), not `idle`,
  not red; `buildWorktreeAttentionDisplay` returns the `ready` state.
- **Still-red:** a *fresh* `mcp: waiting` (reportedAt after the last terminal event) correctly stays red.
- **Process path:** a process `waiting` then exit → not `actionRequired`; staleness past
  `STALE_THRESHOLD_MS` no longer red.
- **Active calming:** `active` remains `activity`; animation change is purely visual (assert
  attribute unchanged).
- **Rollup:** empty workspace → count 0, no dot; mixed nested tiers → highest severity wins; collapsed
  vs expanded show consistent attention.
- **Density/trim:** very long path; missing path; relative `quiet` formatting at `<60s`, minutes, and
  hours; process rollup with 0 / 1 / many processes; expanded state persists across remount.

Existing tests to extend: `tests/unit/workspace/sidebar-shell-summary.test.ts`,
`tests/unit/workspace/workspace-state.test.ts` (reducer clearing),
`tests/unit/terminals/agent-attention.test.ts`, `tests/unit/workflows/workflow-lens.test.ts`,
`tests/unit/workflows/WorkflowRow.test.tsx`, `tests/unit/workspace/SessionSidebar.test.tsx`,
`tests/unit/workspace/use-collapsed-workspaces.test.ts`, `tests/unit/styles/workspace-tokens.test.ts`,
`tests/e2e/session-attention.spec.ts`, `tests/e2e/plugins-whisper.test.ts`.

## 10. Out of scope / follow-ups

- **Spec B** — plugin/onboarding dialogs: skills installer discoverability + auto-show-on-launch +
  rewording (item 5), and the Plugins dialog collapsible Agent CLIs section + plugin copy rewrite
  (item 6).
- No change to status *reporting* contracts; no change to theming beyond the one `--ready` token.
