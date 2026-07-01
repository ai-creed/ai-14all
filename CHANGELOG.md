# Changelog

All notable changes to ai-14all are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] – 2026-07-01

The 1.0 milestone: ai-14all graduates from the 0.x line to its first major version. This release is dominated by a workspace-sidebar rework, a light/dark/warm theme overhaul, and the adoption of the aicreed brand mark.

### Added

- **A redesigned workspace sidebar built around a git-tree rail.** Repositories are now collapsible groups with a git-branch glyph and a persisted expand/collapse state, and worktrees and workspaces read as a clear type ladder. A slim mini-rail keeps the tree legible when the panel is collapsed, collapsed workspace rows show a session count and an attention dot, and the global footer gains a palette theme switcher.
- **A three-tier session-attention model in the sidebar.** Sessions surface as a calm active ring, a dot-only "ready" tier, or an action-required tier, with stale and cleared running-process reasons retired so the ring lights up only when something genuinely needs you. Quiet sessions show a relative quiet-age ("quiet 3m"), and collapsed workspace rows roll their sessions' attention up into a single indicator.
- **A slimmer workflow lens on the rail.** Each workflow card shows its type and artifact over a phase line, with status as an inline dot and a "ready" badge, nested on the rail — dropping the older done badge and heavier chrome.
- **Per-worktree process-list collapse.** The process list collapses to its top row with an inline expand, and the expanded/collapsed choice persists per worktree.
- **The aicreed brand mark is now the app logo,** with light and dark variants, alongside Nerd Font git-branch and palette glyphs used across the chrome.

### Changed

- **A full light / dark / warm theme overhaul.** All three themes now render with square corners (`--radius: 0`), solid neutral pane-separator borders, and Symbol Nerd Font icons, porting the TUI theme's traits across the board. The light theme was pushed from WCAG AA to AAA legibility.
- **The review rail holds up in narrow layouts.** The rail's file column is sized responsively (`minmax`) so it can't overflow a cramped review area, long file names ellipsize instead of pushing controls out of view, and the per-row "Viewed" toggle now floats inline at each file's top-right corner — retiring the separate header mark-viewed control.
- **Plugin dialogs lead with benefits.** The install dialog opens with a benefit-first description and per-plugin pitches, the Agent CLIs list is collapsible with a found-count summary, and the incomplete-install banner and its installer copy were rewritten in plain language.
- **Usage analytics moved to per-event ezio timestamps.** The ezio driver now stamps each event from its own per-line timestamp (NaN-safe) rather than the file mtime, the month scope is a rolling 31-day window, and the month popover chart carries date labels.

### Fixed

- **Review file rows no longer overflow their grid.** Rows can shrink in the commit-files grid so names ellipsize, and the rail header slot maps its `1fr` track to the scroll list, keeping the layout stable.
- **Sidebar layout hardening across themes.** Collapsed selection markers stay centered and single-boxed in every theme, worktree titles and branches ellipsis-clamp, header separators no longer bleed, and chrome icons recede at rest so the no-background hover highlight reads clearly.

## [0.11.2] – 2026-06-30

### Added

- **Intel Mac support via a universal build.** macOS releases now ship a universal (Intel + Apple Silicon) build alongside the native arm64 build, so Intel Macs are supported for the first time. The in-app auto-updater is arch-aware — Apple Silicon keeps pulling the slim native arm64 build while Intel Macs pull the universal build, both from one update manifest. A CI slice gate statically verifies (via `lipo`) that the universal binaries carry both CPU slices before any release is published. Resolves [#9](https://github.com/ai-creed/ai-14all/issues/9).

## [0.11.1] – 2026-06-29

### Added

- **A redesigned usage chip and analytics popover.** The token-usage chip now renders a dense stacked chart inline, and clicking it opens a popover with a four-way scope toggle — Session, Week, Month, and All-time — each showing a coherent period total, a per-provider breakdown, and a notional blended-rate cost. The daily chart carries weekday labels with the current day highlighted, and "Week" now means a rolling trailing seven days — always seven columns with today on the right — instead of a calendar week that looked empty on a Monday.
- **A native Codex rate-limit gauge.** When you use Codex, the popover surfaces its native usage limits — the rolling 5-hour primary window and the weekly secondary window — read straight from Codex's own logs. The gauge persists across restarts and is recovered from the logs on launch, so it survives an app restart instead of disappearing until the next limit event.
- **Lifetime token accounting that survives restarts.** Usage is now persisted as a durable day-by-day ledger, so All-time totals accumulate across runs instead of resetting each launch. Tokens are attributed to the repository they were spent in: historical and deleted worktrees roll up under their repo's workspace, and a sibling repository that merely shares a parent directory is no longer misattributed to its neighbor.
- **Codex and ezio token logs are counted alongside Claude.** Usage analytics ingest Claude, Codex, and ezio session logs, with blended per-provider pricing so a cost estimate is always shown.

### Changed

- **The review pane's right-hand queue panel is replaced by a slim comment minimap.** Open review comments now appear as a vertical strip of dots with a progress fill, clustering, and a flyout for each comment, reclaiming horizontal space for the diff. A rail "All open comments" overview collects the open-comments controls, the review chip becomes a comment-count label, and a Commands chip button plus a sidebar shortcuts-help button make the review actions discoverable.
- **The changes and commit lists show what you have already reviewed.** Reviewed files are marked and review-progress counts are shown, backed by a persisted reviewed-files record, with mark-viewed and toggle-overview available as both keyboard shortcuts and palette commands.

### Fixed

- **A failed settings write no longer crashes the app.** Errors while persisting settings (for example, the usage chip's selected range) are now caught and logged instead of surfacing as an unhandled promise rejection.

## [0.11.0] – 2026-06-27

### Added

- **A command palette, opened with Cmd+Shift+K.** Type to fuzzy-match commands by subsequence and run them from the keyboard: global app actions, cycling between worktrees, workspaces, and terminals, and jumping straight to review comments. The active row scrolls into view as you navigate with the arrow keys, and commands that would be no-ops in the current context (for example, terminal actions when no terminal is focused) are hidden rather than shown disabled.
- **ai-14all now detects, brands, and launches Cursor and Antigravity sessions.** Alongside Claude Code and Codex, Cursor and Antigravity agents are recognized in the UI with their own branding and can be discovered and launched directly — they are never whisper-mounted. A rapid second mount is deferred and auto-mounts within the two-agent cap, so launching two agents in quick succession no longer races.
- **Keyboard navigation for the terminal layout selector.** The layout picker now responds to the arrow keys — moving between tiles by their on-screen position — with Enter applying the focused layout. You can open the picker from the command palette and choose a layout without reaching for the mouse.
- **A redesigned command-preset manager.** Each preset now shows its label and command on separate lines, with the command styled as a codeblock, and its edit, delete, and launch actions are icon buttons with tooltips. A new per-preset launch target chooses whether the preset opens in a pinned terminal or in a throwaway shell. The seeded default presets are trimmed to the "yolo" claude and codex variants, since the plain launches are already a click away in quick launch.
- **The throwaway shell is now resizable.** Drag any edge or corner of the floating throwaway shell to resize it, clamped to at most 75% of the app's width and 80% of its height so it never swallows the window. Double-clicking its header resets both size and position back to the default.

### Changed

- **Plugin Configure and Install actions run in a floating throwaway shell.** Rather than taking over a pane in the terminal grid, configuring or installing a plugin (ai-whisper, ai-cortex, agent integrations) now runs in a floating throwaway shell, leaving your grid layout untouched.
- **The expanded throwaway shell minimizes on Esc or a click outside it.** Pressing Escape or clicking anywhere outside the expanded shell collapses it back to its pill, matching how the rest of the app's transient surfaces dismiss.

## [0.10.1] – 2026-06-24

### Added

- **The "Install agent integration" dialog now supports ezio.** Alongside Claude Code and Codex, you can install ai-14all's review skill and register its MCP server for ezio in one step. ezio's MCP host speaks stdio while ai-14all's server speaks HTTP, so the integration registers a small `mcp-remote` bridge in ezio's `mcp.json` — merged in next to any servers you already have, never replacing them — and writes the bundled skills into ezio's skills directory. Nothing changes if you don't use ezio.
- **A "Configure" button on the ai-whisper plugin card.** Configuring ai-whisper installs the bundled agent skills its workflows rely on in one click, matching the one-click Configure already offered for ai-cortex. Re-running it is safe — it refreshes the installed skills in place.
- **The Plugins panel now warns when ai-whisper's LLM evaluator isn't configured.** ai-whisper's review workflows refuse to start without a configured evaluator, so the panel surfaces a clear heads-up — distinguishing a missing API key from an invalid config — instead of letting you discover the problem only when a workflow fails to start.

## [0.9.3] – 2026-06-19

### Fixed

- **Terminal panes no longer go blank when you switch sessions within a workspace.** Selecting a different session re-rendered the panel with that session's panes, so the leaving session's terminals were torn down and the returning ones mounted empty — and because terminal output is a live stream with no replay, a remounted pane stayed blank until new output happened to arrive. ai-14all now keeps a per-session buffer of recent terminal output and replays it the moment a pane remounts, so switching back to a session shows its content immediately.
- **The ai-whisper workflow lens now refreshes the moment a worktree is loaded.** An active collab in a freshly-loaded worktree could be missing from the sidebar lens until the next poll, because the lens only re-read its state on a timer. The lens now re-reads as soon as the set of known worktrees changes, so a loaded worktree's workflow appears right away.

## [0.9.2] – 2026-06-15

### Added

- **ai-cortex ecosystem plugin: substrate memory for your agents, plus code navigation inside ai-14all.** A second opt-in driver (after ai-whisper) wires ai-cortex as a peer: it gives your agents a memory layer they recall from and record to across sessions, and its index unlocks code navigation in ai-14all's viewers — go-to-definition, find-references, and symbol search — as a power feature gated on enabling the plugin. A "Configure ai-cortex" shortcut registers the MCP server for your installed agent CLIs (claude, codex) and installs ai-cortex's capture hooks and memory prompt guide. Nothing changes for users who don't opt in.
- **A "Read more on GitHub" link on each plugin card.** Every ecosystem plugin (ai-whisper, ai-cortex) now links to its project repository, so you can learn what a plugin does — including before installing it. The link opens in your default browser.

### Fixed

- **Links in rendered content now open in your default browser instead of hijacking the app.** Clicking a link in the Markdown preview or a code file used to navigate the app window itself to that page, leaving you stuck on a web page with no way back. All web links (and `mailto:`) now open externally and the app shell can no longer be replaced.
- **`Cmd+P` (Open Files) now works while the terminal pane is focused.** The terminal parks focus in a hidden text input that was swallowing the shortcut; it now fires from the terminal just like `Cmd+J`. No terminal keybinding is affected — the terminal binds no `Cmd+P`.
- **Agent CLIs installed in `~/.local/bin` are now detected.** ai-14all probes binaries with an interactive login shell, so a tool whose `PATH` entry lives in `.zshrc` (for example the Claude native installer's `~/.local/bin`) is found — previously only login-file locations such as Homebrew's were. A well-known-path fallback (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`) covers anything the shell probe misses.

## [0.9.1] – 2026-06-14

### Fixed

- **Plugins panel no longer mislabels an installed ai-whisper as "not installed" when ai-14all is launched from Finder/Dock.** Such launches inherit only the bare macOS GUI PATH (without `/opt/homebrew/bin`), so the probe (`whisper env --json`) could not find the `node` interpreter its shebang needs and failed — leaving an Install button that reinstalling could never clear. ai-14all now repairs its PATH from a login shell at startup (packaged macOS builds) before probing. As a safety net, a tool whose binary resolves but cannot be probed is now reported as "degraded" with a Re-probe action rather than "not installed", so a present-but-unusable peer never shows a misleading Install button.

## [0.9.0] – 2026-06-14

### Added

- **Ecosystem plug-in framework: opt-in drivers for peer apps.** A static in-process driver registry wires peer tools into ai-14all without affecting any user who has not opted in. The first driver targets ai-whisper and surfaces a live workflow lens in the sidebar (pause/resume/cancel + tell-agent actions with an audit log). Configuration lives at `userData/config.toml`; probing is cached via a single capability-probe service; peer state is read-only under provisional read contracts; commands route through the peer's own CLI with JSONL audit; renderer surfaces use typed IPC. A Plugins panel (probe / enable / guided install) makes the feature discoverable. Without ai-whisper installed and enabled, nothing changes.
- **Agent launchers in the terminal-chrome header.** A relocated header hosts per-agent launch chips (Claude, Codex, Ezio) in per-provider colors. With ai-whisper healthy, a chip mounts the agent into a collab (an aggregate status pill steps 0 → 1 agent → ready for workflows); otherwise it spawns the agent plainly. A shared pending-mount guard prevents a rapid second click — in the header or an empty slot — from creating a second concurrent collab.
- **Launch agents directly into an empty terminal slot.** Each empty slot offers the agent chips (primary) plus a quieter start-a-shell action, landing the chosen agent in that specific slot.
- **Ezio is a first-class agent.** Detected via `ezio doctor`, surfaced as a launch chip and, in the sidebar, as a magenta provider badge — recognizing both `ezio` and the `ai-ezio` alias.
- **Sidebar workflow lens styled as a mini inspector.** The lens reads as a compact card set apart from the shells: a "Last workflow:" caption + short type label (SDD/Ralph/Bugfix), the artifact, the current phase and iteration, and a semantically-colored status (running / done / halted / escalated / paused).

### Changed

- **Replaced the Start-collab button with the always-available agent launchers** and an aggregate collab status pill; the agent chip bar and the terminal shells now share one bordered terminal frame so they read as a single region.
- **Fresh worktrees skip the auto default shell when an agent CLI is detected**, opening to an empty slot the user fills intentionally (an agent, or a plain shell) rather than a redundant default shell the first agent spawn would push aside.
- **Relicensed from MIT to FSL-1.1-ALv2** with a contributor CLA.

### Build

- **`predev` / `pretest` hooks rebuild `better-sqlite3` for the right ABI** — Electron for `pnpm dev`, host Node for `pnpm test` — so neither workflow leaves the native module in the other's ABI (which silently broke the whisper lens by making every store read fail).
- **Deterministic agent-CLI detection under E2E.** The probe ignores the host PATH and honors an explicit opt-in, so terminal tests no longer depend on which agent CLIs are installed on the runner.

## [0.8.1] – 2026-06-08

### Build

- **Restored the full dependency closure in `app.asar`.** Bumped `electron-builder` to 26.15.2 so the packaged `app.asar` again contains its complete dependency closure.
- **`afterPack` asar-closure guard.** The build now aborts if the packaged `app.asar` is missing part of its dependency closure, catching incomplete-bundle regressions at package time.
- **Force `electron-rebuild` of `better-sqlite3` in the release pre-flight**, because the E2E posttest leaves the native module at the host ABI and electron-builder otherwise skips the rebuild.

## [0.8.0] – 2026-06-08

### Added

- **Code navigation in the Files pane (Cmd+T symbol search + go-to-definition / peek).** The Review overlay now hosts a `FilesPane` with an inline Files / Symbols toggle. `Cmd+T` focuses a fuzzy symbol search (two-line virtualized result rows with match highlighting) that navigates to a symbol's precise line and column. In the Monaco editor, go-to-definition jumps to the best-ranked definition, and peek resolves definitions across files via on-demand `file://` models (LRU-cached, disposed on reindex / worktree switch). Built on an ai-cortex SQLite index (cortex v3.1 schema, version-gated) ingested into a per-worktree mirror and kept fresh by a file watcher.
- **Graceful disable when the worktree has no cortex index.** Symbol-search IPC is skipped and the pane surfaces a disabled state (with a push event) when the worktree has no ai-cortex index or the ai-cortex CLI isn't installed, rather than erroring.

### Changed

- **`Cmd+T` rewired to the Files-pane Symbols mode**, replacing the standalone `SymbolPalette` modal (now removed along with its test). Terminal auto-focus is suppressed while the review overlay is open so `Cmd+T` reliably focuses the symbol search. Monaco's built-in TS/JS definition + reference providers are disabled in favor of the cortex-backed providers, and the read-only viewer's TS semantic diagnostics are silenced.

### Fixed

- **Monaco peek / model-resolution crashes.** Suppressed the "Model not found" peek crash, made `cortex://` URIs survive Monaco URI normalization, normalized `..` traversal in `fromFileUri` before the inside-worktree check, and silenced benign Monaco cancellation console noise.

### Build

- **Release CI bumped to Node 24** to match Electron 41's bundled Node (24.x) and to provide a stable `node:sqlite` — the cortex fixture helper imports `DatabaseSync`, which is experimental/flagged on Node 22 and broke Vite's externalize.
- **Native deps compiled from source against Electron's headers** (`buildDependenciesFromSource`), because under Node 24 electron-builder's prebuilt-based rebuild fetched a host-ABI `better-sqlite3` (137) instead of Electron's (145), which the `afterPack` ABI check rejected. `afterPack` now asserts the `better-sqlite3` ABI matches the bundled Electron.
- **CI repairs for Node 24 / Electron 41 packaging:** re-extract the Electron app with `ditto` (extract-zip dropped Frameworks), repair `electron`'s `path.txt` after install, force an `electron-rebuild` of `better-sqlite3` before packaging, and alias `electron` to a stub in unit tests so they don't depend on the installed binary.
- Added `better-sqlite3` and `chokidar` dependencies (upgraded `better-sqlite3` to 12.10.0 for Electron 41 V8 compatibility).

## [0.7.2] – 2026-05-28

### Added

- **Files-mode inline editing.** The Files review mode now edits files in place via a new `InlineEditor` + `EditorDirtyBar`, replacing the old editor modal. Clicking a file in the tree runs a dirty-gate so unsaved edits aren't silently lost; the gate also covers `Cmd+P`, worktree switches, cross-workspace navigation, and the workspace cycle, backed by a main-process dirty map and a renderer close handshake.
- **Show-ignored toggle in the file tree.** `WorktreeTree` gained a toggle (off by default) that lists git-ignored files as dimmed rows. File listing accepts an `includeIgnored` flag and shares an `IGNORED_DENYLIST` with segment-equality matching.

### Changed

- **Review chrome UX polish.** Chrome parity across modes, an in-pane file preview, and smaller controls.

### Fixed

- **Codex per-file context persists across usage-worker restarts.** The Codex per-file context (cwd) is now persisted so a worker restart keeps the right working directory.

### Performance

- **Commit diffs are fetched lazily per file** on expand instead of all up front.

### Removed

- **`EditorModal` and `FileViewer`** (and their dead `App` plumbing), superseded by the Files-mode inline editor.

## [0.7.3] – 2026-06-04

### Added

- **"Creating session…" progress indicator.** Creating a worktree runs several Git commands and can take a few seconds. The New session dialog now shows a pulsing indicator while it works (buttons disabled, dialog stays open) instead of looking frozen. Respects `prefers-reduced-motion`.
- **Actionable hint when a repository has no default branch.** If `origin/HEAD` isn't set, the New session dialog shows a calm explanation with the one-line fix (`git remote set-head origin -a`) instead of a raw error banner.

### Changed

- **Sidebar workspaces are sorted.** Loaded workspaces are listed first, then unloaded ones, each group ordered alphabetically (case-insensitive) — no more interleaving of loaded and unloaded entries.
- **Wider note pane.** The note pane is 140px wider for more comfortable reading and editing.

### Fixed

- **Token telemetry now counts every tracked workspace, not just the active one.** The usage worker rebuilt an empty aggregator each launch but resumed transcripts at their persisted byte offset, so only workspaces with new activity in the current session appeared under "all tracked" (and weekly totals reset on every restart). On launch it now re-reads transcripts modified within the rolling week, rebuilding the full week for every tracked worktree.
- **New worktrees branch from the repository's actual default branch.** Creation was hard-coded to `origin/master` and failed in repos whose default branch is `main` (or that lack `origin/master`). It now resolves the default from `origin/HEAD`, and fails with an actionable message when that isn't set.
- **Session titles entered at creation are no longer dropped.** The title was applied before the session existed (a no-op); it's now applied after the session is created.
- **No more restore-state write crash under rapid workspace switching.** Concurrent state writes shared a single temp file, causing intermittent `ENOENT … rename … workspace-state.json.ai-14all.tmp` errors; each write now uses a unique temp file and writes are serialized.

## [0.7.1] – 2026-05-27

### Added

- **Background auto-update.** Replaces the notify-only update banner with a full `electron-updater` flow: a newer stable release downloads in the background and the app prompts **Restart now / Later** (Later installs on the next quit). Stable channel only — beta builds stay manual. Update errors are logged and stay silent to the user.

### Changed

- **Signed & notarized macOS builds.** Both the `.app` and the `.dmg` are now signed with an Apple Developer ID and notarized, with the hardened runtime enabled — so the app opens normally without the right-click / `xattr` Gatekeeper workaround. node-pty terminals are verified working under the hardened runtime.

### Build

- Release CI signs, notarizes, and staples the app **and** the DMG, gates the publish on `codesign --verify` + `spctl --assess` of both artifacts, and uploads the native `latest-mac.yml` to the GitHub release so `electron-updater` can read it. Local signed builds via `pnpm package:mac:signed`; the process is documented in [`docs/signing-runbook.md`](./docs/signing-runbook.md).

## [0.7.0] – 2026-05-27

### Added

- **Agent token telemetry for Claude and Codex.** A gated background process reads the providers' local session logs (`~/.claude`, `~/.codex`) and surfaces live per-agent token usage in the app. Configurable 5-hour and weekly budgets, weekly reset day/hour, an include-untracked toggle, and an enable/disable switch. Enabled by default.

## [0.6.1] – 2026-05-26

### Fixed

- **Terminals no longer go blank after switching workspaces.** Switching to another workspace and back left the agent/shell terminals empty (the `xterm-accessibility` tree had no text), recoverable only by toggling the layout. The active workspace's terminal panel was unmounted on every switch, disposing the xterm instance and its PTY output subscription with no buffer or replay — so the remounted pane was blank and any output produced while the workspace was inactive was lost. Every hydrated workspace now keeps its terminal panel mounted (hidden via CSS), preserving scrollback and the live output subscription across switches; only the active workspace's panel is visible.
- **Adding a shell no longer kills a later shell.** With a multi-shell layout, closing a shell that wasn't the last one and then adding a new shell (top Add button, `⌘T`, or the in-grid "start a shell" CTA) overwrote a following shell, orphaning its running process. The slot model was compacted before the new shell was placed, shifting a later shell into the target slot. New shells now fill the empty slot in place; compaction is reserved for genuinely growing into a larger layout.
- **Sidebar session card shell rows keep a stable order.** Rows were sorted by status and recency, so two agents changing state at once made the summary list shuffle position. Rows now stay in creation order while the card's overall status still reflects the most urgent shell.

### Changed

- **Sidebar session card summary text is one consistent size.** Shell labels, the agent provider badge, and the summary line are unified to match the card task line instead of three different sizes.

## [0.6.0] – 2026-05-25

### Added

- **Terminal layout presets (slot-based terminal chrome).** Replaces the legacy single/split terminal model with a slot grid driven by a 26-layout catalog (up to 6 shells). A layout selector dialog (`⌘⇧L`) picks the arrangement; empty slots show a "start a shell" CTA; adding when all slots are full auto-promotes to the next layout bucket; a per-slot "promote to master" action swaps a child shell into the master slot. Layout and slot assignments live on the session and persist across restarts.
- **Terminal actions in the session chipbar.** The standalone terminal toolbar row is gone — add-shell (`＋`), layout (`▦`), and presets (`⚙ ▾`) are now icon+text chips in the session chipbar, grouped to the right of Files/Note by a divider. Files/Note gained leading icons for a consistent row. The terminal grid reclaims the freed vertical height.
- **Per-slot refit action (`⤓`).** A header button that re-fits the terminal to its container, notifies the PTY of the new size, and scrolls to the bottom — a manual recovery for the occasional "shell text vanished" state that previously needed a layout switch.
- **Warm theme + a theme selector.** A new **Workspace → Theme** menu (System / Light / Dark / Warm). Warm is a dark espresso/umber palette with ivory text, a terracotta accent, and a cool sidebar border to set the sidebar apart from the warm main chrome.
- **Theme-aware terminals.** xterm cells now follow the active app palette (light/dark/warm) with a tuned ANSI color set, applied live on theme change without recreating the terminal. The terminal background sits a step darker than the surrounding chrome so the terminal reads as a distinct surface.
- **Density-aware terminal font.** Terminal text shrinks 1px per two layout slots (1–2 slots: 12px, 3–4: 11px, 5–6: 10px), applied live so denser layouts fit more rows/cols.
- **Clickable review chips.** The "changed files" and "open comments" chips now navigate the review overlay — opening Files mode with the first changed file selected, or jumping to, revealing, and focusing the first open comment.
- **`Cmd+P` / `Cmd+J` work inside the terminal pane** (previously swallowed by the focused xterm).
- **Esc closes the review overlay.** Pressing Escape while interacting with the review overlay collapses it (like the Note drawer). Scoped to keypresses originating within the overlay, so dismissing a context menu, closing a nested editor modal, or working in the terminal/sidebar doesn't close it.

### Changed

- **Terminal slot header restyled** into a clear title bar: brighter background, stronger top/bottom borders, primary-color label, and hover/focus-visible affordance on the `↑`/`↻`/`✕` icon buttons. The status badge dot moved to the left; action buttons sit on the right.
- **Stacked terminals lose the inter-row gap** — the header's top border is the separator (suppressed on the top-row slot); side-by-side terminals keep their column divider.
- **`⌘⇧L`** replaces the old split toggle; the legacy single/split terminal model and its reducer paths were removed.
- **Shell-spawn failures now surface a toast** via an imperative toast bridge.
- **Wider two-column shortcuts help dialog.**

### Fixed

- **Terminal slot grid now fills the full pane height.** A leftover `auto` grid row left the grid sized to content with dead space below; collapsed to a single `1fr` track.
- **Slot status badge dot now reflects real attention states** (`activity` → warning, `actionRequired` → danger). The prior rule targeted a `needsAttention` value that the state model never emits, so the attention color never fired.

## [0.5.1] – 2026-05-19

### Fixed

- **Sidebar card no longer shows a stale "cooking" state for an idle agent.** Two defects let the worktree card stay orange/active after an agent had gone idle:
  - The terminal classifier treated the persistent agent-CLI mode footer (the `… (shift+tab to cycle)` line, e.g. "bypass permissions on") as ordinary `active` output. Because the TUI repaints that footer continuously, the process was pinned to `activity` forever. Footer-only redraws now produce no attention signal.
  - An accepted non-`failed` MCP `report_session_status` push now supersedes **any** stale terminal-classifier reason (`waiting`/`active`/`ready`/`failed`), not just `failed`. The agent's own self-report is authoritative; a real non-zero process exit (`lifecycle` failed) is still preserved. This generalizes the v0.5.0 stale-`failed` clear and makes the self-report a reliable backstop.

## [0.5.0] – 2026-05-19

### Added

- **Agent task recall on the session card.** The sidebar session card now shows the high-level task each agent was given, so fanning out across sessions (assign A, switch to B, return to A) no longer loses track of what each agent is doing.
- **Per-process provider badge.** Each process shows a `[claude]` / `[codex]` badge with a color distinction (Claude orange-ish, codex blue-ish). Provider is detected from the command token (sticky; never downgrades).
- **`report_session_status` `task` field.** The MCP tool gained an optional `task` field (≤200 chars) so agents report their mission, not just transient state.
- **Bundled `ai-14all-session-status` skill.** An always-on skill installed to both Claude and codex via the multi-skill installer, instructing agents to report status/task transitions.
- **Opt-in agent-attention diagnostics.** `AI14ALL_AGENT_ATTENTION_LOG=full|sampled|off` env var (off by default) writes JSONL to the Electron logs dir, with local-date daily rotation, 7-day prune, and a ~70 MB total disk budget. An in-app banner shows when full-mode capture is active.
- **`pnpm diag:attention` CLI** to inspect the diagnostic log (filters: `--type` / `--state` / `--worktree` / `--provider` / `--days`).

### Fixed

- **Session attention card no longer lies.** An MCP non-`failed` status push now clears a stale terminal-classifier `failed` state — fixing the core bug where the card showed `failed` after an agent (e.g. codex) had actually completed a review successfully.
- **Resolution emitter hardened against React StrictMode** double-invocation (module-scoped prev-snapshot store; first-appearance resolutions no longer double-emit in dev/E2E).

## [0.4.0] – 2026-05-15

### Added

- **Inline review threads.** Comments render directly in the Monaco diff as view-zone widgets anchored to lines. Authoring, editing, addressed/reopen, delete, status chip, relative timestamp — all inline. Threads survive scroll, switch correctly when the active file changes, and unmount safely (`queueMicrotask`-deferred `root.unmount` avoids the React 18 synchronous-unmount race).
- **Review queue panel.** Replaces the prior comment sidebar. Per-row jump, Address ✓, Delete ×; header carries "Hide addressed" toggle and a "Clear addressed" danger button. Counts cover the whole worktree.
- **Chipbar + on-demand overlay.** Replaces the bottom collapsible review drawer. The new `ReviewChipBar` is an always-visible slim status row at the bottom of the main column (mode, dirty/clean status, comment counts, refresh, "⬆ Review" launch). The full review surface opens as a `ReviewExpandedPortal` overlay — same as the prior expand-mode portal, now the only review entry point. The slim chipbar reclaims the vertical space the partial drawer used to waste.
- **`Cmd+J` / `Ctrl+J`** unified shortcut to toggle the review overlay. Replaces the prior `Cmd+J` (drawer toggle) and `Cmd+Shift+J` (expand) pair.
- **`Cmd+.` / `Cmd+,`** to jump to next/previous file within the current Changes list or commit's file stack. Cycles with wrap-around. Hunk navigation stays on `Cmd+Shift+.` / `Cmd+Shift+,`.
- **Comment selection pill.** Selecting text in the diff editor surfaces a 24×24 ⊕ widget — click to start an inline comment scoped to the selection.
- **Gutter "+" affordance.** Single-line add via gutter glyph on hover.
- **Inline keyboard flow.** `Meta+Shift+A` opens a draft thread at the caret; `Enter` submits, `Shift+Enter` newline.
- **Terminal auto-focus.** Clicking a terminal tab or navigating via shortcut now focuses the underlying xterm immediately, no extra click needed.
- **Toast utility.** Non-blocking error toasts for review-edit/save/delete failures.
- **Review comment update + bulk-remove-addressed.** New service operations, IPC handlers, preload bindings, and renderer hooks. "Clear addressed" wipes addressed comments for the current worktree in one shot.

### Changed

- **Diff editor sizing in commit review** now auto-syncs to Monaco's `getContentHeight()` via `onDidContentSizeChange` on both modified and original sides. Previously a static `lines × 20 + 32` estimate, which overshoots Monaco's actual ~16-18px line height and leaves several hundred px of blank space below long files.
- **Queue-jump now scrolls the diff stack.** `revealLineInCenter` only scrolls within Monaco's internal scroll, which is a no-op for the stacked-diff layout (each editor sized to fit all content; outer container scrolls). The helper now also walks to the nearest scrollable ancestor and centers the line in it.
- **Terminal scrollback raised** from 2000 to 10000 lines.
- **Drawer-era CSS classes renamed** to `shell-review-expanded-portal__*` to match the surface they actually style.

### Fixed

- **First-file-in-first-commit black-render race.** Inline thread host was positioned at `top: spacerTop − scrollTop`, double-subtracting (Monaco's `onDomNodeTop` returns viewport-relative coords already). Most files had `scrollTop === 0` so the bug was invisible; the first editor in `CommitDiffStack` occasionally has non-zero internal scrollTop and the host landed at `top: -15000+px`, clipped by overflow-guard. Dropped the subtraction; also removed the now-redundant `onDidScrollChange` listener (`onDomNodeTop` fires on every scroll with the latest viewport-relative top).
- **Stale draft zone** when the comment anchor changes between lines: the draft now reinitializes the view zone on `endLine` change instead of reusing the old one.
- **Edit-save failure handling.** The inline edit flow now reports save failures via toast and keeps the editor open so users can retry without losing their text.
- **Review overlay no longer leaks across worktree/workspace switches.** New effect keyed on `activeWorkspaceId + activeWorktree?.id` resets `reviewOpen`.
- **Keyboard ArrowLeft/Right tab navigation in the terminal tablist regressed** during the auto-focus rework — `onValueChange` was dropped from `Tabs.Root` to give onClick exclusive control, but Radix's automatic activation mode also routes ArrowLeft/Right through `onValueChange`. Restored the handler and narrowed onClick to fire only when re-activating the already-active tab.
- **xterm "Cannot read properties of undefined (reading 'dimensions')"** at startup now suppresses the error via the renderer error boundary across both the `_innerRefresh` and `syncScrollArea` code paths.

### Removed

- **Bottom review drawer** and its associated state (`reviewDrawerOpen` from `WorktreeSession`, `reviewPanelHeight` from `usePaneResizers`, the `useReviewDrawerAutoExpand` hook, `ReviewDrawer` + `ReviewDrawerSection` components, the drawer resize handle, and the `session/setReviewDrawerOpen` action).
- **`Cmd+Shift+J` "expand review"** shortcut (folded into the unified `Cmd+J`).
- **`ReviewCommentSidebar` + `ReviewCommentCard`** (replaced by inline threads + queue panel).
- **`reviewDrawerOpen` from persisted snapshots.** Schema dropped the field; Zod silently strips it from legacy snapshots written by prior versions (regression-tested).

## [0.3.0] – 2026-05-01

### Added

- **Session attention v2.** The sidebar now surfaces a multi-source view of what each shell needs from you — replacing the single legacy attention dot. Signals are merged, ranked, and shown per-process and rolled up to the worktree row.
  - **Agent process detection** — labels and command lines matching known agent CLIs (`claude`, `codex`, etc.) are flagged as agent processes, sticky once detected so subsequent CLI title overwrites don't drop the flag.
  - **Terminal output classification** — ad-hoc shell output is classified into `waiting` / `ready` / `failed` / `active` based on prompt patterns and lifecycle markers; reasons attach to the process row with a one-line context.
  - **MCP `report_session_status` tool** — agents running inside ai-14all can push lifecycle directly: `active`, `waiting`, `ready`, `failed`, with a short summary and optional next-action.
  - **MCP server-level `instructions`** — the `ai-14all` MCP server now ships a server-level orientation block covering all five tools (reviews, session note, session status) and the lifecycle protocol, so agents know how and when to use the surface.
  - **Stale detection** — running processes with no activity past the stale threshold get a "quiet for Ns" indicator.
  - **Per-row "Clear failed" button** — failed lifecycle reasons stick until you dismiss them; a button on the affected row clears the reason in place.
  - **Session-level MCP overlay** — MCP-reported session status is shown alongside per-process state on the worktree row.
  - **Cleared on view + on snapshot restore** — opening a row clears its agent attention; restoring from a persisted workspace starts clean rather than replaying stale reasons.

- **Terminal find (Cmd+F).** In-pane find toolbar in xterm panes — query, prev/next, match-case, "n of m" counter, decorations on matches. `Enter` advances, `Shift+Enter` goes back, `Esc` closes and returns focus to the terminal. Mirrors Terminal.app / iTerm.

- **Diff hunk navigation (Cmd+Shift+. / Cmd+Shift+,).** Jump to the next or previous change in the current file from the review surface. Works in both the file diff (`changes` mode) and the multi-file commit stack (`commits` mode), wraps within the file, and scrolls the outer container so the target hunk is centered on screen.

- **Startup splash.** A small "Initializing, ready soon" message with a gradient progress bar replaces the empty viewport during initial bundle parse. Theme-aware via `prefers-color-scheme`. Hides automatically when React's first render commits.

- **Sidebar card frame.** Worktree rows are wrapped in a card-shaped row container with a gradient divider between workspace groups. Attention attributes mirror onto the card so the entire row reads as one click target while the inner button still owns keyboard activation.

### Changed

- **Terminal scrollback raised** from 1000 to 2000 lines, so the new find feature has more history to search.
- **xterm lifecycle is now tied to `session.id` only.** Process-state transitions (running ↔ idle ↔ exited) no longer dispose and rebuild the xterm instance for that session — output buffer is preserved across exits.
- **Sidebar rename input** restyled to match the rest of the app (panel-bg, accent focus border, tighter padding for the row).

### Fixed

- **Diff editor blank in commit review.** The cleanup that detaches the Monaco diff model on unmount lived in a `useEffect` whose deps included an inline parent callback, so it fired on every parent re-render and detached the model from a still-mounted editor. The cleanup now runs only on real unmount.
- **Monaco "TextModel disposed before DiffEditorWidget model got reset"** in `DiffViewer` and `CommitDiffStack` — diff editors now null their models on unmount before `@monaco-editor/react` disposes them.
- **xterm "Cannot read properties of undefined (reading 'dimensions')" at app startup.** Suppressed the specific known error at the renderer error boundary; narrowed the surface area by lazy-loading the search addon and scoping `allowProposedApi` to first use.
- **xterm renderer recreated on process exit.** The lifecycle now keys only on `session.id`; output is preserved across exits.
- **Diff hunk navigation didn't actually scroll into view** in multi-file commit reviews. `revealLineInCenter` only scrolls within the editor; the helper now also walks up to the nearest scrolling ancestor and centers the target line in it.
- **Sidebar rename input cleared mid-typing.** The seeding effect re-ran on every `workspaces` update, wiping the draft. It now seeds once per `pendingRename` request.

### Notes

- Two e2e tests were updated for the sidebar refactor and the `markProcessViewed` view-reset behavior; one (`Clear failed button dismisses failed reason in sidebar`) is temporarily skipped pending shell-isolation rework — the affordance is straightforward to smoke-test manually.

## [0.2.0] – 2026-04-30

### Added

- **File payload caps and binary detection.** `readDiff`, `readCommitDetail`, and the file viewer now share size limits and a binary-detection helper, returning structured too-large/binary/not-found markers instead of raw blobs.
- **`GitCommandRunner`.** All `GitService` git invocations now run through a single runner with timeout, `maxBuffer`, and cancellation support.
- **Workspace persistence coordinator.** Persisted workspace state is written through a coordinator with debounced writes, atomic temp + rename, and an explicit flush on quit.
- **Terminal output batching.** PTY output is aggregated on a 16ms window with a hard cap before IPC dispatch, and the renderer coalesces xterm writes via `requestAnimationFrame`.
- **Diagnostics terminal-output sampling.** Dev mode samples `terminal-output` events at 1/50 by default to keep the shell-event log usable on noisy sessions.
- **Performance test gate.** A new perf suite runs file/git operations against a 2k-file fixture repo with thresholds.

### Changed

- **IPC contract migration.** All git and files IPC commands (`readDiff`, `readSummary`, `readCommitHistory`, `readCommitDetail`, `getRemoteStatus`, `listChanges`, `discardChange`, `pushBranch`, `files:list`, `files:listScoped`, `files:read`) now take `workspaceId + worktreeId` instead of paths.
- **Layered import lint.** ESLint forbids `src/` imports from `shared/`, `services/`, and `electron/` to keep the renderer/main boundary clean.
- **`App.tsx` decomposition.** Extracted ~25 hooks (workspace lifecycle, worktree selection/actions, git/process actions, loaders for diff/summary/commit-history/commit-detail/remote-status, listeners, shortcuts, persistence, etc.) and 8 components (`DialogStack`, `TerminalPanel`, `ReviewArea`, `ReviewDrawerSection`, `SidebarPanel`, `MainColumnChrome`, `RestoreBanner`, `WorktreeList`).
- **Feature folder layout.** `workspace`, `viewer`, `review`, `terminals`, and `git-feature` split into `components/`, `hooks/`, and `logic/` subfolders.
- **Kebab-case file names.** Renamed remaining camelCase TS files (`useTheme`, `useTerminalSession`, `useAgentInstallStatus`, `useReviewComments`, `openExternal`, `updateNotifier`, `rewriteManifest`) to kebab-case.
- **Privileged IPC trust boundary.** Documented in `AGENTS.md`.

### Fixed

- Bundled review skill resolves via the canonical assets path with fallbacks for packaged and dev runs.
- Workspace persistence in IPC bypasses the coordinator to preserve synchronous write semantics where required.

## [0.1.2] – 2026-04-28

### Added

- **MCP session note tools.** The ai-14all MCP server now exposes `read_session_note` and `append_session_note`, letting agents append timestamped markdown sections to the active worktree session note when explicitly requested.
- **Session note markdown preview.** The note sheet now has an Edit/Preview toggle that renders notes as GitHub-flavored markdown using the existing preview stack.

### Changed

- MCP server internals were generalized from review-only to ai-14all-wide tooling, with a renderer note bridge that waits for restored workspace state before accepting note calls.
- E2E release coverage now includes the note-sheet markdown preview flow.

### Fixed

- Session note bridge cleanup is idempotent across renderer reloads and bridge disposal.
- MCP note worktree resolution refreshes once before returning `no_worktree`, reducing stale resolver failures after workspace changes.
- Several E2E selectors were updated to match the shared dialog/input components, restoring the full E2E suite for release validation.

## [0.1.1] – 2026-04-28

### Added

- **Inline review comments.** Author, browse, and resolve comments directly on diffs in the review drawer. Comments persist per worktree, render gutter affordances and per-file/per-commit open-count badges in the Changes and Commits lists, and survive worktree rebasing.
- **Review MCP server.** A local MCP server exposes `list_pending_reviews` and `mark_review_addressed` so external agents can fetch and address review feedback. Port is probed, persisted, and liveness-checked.
- **Agent skill installer.** One-click install of the bundled `ai-14all-fix-review` skill into the Claude and Codex CLIs. Lives under Settings → Install agent skill, with a CLI-presence check.
- **Review pane expand mode.** Slide the review drawer up into a fixed portal overlay covering the editor area without resizing the terminal. Triggered by ⌘⇧J / Ctrl+Shift+J or the new ⬆/⬇ button in the drawer header. Drawer open/closed state and expand state are independent.
- **Comments sidebar toggle in header.** The 💬 button now lives in the drawer + portal header (next to Refresh and Expand) and lights up in the accent color when the comments sidebar is open.

### Changed

- Drawer/portal headers reorganized: `↻ Refresh → ⬆/⬇ Expand → 💬 Comments`.
- The expanded portal renders a full red outline matching the drawer's standard look.
- DiffViewer enables `glyphMargin` so review affordances render in the gutter.

### Fixed

- Keyboard shortcuts now fire correctly when focus is inside read-only Monaco editors and capture-phase listeners.
- `Cmd+Enter` UX in the Files overlay.
- Comment sidebar opens on glyph click when a file has no comments yet; resolved a Monaco disposal error.
- Portal animation race, transition timeout fallback, and resize tracking when the sidebar is resized while expanded.
- Preload no longer pulls in `zod` under `sandbox: true`.

## [0.1.0] – 2026-04-24

First stable release. Graduates the v0.1.0-beta.N line after the 2026-04 redesign landed.

### Added

- Sessions-first workflow: named sessions backed by Git worktrees, session title + worktree label + branch visible in the rail and the chip bar.
- Compact session chip bar replacing the expanded top band.
- Collapsible review drawer with Files, Changes, and Commits modes.
- Files overlay for fast keyboard-first file navigation.
- Note sheet for per-session notes.
- Shortcut help overlay driven by a single registry, with platform-specific bindings.
- Lightweight in-app editor for whitelisted file types.
- Notify-only update check: banner appears when a newer version is published; Download opens the browser.

### Known issues

See `KNOWN-ISSUES.md`.
