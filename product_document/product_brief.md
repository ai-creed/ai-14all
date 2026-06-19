# ai-14all — Product Brief

> **About this document.** This brief was assembled by reading the repository directly:
> `README.md`, `AGENTS.md`, `package.json`, the planning docs under `docs/shared/`
> (`project_ai_14all_spike.md`, `high_level_plan.md`, `architecture_decisions.md`),
> the design specs under `docs/superpowers/specs/`, `CHANGELOG.md`, `KNOWN-ISSUES.md`,
> the shared contracts/models under `shared/`, and the `services/` and `src/features/`
> source trees. It reflects the codebase at **version 0.9.2** (latest CHANGELOG entry
> dated 2026-06-15). Statements here are grounded in those sources; nothing is invented.
> Where the shipped code diverges from earlier planning intent, that is called out.

---

## 1. One-line summary

ai-14all is a **mission-control desktop app for running AI coding agents in parallel
across Git worktrees** — each agent session pinned to its own worktree, branch, and
terminal, with at-a-glance attention tracking and lightweight in-window code review.

(Source: `README.md`, `package.json` `description`.)

## 2. What the product is

ai-14all is an **Electron desktop application** (macOS, Apple Silicon only today) that
acts as a local control panel for **worktree-based development sessions**. Its purpose
is to let an engineer fan a task out to several coding-agent CLIs (Claude, Codex, and
others) at once — each isolated in its own Git worktree and branch, running in a real
terminal — and keep all of them straight from one window: see which agent needs
attention, and review/keep/discard their work without switching to a separate IDE.

The framing the project uses for itself is **"supervised parallelism, not a swarm"**:
each session is a real Git worktree with a real PTY-backed terminal; the terminals are
the source of truth and the agents run as ordinary CLIs inside them. The app's job is
orchestration and review — the user stays the gatekeeper, and nothing merges or ships
without them. (Source: `README.md` "Core concepts".)

## 3. The problem it solves

The product starts from a concrete local-development pain point (documented in
`docs/shared/project_ai_14all_spike.md`): when working on multiple features in
parallel, a developer ends up juggling multiple Git worktrees, multiple terminal
windows/tabs, multiple coding-agent sessions, multiple long-running scripts (dev
servers, test runners), and multiple editor windows. The friction is not writing code —
it is **coordinating parallel work cleanly** across all those scattered surfaces.

ai-14all is designed to collapse that fragmentation into one session-first window so the
user can:

- see all active worktrees in one place,
- switch across them quickly,
- run and monitor multiple processes per worktree,
- inspect code and Git state without leaving the app,
- reduce dependence on scattered terminal and editor windows.

## 4. Who it is for (and not for)

**For** (per `README.md`): engineers who already run coding agents and want to run
several at once with structure around them — people who fan work out to multiple agents,
work terminal-first (real shells, not a web UI), want at-a-glance per-agent status, and
want quick diff review in the same window.

**Not for:**
- single-agent, one-off prompting (just run the agent CLI directly);
- a full IDE replacement (ai-14all orchestrates and reviews; it is not an editor);
- Intel Macs or Windows — Apple Silicon (arm64) only today.

## 5. Core mental model

The central object is the **worktree session**. A worktree session represents one active
branch/task and is the container for:

- repository and branch metadata,
- one or more terminal-backed process sessions,
- lightweight Git context,
- recent files and code-inspection state,
- notes and labels.

The UX is deliberately **session-first, not dashboard-first**: the app optimizes for fast
switching between active worktree sessions over a broad project overview. The recorded
architecture decisions (`architecture_decisions.md`, AD-006) make this a hard rule — the
frontend state model is built around the selected worktree session, not around files or
standalone terminals.

A key design choice (spike doc, "Agent Support In MVP"): an **agent is not a special
protocol** — it is just a terminal-backed process running inside a worktree (`codex`,
`claude`, `aider`, `npm run dev`, `pnpm test` are all the same abstraction). Agent-specific
intelligence is layered on top of that durable terminal/process model rather than baked in.

## 6. Core capabilities

These are the capabilities that actually exist in the codebase (cross-referenced against
`src/features/`, `services/`, and the CHANGELOG):

### 6.1 Session-per-worktree isolation
Creating a session names a branch, creates a fresh Git worktree, and pins a shell to that
checkout, so parallel agents never touch each other's files. Worktrees can be **created and
removed from inside the app** (sidebar flow). (`services/worktrees/`,
`src/features/workspace/` — `NewWorktreeDialog`, `RemoveWorktreeDialog`.)

### 6.2 Terminal-first workspace
Real PTY shells via `node-pty`, rendered with `xterm.js`. Multiple terminals per worktree
organized in a **slot-based multi-pane layout (1–6 slots)** with selectable presets,
find-in-terminal, theme-aware rendering, and font sizing that adapts to slot count. Output
is batched (~16ms windows) for responsiveness, and buffered output is replayed into remounted
panes. An **agent-launcher bar** offers one-click launch of recognized agents (Claude, Codex,
Ezio); any CLI can also just be typed. (`services/terminals/`, `src/features/terminals/`.)

### 6.3 Agent attention model
The sidebar tracks each agent's state and rolls it up per session, so fanning out across
several agents never loses track of who needs what. Attention states are
`waiting | failed | ready | stale | active | idle`, ranked so the most urgent dominates the
rollup, and attributed to a source (`mcp | terminal | lifecycle | workflow`). Two distinct
UI signals exist by design (AD-011): a **temporary pulse** for ordinary new output and a
**persistent stronger state** for action-required prompts (e.g. an agent asking permission
or waiting on a choice). Agents can **report their own status and current task** over a
built-in MCP server, rather than the app only guessing from terminal output.
(`shared/models/agent-attention.ts`, `services/mcp/`, `src/features/workspace/`.)

### 6.4 Built-in MCP server (agent ↔ app bridge)
ai-14all runs a local MCP (Model Context Protocol) server (`services/mcp/ai14all-mcp-server.ts`)
exposing three tool families to agents running in its terminals:
- **review comments** — list comments and mark them addressed,
- **session notes** — read and append the user's per-worktree markdown notes,
- **session status** — report active/waiting/ready/failed, which drives the attention UI.

This is the "agent-pull" surface called out in `AGENTS.md`: the app exposes local tools that
the agent calls; it does **not** push to vendor APIs.

### 6.5 Lightweight in-window code review
Inspect changed files, browse the full file tree, view file contents and diffs in a
**read-only Monaco viewer**, author **inline diff comments** (with an addressed/draft/open
status model and a review queue grouped by file), and walk commit history on demand — then
keep or discard the agent's work without opening a separate IDE. Review modes are
**Changes** (working tree), **Commits** (by SHA), and **Files**. Discard and force-push are
gated behind confirmation dialogs. (`services/review/`, `services/git/`,
`src/features/review/`, `src/features/git/`, `src/features/viewer/`.)

### 6.6 Lightweight Git surface
Intentionally small (spike doc "Git Surface For V1"): branch, dirty/clean state, changed-files
count and list, recent commits, and remote ahead/behind status — enough for session awareness
without becoming a full Git client. (`services/git/`, `shared/models/git-*.ts`.)

### 6.7 Token telemetry
Per-agent token usage for Claude and Codex, surfaced live, with a usage dashboard covering
input/output/weekly-billable tokens grouped by workspace/worktree/agent, account-limit gauges
(5-hour and weekly windows), and editable budgets. The usage layer parses agent session JSONL
logs incrementally and knows Claude plan tiers (e.g. Pro, Max-5x, Max-20x) with a fixed weekly
reset anchor. (`services/usage/`, `src/features/telemetry/`,
`docs/.../2026-05-27-token-telemetry-design.md`.)

### 6.8 Per-session notes
Markdown notes pinned to a worktree session, editable in a note sheet and also
readable/appendable by agents through the MCP note bridge.
(`services/mcp/session-note-bridge.ts`, `src/features/workspace/` NoteSheet.)

### 6.9 Multi-workspace, fast switching
Several repository-scoped workspaces can be registered in one window, with one active at a
time; background terminals keep running while another workspace is foregrounded. Worktrees,
sessions, layout, notes, recent files, and presets persist across restarts, with a
user-controlled restore prompt on reopen. (`services/workspace/`, `src/features/workspace/`,
`src/features/repository/` RestorePrompt.)

### 6.10 Code navigation (power feature, plugin-gated)
Go-to-definition, find-references, symbol search (`Cmd+T`), and peek inside the Monaco
viewers — backed by an **ai-cortex SQLite index** for the worktree. When no cortex index
exists (or the CLI isn't installed) these features are disabled gracefully rather than
erroring. (`electron/code-nav/`, `src/features/code-nav/`, `KNOWN-ISSUES.md`.)

### 6.11 Auto-update
The app checks for updates on launch, downloads newer stable versions in the background, and
prompts Restart now / Later (via `electron-updater`). Update artifacts are verifiable against a
published `latest-mac.yml` sha512 manifest. (`README.md`, `electron/main/services/update-service.ts`,
`src/features/updater/`.)

## 7. Ecosystem plugin framework

ai-14all has an **opt-in ecosystem plugin framework** (AD-012,
`2026-06-12-ecosystem-plugin-framework-whisper-driver-design.md`) for integrating peer apps as
in-process drivers. Design principles: a static driver registry (no dynamic loader / supply-chain
risk), a TOML switchboard at `userData/config.toml`, cached non-blocking capability probes,
**read-only** access to peer data, commands routed through the peer's own CLI with a JSONL audit
log, renderer surfaces exposed only via typed IPC, and strict fault isolation (a driver may only
ever degrade itself). Users who don't opt in see no change. Two drivers exist today:

- **ai-whisper** — a live "workflow lens": surfaces an external agent-orchestration workflow's
  status, phases, rounds, artifacts, escalations, and agent handoffs in the sidebar and a detail
  modal, with audit-logged commands. (`services/plugins/whisper/`, `src/features/workflows/`.)
- **ai-cortex** — a memory layer agents recall from and record to across sessions, whose index
  also powers the code-navigation features above. A "Configure ai-cortex" action registers the
  MCP server for installed agent CLIs and installs its capture hooks / memory prompt guide.
  (`services/plugins/cortex/`, `electron/code-nav/`.)

The plugins panel detects installed agent CLIs (claude, codex, ezio) and shows per-plugin status
(`not-installed | installed-off | on-healthy | degraded | incompatible`), including a "degraded"
state with a re-probe action so a present-but-unusable peer never shows a misleading Install button.

## 8. Architecture

The app is split into four layers with strict boundaries (spike doc "Architecture Direction",
`architecture_decisions.md` AD-001..AD-005, `AGENTS.md`):

1. **Frontend UI** (`src/`) — React 19 + TypeScript. Unprivileged renderer: renders UI, holds
   view state, dispatches typed commands, consumes typed events. **Never** touches Node APIs,
   spawns processes, shells out to Git, or reads the filesystem directly. Organized
   feature-first (`src/features/<domain>/components|hooks|logic`).
2. **Desktop bridge** (`electron/main`, `electron/preload`) — thin Electron shell: window
   lifecycle, secure preload bridge, and a **narrow, domain-grouped typed IPC contract** (not a
   generic message bus). IPC handlers accept opaque identifiers (`workspaceId`, `worktreeId`) and
   resolve filesystem paths server-side — raw renderer paths are forbidden except on explicit
   MCP agent-pull tool surfaces.
3. **Local orchestration services** (`services/`) — the durable product logic: worktree/repo
   discovery, PTY/process lifecycle, Git, file I/O, persistence, usage tracking, MCP server,
   plugins, review storage, diagnostics. Backend logic lives here, **not** in Electron main and
   **not** in React components.
4. **Shared contracts & models** (`shared/`) — the canonical vocabulary: command/event schemas
   (validated with `zod`) and domain models shared across renderer and backend, preventing drift.

### Services inventory (`services/`)
`diagnostics` (JSONL logging of attention/terminal/plugin events, off/sampled/full modes),
`files` (file I/O, listing, binary/size guards), `git` (commands, diffs, summaries, remote
status, with byte caps and structured error classification), `mcp` (the MCP server + note and
attention IPC bridges), `plugins` (registry, capability probes, TOML config, whisper & cortex
drivers), `review` (comment service + JSON store), `terminals` (PTY lifecycle + output batching),
`usage` (token aggregation, JSONL scanning, budgets/tiers), `workspace` (repository registry +
state persistence with V1→V2 migration and atomic writes), `worktrees` (worktree
create/remove/list + porcelain parsing).

### Security & privacy posture
Renderer stays unprivileged; all privileged work flows through preload + typed IPC; main stays
thin. **No network telemetry is collected** — local logs are written to `~/Library/Logs/ai-14all/`
(`KNOWN-ISSUES.md`). The app is signed and notarized, and terminals work under the macOS hardened
runtime.

## 9. Tech stack

(From `package.json` and the spike doc.)

- **Desktop runtime:** Electron 41 (chosen over Tauri for V1 because the hardest risks are
  PTY/process orchestration, where `node-pty` fits the Node runtime naturally — AD-001).
- **Build/tooling:** electron-vite, Vite 6, TypeScript, ESLint, Prettier; pnpm; Node 24+.
- **Frontend:** React 19, Radix UI primitives, TanStack Virtual; Monaco editor
  (`@monaco-editor/react`) for read-only viewing/diffs; `react-markdown` + `remark-gfm` +
  `rehype-highlight`/`highlight.js` for Markdown preview.
- **Terminal:** `xterm.js` (+ fit/search addons) and `node-pty`.
- **Contracts/validation:** `zod`.
- **MCP:** `@modelcontextprotocol/sdk`.
- **Persistence:** JSON files for workspace/review/notes state; `better-sqlite3` is a dependency
  and SQLite backs the ai-cortex code-navigation index. Config for plugins is TOML
  (`smol-toml` / `js-yaml` present). *(Note: earlier planning favored Zustand for state, but the
  shipped renderer centralizes state in a large reducer — `src/features/workspace/logic/workspace-state.ts`
  — plus hooks; `zustand` is not a dependency.)*
- **Updates:** `electron-updater`.
- **Testing:** Vitest (unit + perf) and Playwright (e2e); e2e coverage is required to accumulate
  per phase (`AGENTS.md`, `high_level_plan.md`).

## 10. Domain model

Core entities (spike doc "Core Domain Model", `shared/models/`): `Repository`, `Worktree`,
`WorktreeSession`, `ProcessSession`, `FileViewState`. Principle: **a worktree owns its process
sessions**, and process sessions span agent-like and non-agent commands alike, so the UI needs no
special model just for agents. Workspace runtime state, IPC, and persistence are scoped by
`workspaceId` (AD-007). Recognized agent providers in code are `claude`, `codex`, `ezio`, and
`other`; per the README, Claude and Codex are the ones detected, badged, and token-tracked today,
while any CLI can run in a session.

## 11. Scope & non-goals

The product is explicitly **not** trying to be a full IDE. Recorded non-goals / deferred scope
(spike doc, `high_level_plan.md`, `AGENTS.md`):

- not a replacement for VS Code / Cursor / a full editor;
- no full LSP / general code intelligence beyond the plugin-gated cortex navigation;
- no deep vendor-specific agent-API integration (agent handoff is pull-based via local MCP tools);
- no multi-worktree comparison dashboards;
- no advanced Git operations (merge/rebase/conflict tooling) beyond lightweight review;
- the embedded viewer is review-oriented and read-only inline — editing is a narrow, whitelist-gated,
  explicit-save modal for agent-authored and small config files (AD-010 update, lightweight-editor spec),
  **not** IDE editing (no multi-file tabs, project-wide find/replace, refactors, live file-watching);
- no collaboration / cloud sync; no remote environments;
- no Windows/Intel-Mac polish before the macOS Apple-Silicon workflow is solid;
- V1 restores workspace *context*, not live PTY processes across cold starts (live PTY
  reattachment is supported only for renderer reloads while the main process survives — AD-009 update).

## 12. Platform, licensing & distribution

- **Platform:** macOS on Apple Silicon (arm64) only; no Intel build ships (`KNOWN-ISSUES.md`, tracked #9).
- **Distribution:** signed + notarized DMG from GitHub Releases; drag-to-`/Applications`, no
  Gatekeeper workaround; background auto-update with sha512-verifiable manifest.
- **License:** Functional Source License 1.1 with Apache-2.0 future grant (`FSL-1.1-ALv2`) —
  source-available (not OSI open source); usable/modifiable/redistributable except for a
  "Competing Use," and each version converts to Apache 2.0 two years after release. Contributors
  must sign a CLA (the project may offer commercial editions).
- **Ownership:** authored by Vu Phan; project home `https://ai-creed.dev/projects/ai-14all/`,
  repo `github.com/ai-creed/ai-14all`.

## 13. Maturity & status

Young but actively developed. First stable release **0.1.0 on 2026-04-24**; the codebase is at
**0.9.2 (2026-06-15)** after ~19 releases in under two months. The `high_level_plan.md` marks the
core MVP through Phase 6 ("Personal MVP Hardening") as **beta-ready**, with Phase 7 (workspace
expansion, worktree lifecycle, split-shell, multi-workspace) delivered. Recent releases (0.6–0.9)
have layered on token telemetry, code navigation, and the ecosystem-plugin framework
(ai-whisper, then ai-cortex) on top of the proven terminal/review core. Delivery follows an
explicit phased, validation-gated rhythm: ship a thin slice, use it on a real worktree, record
friction, refine — with the stated product risk being "building a polished shell around the wrong
session workflow."

## 14. Known limitations (current)

(From `KNOWN-ISSUES.md`.)
- Apple Silicon only — no Intel build.
- Symbol search / go-to-definition / peek require an ai-cortex index for the worktree; without it
  (or without the cortex CLI), those features are disabled (the rest of the app works normally).
- Local logs live at `~/Library/Logs/ai-14all/`; no network telemetry is collected.
