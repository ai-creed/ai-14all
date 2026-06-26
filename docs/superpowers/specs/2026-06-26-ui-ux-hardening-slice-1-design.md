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

- When a second whisper-capable agent is launched while the first mount is still
  settling, **defer it** and **auto-mount** it once a collab slot is genuinely
  free. Show a **queued badge** on the chip while it waits.
- **Honor the 2-agent cap through explicit capacity accounting** (below): a slot
  is occupied by a bound agent, an in-flight mount, *or* the single queued
  deferral. A launch that cannot fit the cap runs as the plain vendor binary
  instead — it is never deferred.
- **Tighten the mount-pending guard** so it clears only on an actual binding
  landing or the ~60s timeout — never on the daemon merely coming alive. The
  daemon-alive early-clear is the original race; an "in-flight mount" must mean a
  mount that is genuinely still settling, otherwise both the primary fallback and
  the deferral can fire too early.
- If a queued deferral is not fired within ~60s, drop it, launch that provider as
  the plain vendor binary, clear the badge, and toast that collab init timed out
  (the agent still starts).

### Design

**Capacity model (cap = 2).** Define, per workspace collab:

- `liveBound` — count of agents whose `bindingState === "bound"` (0 when the
  daemon is not alive).
- `mountInFlight` — `1` while the mount-pending guard is active for an issued
  mount, else `0`. Serialized to at most one at a time.
- `deferred` — `0` or `1` (the single queued slot).
- `committed = liveBound + mountInFlight + deferred`.

**State:** `deferredMount: { provider, slot } | null`.

**Launch-click decision** for a whisper-capable provider `P`:

1. `mountInFlight === 0 && liveBound < 2` → **mount now**
   (`whisper collab mount P`); the guard sets `mountInFlight = 1`.
2. `mountInFlight === 1 && deferred === 0 && liveBound + mountInFlight < 2` →
   **defer `P`**: set `deferredMount` and render the queued badge. No terminal is
   spawned yet.
3. otherwise (`committed >= 2`, or the deferred slot is already taken) → **plain
   vendor binary** `P`.

A non-whisper-capable provider always takes the plain-vendor path (branch 3).

**Readiness watcher** (on each whisper-state poll): when `deferredMount` is set,
fire it once `daemonAlive && mountInFlight === 0 && liveBound < 2` — i.e., the
previous mount has actually bound (the guard cleared on a binding, not a
heartbeat) and a real slot is free. On firing: issue
`whisper collab mount <deferredProvider>` in the stored slot, set
`mountInFlight = 1`, and clear `deferredMount` + the badge.

**Bounding — no replacement.** The deferred slot holds exactly one provider: the
first click that is deferred (FIFO). Later clicks do **not** replace it; a later
click that cannot fit the cap launches as the plain vendor binary (branch 3). To
change a queued provider, re-click that chip to cancel the deferral (clears the
badge), then launch the desired one.

**Worked examples (cap = 2):**

- *Empty collab, three rapid clicks A, B, C.* A → branch 1 (mounts,
  `mountInFlight = 1`); B → branch 2 (deferred, badge); C → branch 3
  (`committed === 2` → vendor). When A binds, the guard clears (on the binding)
  and the watcher fires B. End state: A + B mounted, C vendor.
- *One agent already bound (`liveBound = 1`), rapid clicks B then C.* B → branch 1
  (`mountInFlight = 1`, `committed === 2`); C → branch 3
  (`liveBound + mountInFlight === 2`, not `< 2` → vendor). No deferral is created,
  so the watcher can never issue a second mount into the final slot — the cap
  cannot be overbooked.

**Timeout:** if `deferredMount` is not fired within ~60s
(`MOUNT_PENDING_TIMEOUT_MS` of being queued), drop it, launch that provider as the
plain vendor binary, clear the badge, and toast "collab init timed out".

### Files touched

- `src/features/terminals/logic/agent-launch.ts` — deferred-mount decision +
  readiness predicate.
- `src/features/terminals/logic/use-mount-pending-guard.ts` (or a sibling
  `use-deferred-mount.ts`) — own `deferredMount` state and the readiness watcher,
  and tighten the guard's clear condition to fire only on a binding landing or the
  timeout (not on daemon-alive).
- `src/features/terminals/components/AgentLauncherBar.tsx` — queued badge on the
  chip; route a deferred click to the new path.
- `src/app/App.tsx` — wire the watcher's fire callback to `launchCollabTerminal`.

### Edge cases & tests

- Empty collab, two rapid clicks → first mounts; second shows the queued badge,
  then auto-mounts once the first binds. Both end up in the collab.
- Empty collab, three rapid clicks → first mounts, second queued→mounts, third is
  plain vendor (cap).
- One agent already bound **and a mount in flight for the final slot** → a further
  click is plain vendor, never deferred; the watcher never issues a second mount
  into the last slot (no cap overbooking). This is the exact state the deferred
  queue must not overbook.
- Daemon heartbeats but the in-flight mount's binding has not landed →
  `mountInFlight` stays `1` (the guard no longer clears on daemon-alive) → the
  deferral does not fire early.
- Queued deferral times out (~60s) → that provider launches as plain vendor + toast.
- Re-click the queued chip → deferral cancelled, badge cleared; a later click can
  then queue a different provider.
- First mount fails entirely → guard times out → `mountInFlight` clears → the
  deferral fires if a slot is free, else its own timeout falls back to vendor.
- Tests (must pin the exact cap state): unit-test (a) the capacity-accounting
  decision across all three branches — including `liveBound === 1 && mountInFlight === 1`
  resolving to vendor, **not** deferred; (b) the readiness predicate fires only
  when `mountInFlight === 0 && liveBound < 2`, never on bare daemon-alive; (c) the
  tightened guard clears on a binding or the timeout but not on daemon-alive; (d)
  timeout → vendor fallback; (e) re-click cancels the deferral. Component test for
  the queued badge.

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

- **Issue B is the subtlest.** The 2-agent cap is enforced by capacity accounting
  (`committed = liveBound + mountInFlight + deferred`), not a bare live count, so
  an in-flight mount and the single deferral each reserve a slot; readiness must
  require the prior mount's binding (the guard cleared on a binding, not a
  heartbeat); and the ~60s timeout fallback must be reliable so a queued agent
  never silently never-launches.
- **`agent` is a generic binary name.** Detection and any future matching must be
  exact to avoid mislabeling unrelated sessions.
- **Floating-shell exit subscription.** The auto-close path depends on the
  session exit event firing with a real exit code; verify the linger-after-exit
  buffer still behaves when we auto-close on success.

## Open questions

None outstanding — all four design decisions were resolved during brainstorming
(cap → toast+abort; scope → move install too; timeout → vendor fallback+toast;
Re-probe → unchanged).
