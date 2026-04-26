---
name: ai-14all-fix-review
description: Fetch and address review comments authored in the ai-14all desktop app for the current worktree. Use when the user says "fix review", "fix pending review", or otherwise asks to act on review feedback collected in ai-14all.
---

# ai-14all-fix-review

You have access to an MCP server named `ai-14all` (registered by the ai-14all desktop app). It exposes two tools:

- `list_pending_reviews({ worktreePath: string })` — returns `{ reviews: ReviewComment[] }` for the worktree at the given path. Each review has `id`, `filePath`, `startLine`, `endLine`, `snippet`, `body`, `source ("working-tree" | "commit")`, `commitSha`, `createdAt`.
- `mark_review_addressed({ commentId: string })` — call after you have applied the fix for a comment. Returns `{ ok: true }` or `{ ok: false, error: "not_found" | "already_addressed" }`.

## How to apply this skill

1. Confirm the desktop app is running by checking that `<userData>/ai-14all/ai-14all/mcp-port` exists. (`<userData>` is the OS-conventional Electron userData dir: `~/Library/Application Support/ai-14all/` on macOS, `%APPDATA%\\ai-14all\\` on Windows, `~/.config/ai-14all/` on Linux.) If the file is missing, tell the user "ai-14all is not running; please launch the app and try again," and stop.
2. Determine the worktree path you are running inside (the working directory of your current session).
3. Call `list_pending_reviews({ worktreePath })`.
4. For each returned review:
   - Locate the review's `snippet` in the current contents of `filePath`.
     - If it appears verbatim, use those lines (the `startLine`/`endLine` are hints from comment time and may be stale).
     - If it does not appear verbatim, do not guess. Tell the user: "Could not locate snippet for comment <id> on <filePath>. The file may have changed since the comment was written." Skip this comment.
   - Apply the fix described in `body` using your normal edit tools.
   - Call `mark_review_addressed({ commentId })`. If the response is `{ ok: false, error: "already_addressed" }`, treat as success (someone else marked it; idempotent).
5. After processing every review, summarise to the user: how many were addressed, how many were skipped, and why.

## What `source` and `commitSha` mean

- `source: "working-tree"` — comment was written against the user's current uncommitted changes. Apply edits to the working tree.
- `source: "commit"` with `commitSha` set — comment was written while the user was reviewing an older commit. The file may have moved or been rewritten since. Use snippet-search to locate; if not found, surface the `commitSha` to the user so they can decide whether to amend, fix-forward, or dismiss.

## Constraints

- Do not invent reviews. If `list_pending_reviews` returns `{ reviews: [] }`, tell the user "No pending review comments for this worktree."
- Always call `mark_review_addressed` after a successful fix — never assume the app will detect it from the diff.
- Do not propose changes to ai-14all's review state via any other channel; the MCP tools above are the only sanctioned interface.
