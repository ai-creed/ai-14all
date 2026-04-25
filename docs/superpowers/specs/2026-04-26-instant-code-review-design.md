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
│    ├─ persists via WorkspacePersistenceService (existing)   │
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

## Data Model

New shared model `shared/models/review-comment.ts`:

```ts
export type ReviewCommentStatus = "open" | "addressed";

export type ReviewComment = {
  id: string;                  // uuid v4
  worktreeId: string;          // scoping key
  filePath: string;            // relative to worktree root
  startLine: number;           // 1-indexed, modified side
  endLine: number;             // 1-indexed, inclusive
  snippet: string;             // modified-side text at [startLine..endLine] when commented
  body: string;                // user's review text
  status: ReviewCommentStatus; // default "open"
  createdAt: string;           // ISO 8601 timestamp
  addressedAt: string | null;  // ISO 8601; set when addressed, cleared on reopen
};
```

**Anchoring strategy** (interpretation 3 from brainstorm): comments anchor to `(filePath, snippet)` primarily, with `(startLine, endLine)` as a hint. Agents must search the snippet in the current file content to locate the comment if line numbers no longer match. This unifies working-tree comments and commit-mode comments under one schema — no commit-SHA tagging needed.

**Persistence**: a new `reviewComments: ReviewComment[]` field is added to `PersistedWorktreeSession`. The existing `WorkspacePersistenceService` schema is bumped from `PersistedWorkspaceStateV2` to a new `PersistedWorkspaceStateV3` with a migration that defaults the new field to `[]` for V1/V2 states. No other fields change.

**Lifecycle**:
- Create → `status: "open"`, `addressedAt: null`.
- Mark addressed (via agent tool or user click) → `status: "addressed"`, `addressedAt: <now>`.
- Reopen (user toggles) → `status: "open"`, `addressedAt: null`.
- Delete → record removed entirely (only explicit user action; addressed comments are NOT auto-deleted).

## MCP Surface

**Server name:** `ai-14all` (product-level, intentionally not tool-specific so future tools can land under the same server).

**Transport:** HTTP MCP, bound to `127.0.0.1` only. The server attempts to bind a port reserved at first boot (persisted in `<userData>/ai-14all/mcp-config.json` as `{ "port": <number> }`). If the reserved port is unavailable, it picks a fresh free port via `node:net.createServer().listen(0)`, persists the new value, and surfaces a "Reinstall agent integration" hint in the install modal. Once listening, the server writes a liveness file to `<userData>/ai-14all/mcp-port` (single-line text containing the active port). The liveness file is deleted on app shutdown.

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
    status: "open";       // tool only returns open comments
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

### Cross-file visibility

- `ChangesList` (changes mode): a small badge `[N]` next to each file name when N open comments exist for that file.
- `CommitList` (commits mode): a small badge `[N]` next to each commit when N open comments exist for files touched by that commit (derived from the commit's file list intersected with `comments[].filePath`).

## Install

A new "Install agent integration" item appears in the app settings menu and opens a modal:

- **Header:** "Install ai-14all-fix-review skill + MCP server"
- **Per-provider rows** (each greyed if the provider's config root is not detected on disk):
  - ☐ Claude Code — writes `~/.claude/skills/ai-14all-fix-review/SKILL.md` and merges an entry into `~/.claude.json`'s `mcpServers` map.
  - ☐ Codex — writes `~/.codex/skills/ai-14all-fix-review/SKILL.md` and merges an entry into `~/.codex/config.toml`'s `[mcp_servers.ai-14all]` table.
- **Other agents** (expandable section): copy-paste-ready snippets — the SKILL.md content and a generic MCP server config example — for users to wire up by hand.
- **Install button** (disabled until at least one provider checked).
- **Per-provider status row** after install: `Installed ✓` / `Failed: <reason>` / `Update available` (when shipped asset version is newer than installed).

A separate "Reinstall agent integration" entry overwrites/updates installed assets; "Remove agent integration" deletes the skill folder and removes the MCP server entry while preserving all unrelated keys.

### Provider details (verified)

**Claude Code:**
- MCP config file: `~/.claude.json` (single file containing OAuth, project state, and `mcpServers` map).
- HTTP MCP entry shape:
  ```json
  {
    "mcpServers": {
      "ai-14all": { "command": "http", "url": "http://127.0.0.1:<port>" }
    }
  }
  ```
- Skill folder: `~/.claude/skills/ai-14all-fix-review/SKILL.md` with YAML frontmatter (`name`, `description` required).
- Reload: hot-reloaded inside an existing CC session — no restart required for either MCP entries or skill changes.
- File backups: Claude Code keeps timestamped backups of `~/.claude.json` (5 retained). Installer does not need to manage these.

**Codex:**
- MCP config file: `~/.codex/config.toml`. HTTP MCP supported via `url` (and optional `bearer_token_env_var` / `http_headers`).
- Entry shape:
  ```toml
  [mcp_servers.ai-14all]
  url = "http://127.0.0.1:<port>"
  ```
- Skill folder: `~/.codex/skills/ai-14all-fix-review/SKILL.md`. (Codex's older "custom prompts" mechanism is deprecated; skills are the supported successor.)
- Reload: **Codex requires a restart after `config.toml` changes**. Skills are auto-detected; restart only if a new top-level skills dir was created.

### Port file readout in the skill

Because the MCP `url` baked into the provider config carries a port that may change across app restarts, the skill itself must resolve the live port before each call:

1. Read `<userData>/ai-14all/mcp-port` (path is OS-conventional; documented in skill).
2. If the file is missing → report "ai-14all is not running" and stop.
3. Otherwise call the MCP server using the URL it read.

**Decision for v1: reserve a stable port across runs.** The app picks a random free port the first time it boots and persists it to `<userData>/ai-14all/mcp-config.json` as `{ "port": <number> }`. Subsequent boots try to bind that same port; if it is busy, fall back to a fresh random port, update the persisted config, and surface a non-blocking notice in the install modal status row so the user knows to "Reinstall agent integration" to refresh the URL in their provider configs.

This avoids relying on agent MCP clients re-reading the URL per call (behavior varies by client and is not guaranteed). The port file at `<userData>/ai-14all/mcp-port` still exists as a runtime liveness signal the skill checks before each call (missing → "ai-14all is not running"); but the URL baked into provider configs is intended to remain valid for the life of the install.

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
| App restart with addressed comments persisted | Reload via `WorkspacePersistenceService`. Same UI state, dimmed cards still present. |
| Worktree removed from app while comments exist | Comments removed alongside the worktree session via the existing worktree-removal flow (a hook in `ReviewCommentService` listens for worktree-removed events). |
| Multiple app instances | Last-launched instance wins the port file; earlier instance still runs but agents won't find it. Acceptable per single-instance assumption. |
| MCP server fails to bind at boot | Logged to main, surfaced in diagnostics. UI review feature continues to work. Install modal shows a warning if user opens it. |
| IPC failure from renderer (rare) | Toast: "Could not save review comment" with a retry hint. Local optimistic state is rolled back. |

## Testing Strategy

### Unit tests

- `services/review/review-comment-service.test.ts` — CRUD per worktree, status transitions (open ↔ addressed), idempotency of `markAddressed`, hook into worktree-removed events, persistence schema migration.
- `tests/unit/review/use-review-comments.test.ts` — renderer hook over IPC mock; create, list, markAddressed, reopen, delete; live update via change events.
- `tests/unit/review/ReviewCommentSidebar.test.tsx` — rendering open vs addressed cards, dim styling on addressed, click-to-scroll handler called with correct line range, empty state.
- `tests/unit/review/diff-gutter-add-handler.test.ts` — hover line N → `+` shown → click → calls add with `{filePath, startLine: N, endLine: N, snippet: <line content>}`.
- `tests/unit/review/selection-add-handler.test.ts` — Monaco selection range → floating button → click → calls add with selection's range and snippet.
- `tests/unit/review/review-mcp-server.test.ts` — server boot writes port file; `list_pending_reviews` filters by `worktreePath` and returns only open; `mark_review_addressed` toggles status and is idempotent on duplicate calls.
- `tests/unit/review/agent-skill-installer.test.ts` — Claude provider install writes skill file and merges into `~/.claude.json` without dropping unrelated keys; Codex provider install writes skill and TOML entry; uninstall removes both; reinstall replaces existing.

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
  - Open install modal, select Claude provider, install → temp `~/.claude.json` has `mcpServers["ai-14all"]` entry; temp skills dir has `ai-14all-fix-review/SKILL.md`.
  - Reinstall path detected via per-provider status row.
  - Uninstall removes assets without touching unrelated keys.

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

- Confirm exact JSON shape Claude Code expects for an HTTP MCP server entry (the agent guide reported `{ "command": "http", "url": "..." }`; verify against the running CLI's accepted schema or its example configs before shipping the installer).
- Confirm Codex's exact TOML schema for HTTP MCP servers (additional fields beyond `url` may be required or recommended).
- Confirm Monaco's hover / glyph-margin event API supports a per-line `+` decoration cleanly inside `DiffEditor` (its API differs from `Editor`); fall back to a hover-to-show overlay button if needed.
- Confirm the existing `WorkspacePersistenceService` migration pattern accommodates a simple additive field for `reviewComments`; if it does not, a small extension to the migration framework is part of this work.
