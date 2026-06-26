# UI/UX Hardening — Slice 1 Design

**Date:** 2026-06-26
**Status:** Approved for planning
**Branch:** `bugs-hardening`
**Author:** Vu Phan (with Claude)

## Context

A UI/UX hardening pass on the ai-14all desktop app. This slice captures three
independent issues raised during review. Each is a self-contained fix with its
own seam; they share no state and can be implemented and reviewed separately.

The three issues:

1. **Plugin Configure/Install run in the main terminal pane.** They spawn a real
   terminal session in the grid, disrupting the pane's layout. Now that the
   throwaway (floating) shell exists, these commands should run there instead.
2. **ai-whisper double-spawn race.** When no collab is ready, launching a second
   agent quickly drops it to the plain vendor binary instead of mounting it into
   the collab, because the first mount is still initializing.
3. **Agent identity is limited to whisper-capable agents.** Only claude, codex,
   and ezio are recognized. Agents without whisper support (antigravity, cursor)
   should still get first-class identity — discovery, launcher chips, and
   branding — inside ai-14all.

## Goals

- Route plugin Configure/Install commands through the floating shell, leaving the
  main terminal pane untouched.
- Make a deferred second agent launch mount into the collab once it is ready,
  instead of silently falling back to the vendor binary.
- Add capability-flagged agent identity so non-whisper agents are discovered,
  launchable, and branded — without ever attempting a whisper mount.

## Non-Goals

- No change to the Re-probe button (it is already headless — see below).
- No change to the whisper plugin's own command contract or the agent-skill
  installer.
- No new plugin cards for cursor/antigravity; they get launcher identity only.
- No redesign of the floating-shell feature itself; we extend its spawn path.

---

## Issue A — Plugin Configure/Install → throwaway shell

### Current behavior

- `PluginsPanelDialog` composes the command for each plugin card:
  - Configure (cortex): `composeCortexConfigureCommand()` — guarded MCP
    registration lines.
  - Configure (whisper): `whisperConfigureCommand()` → `whisper skill install --force`.
  - Install: `descriptor.installCommand`.
- Both Configure and Install call back into `App.handlePluginInstall(command, …)`
  (`src/app/App.tsx:835`), which **creates a real terminal session in the grid**,
  registers a process with the command, `sendInput(command)`, and on exit
  **re-probes the plugin registry**.
- The **Re-probe** button (`PluginCard.tsx:90`) calls `plugins.reprobe()` →
  `registry.reprobe()` → `capability-probe-service` runs **headless `execFile`
  child processes** (`capability-probe-service.ts:63`, `cortex-probe.ts:30`). It
  never creates a terminal session. **No change needed.**

### Decisions

- Reroute **Configure and Install** (both predefined-command buttons) to the
  floating shell. Re-probe is unaffected.
- Floating-shell UX for these commands: **auto-expand** on spawn so the user
  watches it run; **auto-close on exit code 0**; **linger on non-zero exit** so
  the user can read the error.
- Preserve the existing **re-probe-on-exit** side effect.
- If all 6 floating-shell slots are full (`MAX_FLOATING_SHELLS = 6`): **show a
  toast and abort** — never fall back to the terminal pane.

### Design

Add a command-running entry point to the floating-shell hook:

```
runCommandInFloatingShell(command: string, opts: {
  label: string;          // e.g. "plugin configure", "plugin install"
  onExit?: (exitCode: number | null) => void;  // re-probe hook
  autoCloseOnZero?: boolean;  // true for plugin commands
}): Promise<void>
```

Internal flow:

1. **Cap check** — if `floatingCount(worktreeId) >= MAX_FLOATING_SHELLS`, toast
   and return (mirrors `handleAddFloatingShell`).
2. **Spawn with command** — extend `spawnAdHocProcess` (`use-process-actions.ts`)
   to accept an optional `command` and, after registering the process,
   `sendInput(terminalId, command + commandSubmitKey())`. Today it hardcodes
   `command: null`; we make it carry the command (mirroring the existing
   `handleLaunchPreset` pattern).
3. **Register + auto-expand** — register the floating shell and dispatch
   `session/expandFloatingShell` so the popover opens.
4. **Exit handling** — subscribe to the session's exit event
   (`use-terminal-session.ts` `onExit`, which carries `event.exitCode`). On exit:
   - call `onExit(exitCode)` (the plugin re-probe);
   - if `autoCloseOnZero` and `exitCode === 0`, call `handleCloseFloatingShell`;
   - otherwise leave it lingering (existing linger-with-replay behavior).

Rewire `App.tsx`: the `onInstall` / `onConfigure` props passed to
`PluginsPanelDialog` (`App.tsx:2087-2089`) call `runCommandInFloatingShell`
instead of `handlePluginInstall`, passing the existing re-probe callback as
`onExit`. `handlePluginInstall`'s terminal-pane path is retired for these two
callers (kept only if another caller still needs it; otherwise removed).

### Files touched

- `src/app/hooks/use-floating-shell-actions.ts` — new `runCommandInFloatingShell`.
- `src/app/hooks/use-process-actions.ts` — `spawnAdHocProcess` accepts `command`.
- `src/app/App.tsx` — rewire `onInstall`/`onConfigure`; preserve re-probe-on-exit.

### Edge cases & tests

- Command exits 0 → floating shell auto-closes; registry re-probed.
- Command exits non-zero → floating shell lingers showing the error; registry
  still re-probed.
- All 6 slots full → toast, no spawn, terminal pane untouched.
- Floating shell spawned then cap fills mid-spawn → existing orphan-teardown
  path still applies.
- Multi-line / guarded commands (cortex `||` registrations) run as a single
  `sendInput` line, exactly as today.
- Tests: unit-test `runCommandInFloatingShell` (spawns with command, auto-closes
  on 0, lingers on non-zero, fires `onExit`, aborts at cap); e2e — Configure from
  a plugin card opens a floating shell, not a grid session.

---

## Issue B — ai-whisper deferred mount

### Current behavior & the race

- The mount-vs-vendor decision is `launchCommandFor(provider, ctx)`
  (`src/features/terminals/logic/agent-launch.ts:57-70`):
  `canMount = whisperHealthy && liveBoundCount < 2 && !mountPending`, where
  `liveBoundCount = daemonAlive ? boundCount : 0` and `boundCount` counts only
  bindings in state `"bound"` (`agent-launch.ts:35-38`).
- First click → mounts and sets `mountPending = true` via
  `useMountPendingGuard` (`use-mount-pending-guard.ts`). The guard captures a
  baseline and clears on: a new binding landing, the daemon coming alive, or a
  ~60s timeout (`advanceMountPending`).
- Second quick click → `mountPending` is still `true` → `!mountPending` is
  `false` → `canMount` is `false` → the command resolves to the **plain vendor
  binary**. The second agent runs un-mounted. This is today's intended guard
  behavior, but it is the wrong UX: the user wants the second agent to also join
  the collab.

### Decisions

- When a second agent is launched while the first mount is initializing,
  **defer it** and **auto-mount** once the collab is ready. Show a **queued
  badge** on the chip while it waits.
- Honor the collab's 2-agent cap (`liveBoundCount < 2`).
- If the collab does not become ready within ~60s, **fall back to launching that
  provider as the plain vendor binary and toast** that collab init timed out (the
  agent still starts).

### Design

Introduce a **single-slot deferred-mount queue** alongside the existing mount
guard.

- **State:** `deferredMount: { provider, slot } | null`.
- **On launch click:** compute the launch decision. If the provider is
  whisper-capable, a mount is already pending (`mountPending`), and the cap still
  allows another agent, then **do not spawn anything yet** — set
  `deferredMount = { provider, slot }` and render the queued badge on that chip.
  (Today this case spawns a vendor terminal; that is the behavior being changed.)
- **Readiness watcher:** on each whisper-state poll, when `deferredMount` is set,
  fire it once the collab is **ready**:
  `daemonAlive && boundCount >= 1 && liveBoundCount < 2`.
  Requiring `boundCount >= 1` (the first agent actually bound, not merely the
  daemon heartbeat) also closes the existing "daemon flips alive before the
  binding lands" gap. On firing: issue `whisper collab mount <provider>` in the
  stored slot, begin a fresh mount-pending for it, and clear the badge.
- **Bounding:** the queue holds at most one entry (the collab cap is 2: one
  mounting + one queued). A click while a deferred mount already exists replaces
  it (latest provider wins). A third quick click while the collab is full
  legitimately resolves to the vendor binary.
- **Timeout:** if `deferredMount` is not fired within ~60s
  (`MOUNT_PENDING_TIMEOUT_MS`), drop it, launch the provider as the plain vendor
  binary, clear the badge, and toast "collab init timed out".

### Files touched

- `src/features/terminals/logic/agent-launch.ts` — deferred-mount decision +
  readiness predicate.
- `src/features/terminals/logic/use-mount-pending-guard.ts` (or a sibling
  `use-deferred-mount.ts`) — own `deferredMount` state and the readiness watcher.
- `src/features/terminals/components/AgentLauncherBar.tsx` — queued badge on the
  chip; route a deferred click to the new path.
- `src/app/App.tsx` — wire the watcher's fire callback to `launchCollabTerminal`.

### Edge cases & tests

- Two quick clicks, collab healthy → first mounts, second shows queued badge,
  then auto-mounts when bound. Both end up in the collab.
- Three quick clicks → first mounts, second queued+mounts, third is vendor (cap).
- Collab init times out → queued provider launches as vendor + toast.
- Daemon heartbeats but first binding has not landed → deferred mount waits
  (does not fire early).
- User picks a different provider while one is queued → queue replaced.
- First mount fails entirely → guard times out → deferred falls back to vendor.
- Tests: unit-test the readiness predicate and the deferred-queue reducer (fires
  on ready, respects cap, replaces, times out to vendor); component test for the
  queued badge.

---

## Issue C — Non-whisper agent identity (antigravity, cursor)

### Current behavior

- Provider identity is the hardcoded pair `PROVIDER_ORDER = ["claude","codex",
  "ezio"]` + `PROVIDER_LABEL` (`agent-launch.ts:7-14`), repeated as enums/records
  in several places.
- **Discovery is NOT whisper-gated.** `capability-probe-service.ts` probes each
  agent binary on the machine via `resolveBinary`; `visibleProviders` then shows
  the ones found. Whisper support is independent of discovery.
- **`resolveBinary` already finds per-user installs.** It probes through an
  interactive login shell (`zsh -ilc 'command -v <name>'`, sourcing `.zshrc`) and
  falls back to `defaultSearchPaths()` which already includes `~/.local/bin`,
  `/opt/homebrew/bin`, `/usr/local/bin` (`binary-resolver.ts:60-66, 188-227`).
  So `agent` and `agy` (both in `~/.local/bin`) are already resolvable — **no
  PATH work is required.**
- `launchCommandFor` would happily emit `whisper collab mount <provider>` for
  **any** visible provider. Naively adding a non-whisper provider would make it
  wrongly attempt a mount. This is the core gap to close.

### Verified launch targets (this machine)

- **Cursor** → `agent` (symlink `~/.local/bin/agent` →
  `~/.local/share/cursor-agent/versions/2026.06.24-…/cursor-agent`), version
  `2026.06.24-00-45-58-9f61de7`. (`cursor-agent` is the same binary; the
  Homebrew `cursor-agent` formula was flagged as malware — the official installer
  is the trusted source. We launch the bare command `agent`.)
- **Antigravity** → `agy` (`~/.local/bin/agy`, 142 MB Mach-O), version `1.0.12`.

### Decisions

- Model non-whisper agents with **capability-flagged launcher chips** *and*
  **sidebar detection/branding** (both).
- Add a `whisperCapable` flag to the provider model. `launchCommandFor` only
  emits a whisper mount for whisper-capable providers; others always launch the
  plain binary.
- Add `cursor` (binary `agent`, `whisperCapable: false`) and `antigravity`
  (binary `agy`, `whisperCapable: false`).
- Leave the whisper command target enum and the agent-skill installer **unchanged**
  (they remain claude/codex/ezio — the whisper-capable set).

### Design

Promote the scattered provider constants into a **single provider registry** —
the source of truth for identity:

```
type AgentProviderDef = {
  id: string;            // "claude" | "codex" | "ezio" | "cursor" | "antigravity"
  label: string;         // "Claude", "Cursor", …
  binary: string;        // launch/probe binary; may differ from id ("cursor"→"agent")
  whisperCapable: boolean;
  brand: string;         // CSS color token, e.g. var(--provider-cursor)
};
```

- `PROVIDER_ORDER`, `PROVIDER_LABEL`, the `AgentCliProbes` key set, and
  `AGENT_CLIS` are all derived from this registry instead of being hand-written.
- **Discovery probes by `binary`, keyed by `id`.** `capability-probe-service`
  iterates the registry, resolves `def.binary`, and stores the result under
  `def.id`. `resolveBinary` already handles `~/.local/bin`, so `agent`/`agy`
  resolve with no further work.
- **`launchCommandFor`** uses the registry: the plain (vendor) command is
  `def.binary` (so cursor launches `agent`, antigravity launches `agy`); the
  mount path is gated on `def.whisperCapable`, so non-whisper providers can never
  produce `whisper collab mount`.
- **Sidebar detection + branding:** add `--provider-cursor` / `--provider-antigravity`
  CSS tokens and badge styles; extend `detectAgentProvider`
  (`src/features/workspace/logic/agent-provider-detection.ts:46`) to recognize the
  new launch commands. Because `agent` is a generic word, detection must match the
  resolved launch command/binary precisely, not a loose substring, to avoid
  false positives.

### Files touched

**Change:**
- New `shared/models/agent-provider.ts` (or extend an existing model) — the
  registry + `AgentProviderDef`.
- `src/features/terminals/logic/agent-launch.ts` — derive order/label from the
  registry; binary-aware vendor command; `whisperCapable` mount gate.
- `services/plugins/capability-probe-service.ts` — probe by `binary`, key by `id`.
- `shared/models/ecosystem-plugin.ts` — `AgentCliProbes` keyed by the registry's
  id set.
- `src/features/workspace/logic/agent-provider-detection.ts` — extend
  `detectAgentProvider` to recognize the new launch commands.
- `src/features/workspace/components/SessionSidebar.tsx` +
  `shared/models/agent-attention.ts` — provider badge render + provider type for
  the new ids.
- `src/app/shell.css` — `--provider-cursor` / `--provider-antigravity` tokens +
  badge styles.

**Unchanged (intentionally):**
- `shared/contracts/agent-install.ts` (`ProviderIdSchema`) — installer scope.
- `shared/contracts/plugins.ts` whisper-command target enum — whisper-capable only.
- `services/review/agent-skill-installer/` — installer scope.

### Edge cases & tests

- `agent`/`agy` present → cursor/antigravity appear as launcher chips and launch
  plain; never emit a whisper mount.
- Neither installed → chips hidden (existing `visibleProviders` filter).
- Whisper healthy + cursor clicked → still launches `agent` (no mount attempt).
- `agent` collides with some other `agent` on PATH → acknowledged risk; resolve
  via the user's login-shell `command -v` ordering; detection matches the exact
  launch command. Add a test asserting cursor resolves to the `~/.local/bin`
  install on the dev machine fixture.
- Tests: unit-test the registry derivations (order/label/probe keys), the
  binary-aware vendor command, and the `whisperCapable` mount gate; probe-service
  test that a binary differing from its id is discovered and keyed correctly.

---

## Cross-cutting: implementation decomposition

All three issues together touch well more than three files, so implementation is
split into small, independently reviewable units (per the working agreement to
break work larger than three files into smaller tasks):

1. **Task A — floating-shell command path.** `runCommandInFloatingShell` +
   `spawnAdHocProcess(command)` + App rewire. (~3 files)
2. **Task B — deferred mount.** Deferred-queue state, readiness watcher, queued
   badge, timeout fallback. (~3-4 files)
3. **Task C1 — provider registry refactor.** Introduce the registry and derive
   the existing three providers from it; **no behavior change.** (refactor)
4. **Task C2 — add cursor/antigravity + capability gating.** New providers,
   binary≠id launch, `whisperCapable` mount gate, discovery by binary.
5. **Task C3 — detection + branding.** Sidebar detection, CSS tokens/badges.

Each task gets its own TDD cycle and review.

## Risks

- **Issue B is the subtlest.** Readiness must require the first binding, not just
  the daemon heartbeat, and the timeout fallback must be reliable so a queued
  agent never silently never-launches.
- **`agent` is a generic binary name.** Detection and any future matching must be
  exact to avoid mislabeling unrelated sessions.
- **Floating-shell exit subscription.** The auto-close path depends on the
  session exit event firing with a real exit code; verify the linger-after-exit
  buffer still behaves when we auto-close on success.

## Open questions

None outstanding — all four design decisions were resolved during brainstorming
(cap → toast+abort; scope → move install too; timeout → vendor fallback+toast;
Re-probe → unchanged).
