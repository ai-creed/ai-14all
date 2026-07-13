# Persistent Settings, Restore-All Workspaces, and Agent Conversation Resume — Design

**Date:** 2026-07-05
**Status:** Approved design, pending implementation plan
**Scope:** One coherent design covering three subsystems that share the persistence layer:

- **A. Persistent user settings** — a schema'd, main-process-owned settings store with a Settings UI.
- **B. Restore all workspaces on restart** — background hydration of every saved workspace, replacing the "Open this workspace to load its worktree sessions" placeholder.
- **C. Agent conversation resume** — restored agent panes reopen their previous CLI conversation after a full app restart.

## 1. Context

Today the app persists a multi-workspace snapshot (`PersistedWorkspaceStateV2`, `<userData>/workspace-state.json`) via `WorkspacePersistenceService` — atomic unique-temp-file writes, serialized write chain, zod-validated versioned schema. The storage already holds every workspace; the gap is the restore path:

- On startup only the **active** workspace is hydrated (`use-startup-restore.ts` → `use-workspace-lifecycle.ts`). Other saved workspaces register as `dormant` (no worktrees, `workspaceState: null`) and the sidebar shows a placeholder until clicked.
- Within the restored workspace, only the **selected** worktree's terminals are recreated; other worktrees' sessions wait in `pendingRestoreSessions` and spawn on first visit.
- After a full quit, PTYs are dead. `recreatePersistedProcesses` spawns a fresh terminal and re-types the stored `command` — an agent relaunches as a **fresh** conversation; history is lost. (A renderer reload is different: the main process still owns the PTYs and the renderer adopts them.)
- User preferences are scattered: `restorePreference` and `usageTelemetry` live in the workspace-state file; terminal font size, collapsed workspaces, expanded processes, and onboarding flags live in renderer localStorage; **theme mode is not persisted at all** (`use-theme.ts` boots to `"system"` every launch).

## 2. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | One design covering all three subsystems, implemented in stages | They share the persistence layer; behavior choices (D4) become settings (A), so designing them together avoids interface mismatch. |
| D2 | Restore depth: **state eager, terminals lazy** | Sidebar shows real sessions everywhere without a PTY/agent spawn storm at boot. A `restoreDepth` setting preserves the old behavior as `"activeOnly"`. |
| D3 | Agent resume via **agent self-report** over the session-status channel — no per-provider resume strategies in app code | Per-provider logic is too much to maintain, and launcher chips are only one spawn path (hand-typed CLI launches are common). Session-status reporting is already supported for claude/codex/ezio. Recorded as memory `mem-2026-07-04-agent-conversation-resume-uses-agent-16863d`. |
| D4 | Resume trigger governed by a user setting `agentResume: "auto" \| "manual" \| "off"`, default `"auto"` | Resuming opens the conversation idle — the agent does not act until prompted — so auto is safe; the setting covers taste. |
| D5 | Settings = new prefs file + Settings UI; ephemeral view state stays in localStorage | User-facing preferences get a schema'd, versioned, main-process-owned store. Collapsed/expanded/onboarding flags gain nothing from migration. |
| D6 | Architecture approach: extend existing seams (settings service mirrors `WorkspacePersistenceService`; hydration reuses `activateWorkspace` internals; resume handle rides the existing snapshot pipeline) | Maximum reuse of proven in-repo patterns; a separate main-process resume registry was rejected — the crash window it protects against is negligible given snapshot write frequency. |

## 3. Subsystem A — Persistent settings

### 3.1 Store

New `services/settings/settings-service.ts`, modeled 1:1 on `WorkspacePersistenceService`: zod-validated, versioned schema, atomic writes to a unique temp file followed by rename, serialized write chain. File: `<userData>/settings.json`.

Schema v1 in `shared/models/persisted-settings.ts`:

```ts
export const PersistedSettingsV1Schema = z.object({
  version: z.literal(1),
  theme: z.enum(["light", "dark", "system", "warm", "tui"]).default("system"),
  terminalFontSize: z.number().int().min(8).max(32).default(13), // DEFAULT_TERMINAL_FONT_SIZE
  restorePreference: RestorePreferenceSchema.default("prompt"),
  restoreDepth: z.enum(["stateEagerTerminalsLazy", "activeOnly"])
    .default("stateEagerTerminalsLazy"),
  agentResume: z.enum(["auto", "manual", "off"]).default("auto"),
  usageTelemetry: UsageTelemetrySettingsSchema, // moves here from workspace state
});
```

Read semantics mirror the workspace persistence service: missing file → defaults; corrupt JSON → overwrite with defaults; valid JSON that matches no known schema (newer app version) → serve defaults **without** overwriting, so data survives a downgrade.

### 3.2 IPC

Preload gains a `settings` namespace mirroring the `workspace` one:

- `settings.initial: PersistedSettingsV1` — fetched **synchronously** by the preload script once at window load (`ipcRenderer.sendSync("settings:readSync")`), so theme and font size are available before first paint with no flash of defaults. One sync IPC call at boot only; all later reads are async.
- `settings.read(): Promise<{ settings: PersistedSettingsV1, firstRun: boolean }>` → `ipcRenderer.invoke("settings:read")`; `firstRun` is true when `settings.json` was created (seeded) by this read
- `settings.write(patch: Partial<...>): Promise<PersistedSettingsV1>` → merge-and-write in main, returns the merged result
- `events.onSettingsChanged(cb)` — main broadcasts after every successful write so all windows, the application menu, and main-process consumers stay in sync

### 3.3 Migration (read-both, write-new)

On first read when `settings.json` is absent, main seeds it from legacy sources:

- `restorePreference`, `usageTelemetry` ← `workspace-state.json` (main-process read, part of seeding)
- `terminalFontSize` ← localStorage is renderer-only, so main seeds the default; when `settings.read()` reports `firstRun: true` and localStorage holds a legacy value, the renderer writes it through once via `settings.write`
- `theme` ← starts at `"system"`; there is nothing to migrate because it was never saved

Legacy fields remain in `workspace-state.json` untouched so old app versions keep working after a downgrade; new code simply stops reading them.

### 3.4 Consumers

- `useTheme`: lazy initializer reads `settings.initial.theme` (synchronous, no flash), `setTheme` writes through to the store. Application-menu theme picks flow through the same write path.
- `useTerminalFontSize`: reads/writes settings; retains its localStorage read as a first-run fallback for migration.
- Startup restore prompt and usage chips read `restorePreference` / `usageTelemetry` from settings.
- New consumers: hydration queue reads `restoreDepth`; `recreatePersistedProcesses` reads `agentResume`.

### 3.5 Settings UI

A settings dialog opened from the existing sidebar footer (where the theme trigger lives). Grouped rows following the app's TUI design language (constraint applies to ALL themes): square corners (`--radius: 0`), solid full-opacity separators, monospace `--font-ui`, Nerd Font glyphs, flat surfaces without drop shadows — extract tokens from `src/styles/tokens.css` / `src/app/shell.css` when implementing. Groups:

- **Appearance** — theme, terminal font size
- **Startup** — restore preference (prompt / always restore / always start clean), restore depth (all workspaces / active only)
- **Agents** — conversation resume (auto / manual / off)
- **Usage** — telemetry toggles (enabled, include untracked, chip range)

View state (collapsed workspaces, expanded processes, onboarding/coachmark progress, dismissals) intentionally stays in localStorage.

## 4. Subsystem B — Restore all workspaces

### 4.1 Startup sequence

Unchanged through "active workspace interactive": read persisted state → restore the active workspace (existing `restoreWorkspace`) → its selected worktree's terminals recreate → startup mode `ready`. Then, if `restoreDepth === "stateEagerTerminalsLazy"`, the background hydration queue starts. `"activeOnly"` reproduces today's behavior exactly.

### 4.2 Hydration queue

Sequential — one workspace at a time, in `workspaceOrder`, skipping the active workspace — to avoid a git-subprocess storm. Per workspace, `hydrateWorkspace(id)` is a non-selecting sibling of `activateWorkspace` reusing its steps:

1. `workspace.openRepository(rootPath)` → canonical workspace id + repository
2. `repository.listWorktrees(id)`
3. Rebase + reconcile the saved snapshot (`rebaseSnapshotPaths`, `reconcileSnapshotToWorktrees`, review-comment id rebase)
4. Build state via the `workspace/restoreSnapshot` reducer action
5. Register with `hydrationState: "inactiveLive"` — **no** `workspace/select`, **no** terminal recreation
6. Add all of the workspace's saved sessions to the pending-restore map

Writes into non-active workspaces use the existing `scopedDispatch` pattern (built for exactly this case in `activateWorkspace`). If the user clicks a still-dormant workspace mid-queue, the existing `activateWorkspace` path runs immediately; the queue skips entries that are no longer dormant. If the canonical id returned by `openRepository` differs from the saved id, the existing remove-stale dedup applies.

The sidebar drops the placeholder for hydrated workspaces and renders their real worktree session rows; selecting a row in an inactive workspace keeps its current expand-and-select behavior.

### 4.3 Terminals lazy

`pendingRestoreSessions` (worktreeId → saved session) extends to hold entries for all hydrated workspaces. Worktree ids are absolute paths, hence globally unique, so the flat map is sufficient. First visit to a worktree fires `recreatePersistedProcesses` for it (adopt live PTY when present — renderer reload; otherwise fresh spawn + command replay per Subsystem C) and clears the entry.

### 4.4 Failure handling

- `openRepository` fails (path deleted, not a repo) → workspace stays `dormant` with `loadError` set; sidebar shows the error state; the saved snapshot is **not** dropped from disk; queue continues. Clicking retries via `activateWorkspace`.
- Quit mid-queue → unhydrated workspaces persist via their untouched `persistedSnapshot` passthrough; nothing is lost.
- Worktree missing at hydration → its saved session stays in the pending map and is re-serialized on every persist write (existing mechanic), so it is never silently dropped.
- The queue aborts on app quit; the persistence write chain serializes any in-flight snapshot writes.

## 5. Subsystem C — Agent conversation resume

### 5.1 Attribution: PTY env var

`TerminalService.createSession` injects `AI14ALL_TERMINAL_SESSION_ID=<terminalSessionId>` into the PTY's environment (the spawn call already passes an env object). Every process in the pane inherits it — chip-launched, hand-typed, or nested. This makes report-to-pane attribution exact with zero launch-path coupling.

### 5.2 Self-report contract

New MCP tool on the ai-14all server, sibling of `report_session_status`, reusing the same bridge pipeline to the renderer:

```
register_agent_session({
  worktreePath: string,        // as with all worktree-scoped tools
  terminalSessionId: string,   // from $AI14ALL_TERMINAL_SESSION_ID
  provider: string,            // "claude" | "codex" | "ezio" | … (informational)
  resumeCommand: string,       // complete resume invocation, e.g. "claude --resume <uuid>"
})
```

Called once at agent session start, per updated skill instructions. The agent reports a complete, **opaque** `resumeCommand` — each agent knows its own CLI. How an agent learns its own session id (claude: hook-exposed `session_id`; codex/ezio: their own mechanisms) lives in the per-agent skill text, not in app code. The app stores and replays; it never constructs resume commands.

A dedicated tool (rather than extra fields on `report_session_status`) because a resumable conversation exists even if no status is ever pushed, and lifecycle pushes stay lean.

### 5.3 Storage

Bridge delivers the report to the renderer; exact match on `terminalSessionId` against process sessions (which already store it); the matched process session gets `resumeCommand`. Persistence rides the existing snapshot pipeline: one new optional field on `PersistedProcessSessionSchema`:

```ts
resumeCommand: z.string().nullable().optional().default(null)
```

Old snapshots parse unchanged (field absent → `null`); old app versions ignore the field.

A second report for the same pane (e.g. a new agent launched in it) overwrites the handle — latest wins.

### 5.4 Replay

In `recreatePersistedProcesses`, **fresh-create path only** (the adopt path means the PTY survived and the conversation never died):

- `agentResume === "auto"` → type `resumeCommand` instead of `command` when present
- `agentResume === "manual"` → spawn the plain shell; the pane shows a "Resume conversation" affordance that types the command on click
- `agentResume === "off"` → today's behavior (`command` replay, fresh conversation)

Resume opens the conversation idle — no agent starts working uninvited. A stale or provider-GC'd session produces the CLI's own error message; the pane still has a live shell.

### 5.5 Safety validation

`resumeCommand` is agent-authored text the app will later type into an interactive shell (the replay path uses the same input-typing mechanism as today's command replay) — an injection surface. Validation is a **character allowlist**, not a metacharacter blacklist: blacklists leak (newline, carriage return, a single `&`, `||`, redirection, quotes, variable expansion would all have slipped past an enumerated deny list). The contract:

- The entire string must match `^[A-Za-z0-9 ._/:=@-]+$` — letters, digits, space, and `. _ / : = @ -` only. Every shell control operator and control character (`;`, `&`, `|`, backticks, `$`, parentheses, quotes, `<`, `>`, `#`, `!`, `*`, `?`, `~`, newline, carriage return, tab, NUL, all other bytes) is thereby unrepresentable, rather than enumerated. Legitimate resume invocations (`<binary> <subcommand|flags> <uuid-ish id>`) fit comfortably. Widening the set later is a deliberate schema change; it must never reintroduce characters with shell meaning.
- First token must be a known agent binary (the provider registry serves as allowlist — used for validation only, not per-provider strategy)
- Length cap (256 chars)

Enforced at report time (main process; invalid reports rejected with an error result and logged via the attention logger) and re-validated immediately before replay (defense in depth — a stored handle is re-checked even if it predates a rule change).

### 5.6 Version skew

- Old skill + new app → no report, no resume; everything else works.
- New skill + old app → tool absent; skills already silently skip missing tools.
- The `ai-14all-session-status` skill asset and the MCP server instructions string are updated together; distribution uses the existing agent-skill-installer flow.

## 6. Error handling summary

| Area | Failure | Behavior |
|------|---------|----------|
| Settings | Corrupt JSON | Overwrite with defaults |
| Settings | Newer schema (downgrade) | Serve defaults, do not overwrite |
| Settings | Migration source unreadable | Field starts at default |
| Restore-all | Repo path gone | `loadError`, snapshot preserved, queue continues |
| Restore-all | Quit mid-queue | Unhydrated snapshots persist untouched |
| Restore-all | Worktree missing | Session stays in pending map, re-serialized |
| Resume | Unknown `terminalSessionId` | `no_terminal` error result; skill skips |
| Resume | Validation failure | Report dropped + logged; error result |
| Resume | Stale/GC'd agent session | Agent CLI's own error; shell remains usable |
| Resume | Renderer reload | Adopt path; no replay; handle retained |

## 7. Testing

**Unit** (mirroring `tests/unit/workspace/workspace-persistence*.test.ts` patterns; reuse existing helpers where they fit):

- `settings-service`: read/write/corrupt/newer-schema/write-chain; migration seeding matrix
- Resume-command validation: character-allowlist regex, binary allowlist, length — table-driven, with explicit negative cases for newline, carriage return, single `&`, `&&`, `||`, `;`, pipes, redirection (`<`, `>`), backticks, `$(`, `$VAR`, quotes, and tab
- Hydration queue: order, skip-active, skip-hydrated-mid-queue, error-continues, abort-on-quit
- Reducer + snapshot round-trip with `resumeCommand`; old-snapshot parse (absent → null)
- Pending-map behavior across multiple workspaces

**Integration:** `register_agent_session` → bridge → renderer state, through the existing MCP HTTP harness.

**E2E** (existing fixtures `create-test-repo` / `close-app`; stub agent binary in `tests/stubs/`):

1. Two repos open → quit → relaunch → both workspaces' sessions visible without clicks; placeholder absent
2. Switching to a background-hydrated workspace spawns terminals on first visit only
3. Theme + font size changed → restart → applied at boot without a flash of defaults
4. Stub agent registers a resume handle via MCP → restart → `auto` types the resume command; `manual` shows the affordance; `off` does neither

Full e2e suite to green before any release tag (standing rule).

## 8. Implementation staging

Each stage lands independently shippable:

1. **Settings foundation** — schema, service, IPC, migration, Settings UI; `useTheme` and `useTerminalFontSize` rewired. (Fixes the unpersisted-theme gap immediately.)
2. **Restore-all** — hydration queue, `inactiveLive` sidebar rendering, multi-workspace pending map; gated by `restoreDepth`.
3. **Agent resume** — env var injection, MCP tool + bridge, snapshot field, replay + affordance, skill update; gated by `agentResume`.

## 9. Items to verify during planning/implementation

Per the standing rule to cross-check concrete claims against authoritative sources before relying on them:

- Exact mechanism by which each agent CLI (claude, codex, ezio) learns its own session id from inside the session, and each CLI's exact resume invocation — verified against the real binaries when writing the skill text.

Already verified during design: the terminal session id is generated before PTY spawn (`terminal-service.ts` — `randomUUID()` precedes the spawn call, so env injection is feasible), and the font-size default is `DEFAULT_TERMINAL_FONT_SIZE = 13`.

## 10. Non-goals

- Migrating view state (collapsed/expanded/onboarding) out of localStorage.
- Resuming agents for panes whose PTY is still alive (renderer reload) — the adopt path already preserves those conversations.
- Auto-*continuing* agent work after resume — resumed conversations open idle.
- Per-provider resume strategies, launch-flag injection, or provider session-store parsing (explicitly rejected — see D3).
