# Changelog

All notable changes to ai-14all are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
