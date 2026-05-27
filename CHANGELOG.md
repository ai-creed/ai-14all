# Changelog

All notable changes to ai-14all are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
