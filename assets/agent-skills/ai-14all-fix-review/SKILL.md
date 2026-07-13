---
name: ai-14all-fix-review
description: Use when the user says "fix review", "fix pending review", or asks to act on review comments authored in the ai-14all desktop app — fetching pending comments for the current worktree over MCP, applying each fix, and marking them addressed.
version: 0.1.0
---

# ai-14all-fix-review

## Intent

Act on code-review comments the user authored in the ai-14all desktop app:
fetch every pending comment for the current worktree, apply the requested fix,
and mark each one addressed. The app's MCP server (`ai-14all`) is the only
sanctioned interface to review state; it exposes two tools:

- `list_pending_reviews({ worktreePath: string })` — returns
  `{ reviews: ReviewComment[] }` for the worktree at the given path. Each
  review has `id`, `filePath`, `startLine`, `endLine`, `snippet`, `body`,
  `source ("working-tree" | "commit")`, `commitSha`, `createdAt`.
- `mark_review_addressed({ commentId: string })` — call after applying the fix
  for a comment. Returns `{ ok: true }` or
  `{ ok: false, error: "not_found" | "already_addressed" }`.

## Inputs

- The worktree path of the current session (the working directory you are
  running inside) — passed as `worktreePath`.
- Optional: a user-named subset of files or comments to address first.

## Preconditions

- The ai-14all desktop app is running: `<userData>/ai-14all/ai-14all/mcp-port`
  exists. (`<userData>` is the OS-conventional Electron userData dir:
  `~/Library/Application Support/ai-14all/` on macOS, `%APPDATA%\\ai-14all\\`
  on Windows, `~/.config/ai-14all/` on Linux.) If the file is missing, tell
  the user "ai-14all is not running; please launch the app and try again,"
  and stop.
- The `ai-14all` MCP server is registered in the current session.
- The worktree's files are editable with your normal edit tools.

## Procedure

1. Determine the worktree path you are running inside.
2. Call `list_pending_reviews({ worktreePath })`.
3. For each returned review:
   - Locate the review's `snippet` in the current contents of `filePath`.
     - If it appears verbatim, use those lines (the `startLine`/`endLine` are
       hints from comment time and may be stale).
     - If it does not appear verbatim, do not guess. Tell the user: "Could not
       locate snippet for comment <id> on <filePath>. The file may have
       changed since the comment was written." Skip this comment.
   - Apply the fix described in `body` using your normal edit tools.
   - Call `mark_review_addressed({ commentId })`. If the response is
     `{ ok: false, error: "already_addressed" }`, treat as success (someone
     else marked it; idempotent).
4. After processing every review, summarise to the user: how many were
   addressed, how many were skipped, and why.

### What `source` and `commitSha` mean

- `source: "working-tree"` — the comment was written against the user's
  current uncommitted changes. Apply edits to the working tree.
- `source: "commit"` with `commitSha` set — the comment was written while the
  user was reviewing an older commit. The file may have moved or been
  rewritten since. Use snippet-search to locate; if not found, surface the
  `commitSha` to the user so they can decide whether to amend, fix-forward,
  or dismiss.

## Output

- Fixes applied to the working tree, one per addressed comment, and each
  addressed comment marked via `mark_review_addressed`.
- A final summary: how many comments were addressed, how many were skipped,
  and why each skip happened.
- When `list_pending_reviews` returns `{ reviews: [] }`: the exact message
  "No pending review comments for this worktree." and nothing else.

## Examples

Input: the user says "fix the pending reviews". `list_pending_reviews` returns
one comment: `{ id: "rc-42", filePath: "src/auth.ts", snippet: "if (token ===
stored)", body: "use a constant-time comparison here", source:
"working-tree" }`.

The agent finds the snippet verbatim in `src/auth.ts`, replaces the comparison
with a constant-time equality check, then calls
`mark_review_addressed({ commentId: "rc-42" })` and receives `{ ok: true }`.

Output: "1 review addressed (rc-42: constant-time comparison in src/auth.ts),
0 skipped."

## Anti-patterns

- Inventing reviews when the list is empty — report the empty state verbatim.
- Guessing at a stale snippet's location instead of skipping and reporting it.
- Skipping `mark_review_addressed` after a successful fix — never assume the
  app detects fixes from the diff.
- Touching ai-14all's review state through any channel other than the two MCP
  tools above.
- Trusting `startLine`/`endLine` over the snippet text — the line numbers are
  hints, the snippet is the anchor.
