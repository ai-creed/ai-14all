# Changelog

All notable changes to ai-14all are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
