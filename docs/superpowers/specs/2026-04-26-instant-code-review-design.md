# Instant Code Review Design

**Date:** 2026-04-26
**Status:** Draft

## Problem

Coding agents (Claude Code, Codex, etc.) running inside ai-14all terminals produce code changes the user reviews in the embedded read-only diff viewer. Today, to send corrections back to the agent the user must re-type instructions into the terminal, often re-stating file/line context. There is no app-mediated affordance for "I have feedback on this specific change" that the agent can pick up structurally.

This spec adds a lightweight review-comment surface inside the app and exposes it to agents via a local MCP server. The agent pulls; the app does not push to any vendor API. Review feedback flows from user → app → agent without leaving the worktree session.

## Goals

1. Author short, line-anchored review comments on changed files (working tree or any commit) without leaving the read-only diff viewer.
2. Persist comments with the worktree session across app restarts.
3. Expose pending comments to any MCP-capable agent via a local server, with a bundled skill that teaches the agent how to fetch and act on them.
4. Allow the agent to mark a comment addressed; allow the user to override.
5. Default install paths and bundled assets for Claude Code and Codex; documented manual setup for any other MCP-capable agent.

## Non-Goals

- Editing code inside the embedded viewer (still read-only per `AGENTS.md`).
- Vendor-specific or push-direction agent API integrations (carved out by the recently-updated `AGENTS.md`).
- Inline GitHub-style threaded comments rendered between code lines (deferred; sidebar layout chosen for v1).
- Commenting on the original (HEAD) side of the diff (modified-side only — covers the dominant feedback case).
- Live re-anchoring of comments when files change (snippet-based search is best-effort; v1 surfaces "snippet not found" to the user instead of auto-relocating).
- Mass operations (bulk-resolve, batch-import, export). Single-comment operations only in v1.
- Cross-worktree comment views; comments are scoped strictly to one worktree.
- Multi-user concurrency, locking, or auth on the MCP server (single-user assumption).

## Architecture

Three subsystems with a single source of truth in Electron main:

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer                                                    │
│  ReviewDrawer ─ DiffViewer (read-only, modified side)       │
│              └─ ReviewCommentSidebar (NEW)                  │
│                  ├─ list comments for current file          │
│                  ├─ mark addressed / reopen / delete        │
│                  └─ scroll diff to comment line range       │
│                                                             │
│  DiffViewer affordances (NEW):                              │
│    - hover line on modified pane → "+" gutter icon          │
│    - drag-select range → floating "+ Add comment" button    │
└──────────────────────────────┬──────────────────────────────┘
                               │ IPC
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ Electron main                                               │
│                                                             │
│  ReviewCommentService (NEW, source of truth)                │
│    ├─ in-memory Map<worktreeId, ReviewComment[]>            │
│    ├─ persists via ReviewCommentStore (NEW, separate file)  │
│    ├─ exposed to renderer via IPC (CRUD + change events)    │
│    └─ exposed to MCP server via direct in-process calls     │
│                                                             │
│  ReviewMcpServer (NEW)                                      │
│    ├─ HTTP MCP transport on localhost                       │
│    ├─ port reserved across runs                             │
│    │   (persisted to <userData>/ai-14all/mcp-config.json)   │
│    ├─ liveness file <userData>/ai-14all/mcp-port            │
│    │   written on listen, deleted on shutdown               │
│    ├─ tool: list_pending_reviews(worktreePath)              │
│    └─ tool: mark_review_addressed(commentId)                │
│                                                             │
│  AgentSkillInstaller (NEW)                                  │
│    ├─ provider: claude-code (~/.claude.json + skills/)      │
│    ├─ provider: codex (~/.codex/config.toml + skills/)      │
│    └─ install / reinstall / uninstall per provider          │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP MCP
                               ↑
┌─────────────────────────────────────────────────────────────┐
│ Agent (Claude Code, Codex, …) running in user terminal      │
│  ai-14all-fix-review skill loaded by agent                  │
│   ├─ trigger: "fix review" (or similar phrasing)            │
│   ├─ resolves <userData>/ai-14all/mcp-port                  │
│   ├─ calls list_pending_reviews(<cwd worktree path>)        │
│   ├─ for each comment: snippet-search, locate, fix          │
│   └─ calls mark_review_addressed(commentId) per fix         │
└─────────────────────────────────────────────────────────────┘
```

Single source of truth: `ReviewCommentService` in main. Renderer mutates via IPC and subscribes to change events for live updates. MCP server reads/writes the same service object — no inter-process sync.

Review comments are intentionally **not** stored in `PersistedWorkspaceState` / `PersistedWorktreeSession`. The existing workspace restore state is assembled and written by the renderer as a whole snapshot; letting a main-side service also mutate that file would create overwrite races. Review comments instead live in a separate main-owned JSON store so app-mediated UI changes and MCP tool calls share one durable write path.

## Data Model

New shared model `shared/models/review-comment.ts`:

```ts
export type ReviewCommentStatus = "open" | "addressed";

export type ReviewCommentSource = "working-tree" | "commit";

export type ReviewComment = {
  id: string;                  // uuid v4
  worktreeId: string;          // scoping key
  filePath: string;            // relative to worktree root
  startLine: number;           // 1-indexed, modified side
  endLine: number;             // 1-indexed, inclusive
  snippet: string;             // modified-side text at [startLine..endLine] when commented
  body: string;                // user's review text
  status: ReviewCommentStatus; // default "open"
  source: ReviewCommentSource; // where the comment was authored from
  commitSha: string | null;    // set iff source === "commit"; null otherwise
  createdAt: string;           // ISO 8601 timestamp
  addressedAt: string | null;  // ISO 8601; set when addressed, cleared on reopen
};
```

**Anchoring strategy** (interpretation 3 from brainstorm): comments anchor to `(filePath, snippet)` primarily, with `(startLine, endLine)` as a hint. Agents must search the snippet in the current file content to locate the comment if line numbers no longer match. `source` and `commitSha` are informational provenance — they are not used for relocation, but they let the agent reason about context (e.g., "this comment was written against a 3-commits-back version; the file may have moved or been rewritten since"). When the snippet is not findable in the current file, the agent uses provenance to phrase a useful "couldn't locate" message back to the user.

**Persistence**: a new `ReviewCommentStore` persists comments to `<userData>/ai-14all/review-comments.json` using write-temp-then-rename. The file is owned by Electron main and is not written by renderer workspace persistence.

Store shape:

```ts
type PersistedReviewCommentStore = {
  version: 1;
  comments: ReviewComment[];
};
```

On missing file, the store starts as `{ version: 1, comments: [] }`. On invalid JSON or unsupported version, the service logs a diagnostic and starts with an empty in-memory store without overwriting the file, matching the existing downgrade-preservation posture used by workspace restore state. No `PersistedWorkspaceStateV3` migration is required for this feature.

**Lifecycle**:
- Create → `status: "open"`, `addressedAt: null`.
- Mark addressed (via agent tool or user click) → `status: "addressed"`, `addressedAt: <now>`.
- Reopen (user toggles) → `status: "open"`, `addressedAt: null`.
- Delete → record removed entirely (only explicit user action; addressed comments are NOT auto-deleted).

## MCP Surface

**Server name:** `ai-14all` (product-level, intentionally not tool-specific so future tools can land under the same server).

**Transport:** HTTP MCP, bound to `127.0.0.1` only.

**Strict stable port (no fallback).** The server reserves a single port that is stable across all app runs. On first boot, it picks a free port from a high-numbered range (e.g., 51000–51999) via `node:net.createServer().listen(0)` constrained to that range, then persists it in `<userData>/ai-14all/mcp-config.json` as `{ "port": <number> }`. Every subsequent boot binds the same port. If the port is unavailable at boot:

- The server does **not** silently fall back to a fresh port (a fresh port would invalidate the URL already registered in agent provider configs and silently break the agent integration).
- The boot logs a `port-unavailable` diagnostic to main.
- A persistent warning appears in the app diagnostics panel and the install modal status row: "MCP server could not bind port <N>. Resolve the port conflict and restart ai-14all to re-enable agent integration."
- The review feature still works in the UI; only the agent integration is unavailable.

Once listening, the server writes a liveness file to `<userData>/ai-14all/mcp-port` (single-line text containing the active port — same value every run). The liveness file is deleted on graceful shutdown. The skill checks this file before each call purely as a "is ai-14all running?" signal — not as port discovery.

**Tool — `list_pending_reviews`**

```
input:  { worktreePath: string }
output: {
  reviews: Array<{
    id: string;
    filePath: string;
    startLine: number;
    endLine: number;
    snippet: string;
    body: string;
    status: "open";                                  // tool only returns open comments
    source: "working-tree" | "commit";               // provenance
    commitSha: string | null;                        // set iff source === "commit"
    createdAt: string;
    addressedAt: null;
  }>;
}
```

`worktreePath` is resolved to an absolute, real path (symlinks followed) before lookup; matched against worktree absolute paths known to the app. Returns `{ reviews: [] }` if path is unknown or has no open comments. Never throws on unknown worktree.

**Tool — `mark_review_addressed`**

```
input:  { commentId: string }
output: { ok: true } | { ok: false, error: "not_found" | "already_addressed" }
```

Sets `status = "addressed"`, `addressedAt = now`. Idempotent: re-calling on an already-addressed id returns `{ ok: false, error: "already_addressed" }` so agent retries are safe.

**Auth / security:** none in v1. Localhost binding only. Documented assumption: single-user development machine. Future v2 may add a per-boot bearer token written into the port file.

**Error surfaces:** if the MCP server fails to bind a port at boot, `ReviewMcpServer` logs the failure to main and surfaces a non-blocking diagnostic in the app's diagnostics panel. The review feature still works in the UI; only the agent integration is unavailable.

## UI

The review-comment sidebar lives inside the existing `ReviewDrawer` body. It is visible when:
- `reviewMode === "changes"` AND a changed file is selected, OR
- `reviewMode === "commits"` AND a commit's file is selected (i.e., `CommitDiffStack` is showing a per-file diff).

In both cases, the same `ReviewCommentSidebar` component renders, scoped to the file currently shown in the diff viewer.

### Layout

The current `shell-review-grid` template is `[rail | resize | main]`. After this spec it becomes `[rail | resize | diff | resize | comments]`. The rightmost comments column is ~280px default, user-resizable, persisted with the worktree session UI state (added to `WorktreeSession` UI state alongside existing rail/panel widths).

### Sidebar contents

1. **Header** — `Comments — <filename> (<open count>)`. No add button (add affordances live in the diff itself).
2. **List** — comment cards, newest-first. Each card:
   - Line range label (`L42–48`), clickable → DiffViewer scrolls to that range and briefly highlights it.
   - Status pill (`open` / `addressed`).
   - Body text.
   - Footer: ✓ toggle (mark addressed / reopen) and `⋯` menu (delete).
   - Addressed cards rendered at 50% opacity.
3. **Empty state** — "No review comments. Hover a line in the diff to add one."

### Add-comment affordances (in DiffViewer)

**Hover (primary, no selection required):**
1. User hovers a line on the modified pane.
2. A `+` icon appears in that line's gutter / glyph margin.
3. Click → inline form opens at the top of the sidebar list (textarea + Save / Cancel).
4. On Save: `startLine = endLine = hovered line`, `snippet = that line's text`. Form closes; new card appears.

**Selection (supported):**
1. User drag-selects a line range on the modified pane.
2. A small floating "+ Add comment" button appears near the selection.
3. Click → same inline form opens, with `startLine`, `endLine`, and `snippet` pre-filled from the selection.

The DiffViewer remains read-only (Monaco `readOnly: true`); only gutter decorations and overlays are added.

When the comment is created, `source` and `commitSha` are populated from the current viewing context: `source: "working-tree"` (and `commitSha: null`) in changes mode; `source: "commit"`, `commitSha: <selected commit SHA>` in commits mode.

### DiffViewer integration contract

Today's `DiffViewer` (`src/features/viewer/DiffViewer.tsx`) renders a single Monaco `DiffEditor` with no `onMount` callback, refs, decorations, or scroll API. Today's `CommitDiffStack` renders one `DiffEditor` per file in the commit, all simultaneously. Both need explicit lifecycle hooks for the comment affordances to work cleanly.

This spec extends `DiffViewer` and `CommitDiffStack` with the following contract:

1. **`DiffViewer` and each `DiffEditor` inside `CommitDiffStack` accept an `onMount(filePath, editor)` callback** that fires when the Monaco editor instance is ready. The callback hands back the file path the editor is showing and the Monaco `IStandaloneDiffEditor` instance.
2. **A renderer-scoped `DiffEditorRegistry`** (a small map maintained alongside `ReviewCommentSidebar`) tracks `Map<filePath, IStandaloneDiffEditor>` for editors currently mounted. `onMount` registers; an `onUnmount(filePath)` callback (or React effect cleanup) deregisters.
3. **Per-editor gutter / hover handlers** are installed inside the editor's modified-side pane (`editor.getModifiedEditor()`) at mount time and torn down at unmount. Each editor owns its own `+` glyph decoration, hover listener, and selection listener — no global handlers.
4. **Sidebar scoping rules:**
   - In changes mode, exactly one editor is mounted at a time (the currently selected changed file). The sidebar scopes to that file.
   - In commits mode, multiple editors are mounted simultaneously inside `CommitDiffStack`. The sidebar scopes to `focusedPath` (the file the user most recently selected from `CommitList`). When the user changes `focusedPath`, the sidebar swaps content; the gutter `+` keeps working on every visible editor (each user can still hover and add a comment on any file in the stack — the new comment appears in the sidebar once the file becomes focused).
5. **Click-comment-to-scroll:** sidebar looks up the editor by `filePath` in the registry, calls `editor.getModifiedEditor().revealLineInCenter(comment.startLine)`, and applies a transient highlight decoration on `[startLine..endLine]`. If the editor is not in the registry (e.g., the file isn't currently mounted in commits mode because user is focused elsewhere), the click first sets `focusedPath` to that file (via `CommitList` selection state), then performs the scroll on the next render once the editor is mounted.
6. **Decoration / handler cleanup** uses Monaco's `editor.onDidDispose` and React effect cleanup so no listeners leak when the user switches files or commits.

### Cross-file visibility

- `ChangesList` (changes mode): a small badge `[N]` next to each file name when N open comments exist for that file.
- `CommitList` (commits mode): a small badge `[N]` next to each commit when N open comments exist for files touched by that commit (derived from the commit's file list intersected with `comments[].filePath`).

## Install

A new "Install agent integration" item appears in the app settings menu and opens a modal:

- **Header:** "Install ai-14all-fix-review skill + MCP server"
- **Per-provider rows** (each greyed if the provider's CLI is not on `PATH` *and* its config root is not detected on disk):
  - ☐ Claude Code — writes `~/.claude/skills/ai-14all-fix-review/SKILL.md` and registers the MCP server using the official CLI (preferred): `claude mcp add --transport http --scope user ai-14all <url>`. If the CLI is unavailable, falls back to a direct merge into the user-scoped Claude config file with a "best-effort, please verify" notice.
  - ☐ Codex — writes `~/.codex/skills/ai-14all-fix-review/SKILL.md` and registers the MCP server using the official CLI (preferred), e.g. `codex mcp add --url <url> ai-14all`. If the CLI is unavailable, falls back to a direct merge into `~/.codex/config.toml` with a "best-effort, please verify" notice.
- **Other agents** (expandable section): copy-paste-ready snippets — the SKILL.md content and a generic MCP server config example — for users to wire up by hand.
- **Install button** (disabled until at least one provider checked).
- **Per-provider status row** after install: `Installed ✓` / `Failed: <reason>` / `Update available` (when shipped asset version is newer than installed).

A separate "Reinstall agent integration" entry overwrites/updates installed assets; "Remove agent integration" deletes the skill folder and removes the MCP server entry while preserving all unrelated keys.

### Provider details (to verify during implementation)

The exact on-disk JSON / TOML shapes for each provider are not load-bearing for this design because the installer drives the official CLI when available. The notes below capture what the agent guide reported at brainstorm time; treat each item as "verify, then either use the CLI invocation or — only if no CLI exists — write the file directly."

**Claude Code:**
- Preferred install action: `claude mcp add --transport http --scope user ai-14all <url>`
- Preferred verification / "already installed" detection: `claude mcp get ai-14all`
- Preferred uninstall: `claude mcp remove ai-14all`
- Direct-edit fallback (only if `claude` CLI is absent on PATH): the user-scoped Claude config file (per agent-guide report: `~/.claude.json`, key `mcpServers.ai-14all`). The on-disk JSON shape **must be confirmed against the running CLI** before shipping the fallback path; the installer surfaces a "best-effort, please verify" notice in this case.
- Skill folder: `~/.claude/skills/ai-14all-fix-review/SKILL.md` with YAML frontmatter (`name`, `description` required).
- Reload: agent guide reports hot-reload inside an existing CC session for both MCP entries and skill changes. Verify and document this in the install modal so the user knows whether to restart.
- Backups: Claude Code is reported to keep timestamped backups of its config (5 retained). Installer does not manage these.

**Codex:**
- Preferred install action: `codex mcp add --url <url> ai-14all` (verify exact flag spelling and ordering against current `codex --help` before shipping).
- Preferred verification / uninstall: corresponding `codex mcp` subcommands (verify exact form).
- Direct-edit fallback (only if `codex` CLI is absent on PATH): `~/.codex/config.toml`, table `[mcp_servers.ai-14all]`. The on-disk TOML shape and HTTP-transport support **must be confirmed against the running CLI** before shipping the fallback path; the installer surfaces a "best-effort, please verify" notice in this case.
- Skill folder: `~/.codex/skills/ai-14all-fix-review/SKILL.md`. (Codex's older "custom prompts" mechanism is reported deprecated in favour of skills.)
- Reload: agent guide reports Codex requires a restart after MCP config changes. Surface this in the install-modal status row so the user knows to restart their Codex session.

### Liveness check in the skill

The MCP server uses a strict stable port (see "Transport" above), so the URL baked into the provider config is valid for the life of the install. The skill's only runtime concern is whether the app is currently running.

The skill checks `<userData>/ai-14all/mcp-port` before each tool call:
1. File missing → app is not running. The skill prints a friendly hint ("ai-14all is not running; please launch the app and try again") and stops.
2. File present → the MCP client makes its normal call against the URL already configured in the provider's MCP entry.

The file's contents (the port number) are mainly diagnostic; the skill does not read them to construct a URL. They give the user something concrete to inspect when troubleshooting.

### Atomic writes

JSON / TOML config edits use the standard write-temp-then-rename pattern. Read existing file, decode, merge, encode, write to `<file>.ai-14all.tmp`, rename over original. Skill files are written the same way to a fresh folder. No file locking — single-instance assumption. Rollback on failure: best-effort delete of partial files; user sees the per-provider error in the install modal status row.

## Lifecycle and Edge Cases

| Scenario | Behavior |
|---|---|
| File deleted from working tree but has comments | Comments still listed in sidebar. Badge on file in `ChangesList` shows even for deleted files. Sidebar shows a "file no longer exists" notice. MCP still returns them. |
| File renamed | Comments stay on old `filePath`. Snippet-search still helps the agent find new location. v1 accepts this; user can delete and re-comment. |
| Snippet no longer found in current file | MCP still returns the comment. Agent skill instructs: report back to user "couldn't locate snippet for comment X" rather than guessing. |
| User has no Monaco selection when adding | Use the gutter `+` (always available). Selection-based add is opt-in. |
| Two agents concurrently call `mark_review_addressed` on same id | `ReviewCommentService` runs single-threaded in main. First call wins; second returns `{ok:false, error:"already_addressed"}`. Agents tolerate this. |
| Agent calls tool while app is shutting down | MCP server unbound → connection refused. Skill catches and prints "ai-14all is not running." |
| App restart with addressed comments persisted | Reload via `ReviewCommentStore`. Same UI state, dimmed cards still present. |
| Worktree removed from app while comments exist | Comments removed alongside the worktree session via the existing worktree-removal flow (a hook in `ReviewCommentService` listens for worktree-removed events). |
| Multiple app instances | Last-launched instance wins the port file; earlier instance still runs but agents won't find it. Acceptable per single-instance assumption. |
| MCP server fails to bind reserved port at boot | Logged to main as `port-unavailable`. Persistent diagnostic appears in the diagnostics panel and install-modal status row. **No fallback to a fresh port** (would invalidate URLs already registered in agent configs). UI review feature continues to work. User must resolve the port conflict and restart ai-14all. |
| IPC failure from renderer (rare) | Toast: "Could not save review comment" with a retry hint. Local optimistic state is rolled back. |

## Testing Strategy

### Unit tests

- `services/review/review-comment-service.test.ts` — CRUD per worktree, status transitions (open ↔ addressed), idempotency of `markAddressed`, hook into worktree-removed events.
- `services/review/review-comment-store.test.ts` — missing file defaults to an empty v1 store; valid v1 store loads; invalid JSON / unsupported version logs a diagnostic and preserves the existing file; writes use temp-then-rename.
- `tests/unit/review/use-review-comments.test.ts` — renderer hook over IPC mock; create, list, markAddressed, reopen, delete; live update via change events.
- `tests/unit/review/ReviewCommentSidebar.test.tsx` — rendering open vs addressed cards, dim styling on addressed, click-to-scroll handler called with correct line range, empty state.
- `tests/unit/review/diff-gutter-add-handler.test.ts` — hover line N → `+` shown → click → calls add with `{filePath, startLine: N, endLine: N, snippet: <line content>}`.
- `tests/unit/review/selection-add-handler.test.ts` — Monaco selection range → floating button → click → calls add with selection's range and snippet.
- `tests/unit/review/review-mcp-server.test.ts` — server boot writes port file; `list_pending_reviews` filters by `worktreePath` and returns only open; `mark_review_addressed` toggles status and is idempotent on duplicate calls.
- `tests/unit/review/agent-skill-installer.test.ts` — Claude provider install writes the skill file and invokes `claude mcp add` with the expected args (CLI mocked); detects "already installed" via `claude mcp get`; uninstall invokes `claude mcp remove`; CLI-absent fallback writes/merges the configured config file without dropping unrelated keys. Same coverage shape for Codex.

### E2E tests (accumulate per AGENTS.md verification rule)

- `tests/e2e/review-comments.test.ts`:
  - Add comment via gutter `+` → sidebar card appears, `ChangesList` badge increments.
  - Add comment via selection → range matches selection.
  - Comment persists across renderer reload (terminal-resilience pattern).
  - Mark addressed via ✓ → card dims; reopen → un-dims.
  - Delete → card and badge gone.
  - Same flow in commits mode (select commit → file → add via gutter).
- `tests/e2e/review-mcp.test.ts`:
  - Spawn an in-process MCP client (using `@modelcontextprotocol/sdk` client) → `list_pending_reviews` returns the comment created in UI.
  - Client calls `mark_review_addressed` → sidebar card live-updates to addressed.
- `tests/e2e/agent-skill-install.test.ts`:
  - Open install modal with the Claude CLI stubbed on `PATH` → install runs `claude mcp add` with the expected arguments and writes the skill file under the temp `~/.claude/skills/` dir.
  - With the Claude CLI absent → install takes the direct-edit fallback path; assert the configured fallback file is written without dropping unrelated keys, and the install row shows the "best-effort, please verify" notice.
  - Reinstall and uninstall flows mirror the above for both CLI-present and CLI-absent paths.

### Deferred to manual smoke

- Live integration with a real Claude Code or Codex agent invoking the skill end-to-end (manual smoke test at implementation time).
- Snippet-relocation behavior under real edits (covered in skill markdown; no automated test in v1).

## Out of Scope (deferred to v2)

- GitHub-style inline-between-code threaded comments (chosen B over A in brainstorm; A remains a future upgrade).
- Original-side commenting (removed-line feedback).
- Commit-SHA-anchored comments (we picked file+snippet anchoring).
- Multi-instance support and per-instance port discovery.
- MCP auth tokens.
- Bulk operations and import/export.
- Diff-data tools on the MCP surface (`read_diff`, `read_changed_files`); agent uses `git diff` if needed.

## Verification Notes (resolve during implementation)

- Confirm `claude mcp add` flag spelling and behavior on the currently shipped Claude Code CLI (`--transport http`, `--scope user`, server-name + URL ordering). Use `claude mcp add --help`. Same for `claude mcp get` and `claude mcp remove`.
- Confirm `codex mcp add` flag spelling and behavior on the currently shipped Codex CLI; equivalent for verification and removal subcommands.
- Confirm exact JSON shape Claude Code expects on disk for an HTTP MCP server entry (only needed for the CLI-absent fallback). Agent guide reported `{ "command": "http", "url": "..." }`; verify before shipping fallback.
- Confirm Codex's exact TOML schema for HTTP MCP servers on disk (only needed for the CLI-absent fallback).
- Confirm Monaco's hover / glyph-margin event API supports a per-line `+` decoration cleanly inside `DiffEditor` (its API differs from `Editor`); fall back to a hover-to-show overlay button if needed.
- Confirm the separate `ReviewCommentStore` path is included in app diagnostics / backup guidance where appropriate; no workspace-state migration is expected for this feature.
