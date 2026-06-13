# Terminal Chrome Header & Agent Launchers — Design

**Date:** 2026-06-14
**Status:** Design approved (brainstormed with the visual companion); implementation plan not yet written.
**Companion:** `docs/superpowers/specs/2026-06-12-ecosystem-plugin-framework-whisper-driver-design.md`
(this change reworks the start-collab affordance that spec introduced).

## 1. Context

The whisper driver shipped a single **"Start collab"** chip that, on click, fired
two `whisper collab mount` commands back-to-back (`use-start-collab.ts:32-33`) and
watched for two bindings. Two problems surfaced during UX testing:

1. **A race.** `launchInTerminal` only awaits the *terminal spawn*, not the mount
   completing, so the two mounts ran concurrently. The second (`codex`) resolved a
   half-created collab — DB record written, daemon not yet live — and threw
   `CollabResolverError: no live daemon for collab …`.
2. **A wrong mental model.** A fixed `claude + codex` pair can't express `ezio`
   (a replacement role), and a per-provider "bound/unbound" state misrepresents
   reality: an agent button simply *spins up a terminal with that agent*, and a
   user can launch two of the same provider. There is no single bound state per
   provider to display.

Reframing the affordance fixes both. The agent buttons become **stateless
launchers** (peers of `+ Shell` / `Presets`), and the act of launching adapts to
whisper. Because the buttons spawn terminals, they belong with the other
terminal-spawn controls — which motivates a small information-architecture change:
a dedicated **terminal-chrome header** that owns all terminal/shell chrome.

This design is opt-in and degrades cleanly: 14all stays fully functional with
whisper disabled or absent.

## 2. Goals / Non-goals

**Goals**

- Replace the single Start-collab button with **per-provider agent launcher
  buttons** for every detected agent CLI (claude, codex, ezio).
- Make each launch **whisper-aware**: join the collab when possible, otherwise
  spawn a plain agent terminal.
- Introduce a **terminal-chrome header** and relocate the existing terminal
  controls (`+ Shell`, `Layout`, `Presets`) into it, separating terminal/shell
  chrome from session-identity chrome.
- Detect `ezio` as a first-class agent CLI alongside claude and codex.
- Eliminate the mount race as a structural consequence (one click = one launch).

**Non-goals**

- No change to how workflows are started, paused, or inspected (the lens and CLI
  own that).
- No change to the whisper driver's probe/socket/lens internals beyond consuming
  the new ezio probe.
- No daemon HTTP control plane, no new whisper-side deliverables.

## 3. UX design

### 3.1 Layout

A new **terminal-chrome header** renders as a strip between the existing session
chip-bar (`SessionChipBar`, `aria-label="Session"`) and the terminal layer
(`shell-terminal-layer`). Vertical stack of the main column:

```
┌ Session chip-bar (unchanged) ── identity · usage · 🧩 Plugins ───────────────┐
├ Terminal-chrome header (NEW) ── Agents: …  ┊  + Shell · Layout · Presets ▾ ──┤
└ shell terminals ─────────────────────────────────────────────────────────────┘
```

Internal arrangement (validated as "Option B"): **agents on the left**, the
relocated terminal actions on the **right** (`margin-left: auto`).

### 3.2 Styling

The header reuses the existing chip styling verbatim — `shell-chip-bar__action`
chips (1px `--panel-border` border, `--radius-md`, `0.7rem`, `--text-secondary`,
hover to `--text-primary`) on a `--panel-bg` bar with a `--panel-border` bottom
border, matching the session chip-bar. No new visual language.

### 3.3 Agent launcher chips

- One chip per **detected** provider, labelled with the provider name
  (`Claude`, `Codex`, `Ezio`) and a small leading launch glyph.
- The chips are **launchers, not toggles** — no per-chip binding state. Clicking
  always spawns a terminal; clicking the same provider twice spawns two.
- If **zero** providers are detected, the agent group is omitted entirely; the
  header still shows the relocated terminal actions.

### 3.4 Aggregate collab status pill (whisper-on only)

When whisper is on/healthy for the worktree, a single status pill sits after the
agent chips, derived from the lens snapshot (`daemonAlive` + bound count):

| collab state | pill |
|---|---|
| no collab yet | `mount an agent to start a collab` (muted) |
| 1 agent bound | `collab · 1 agent · need 1 more` (amber) |
| 2 agents bound | `collab · ready for workflows` (teal/accent) |

This single pill is the real collab truth — it replaces per-button state and
naturally handles multi-instance launches. When whisper is off/absent, no pill is
shown.

## 4. Behavior: the launch rule

Each click resolves to exactly one command via a single pure rule:

```
canMount = whisperHealthy && boundCount < 2
command  = canMount ? `whisper collab mount <provider>`
                    : `<provider>`            // bare claude / codex / ezio
```

- `whisperHealthy` — the whisper plugin reports an on/healthy runtime status
  (installed, enabled, compatible), the same plugin-level predicate that currently
  gates the Start-collab button (`whisperOnHealthy` in `App.tsx`). The
  worktree-specific part is `boundCount`, read from that worktree's lens snapshot.
- `boundCount` — number of `bindingState === "bound"` entries in the worktree's
  lens snapshot (`WhisperWorktreeState.bindings`); `0` when there is no collab.

This one rule covers every case:

| whisper | collab | click does |
|---|---|---|
| off / not installed | — | plain agent spawn |
| on, healthy | none yet (`boundCount 0`) | `collab mount` — **creates** the collab |
| on, healthy | 1 bound | `collab mount` — fills the 2nd slot |
| on, healthy | 2 bound (**full**) | plain agent spawn — no slot to join |
| on, but unhealthy/incompatible | — | plain agent spawn |

The plain spawn runs the bare provider binary (`claude`, `codex`, `ezio`) in a new
worktree terminal; the mount runs `whisper collab mount <provider>` in the worktree
(cwd = worktree root) so it creates/joins that workspace's collab. Both go through
the existing `launchInTerminal` path — no new path-carrying IPC.

The original race cannot recur: a click maps to one launch, so there is never an
auto-fired pair of concurrent mounts.

## 5. Detection (ezio as a first-class agent CLI)

`capability-probe-service.ts` currently probes `AGENT_CLIS = ["claude", "codex"]`
via `resolveBinary` (PATH lookup) + a `--version` read. Changes:

- Add `"ezio"` to `AGENT_CLIS`.
- Make the **version read per-provider**: claude/codex keep `--version`; ezio uses
  **`ezio doctor`** (the `ezio` binary — actually `hax` — errors on `--version`).
  `ezio doctor` exits 0 and prints health plus a line of the form
  `ezio version : <x>` (verified: `ezio version : 0.2.0-beta.3`); parse the version
  from that line. If the line is absent, the probe still reports `found` with
  `version: null`.
- `found` (and therefore chip visibility) is determined by `resolveBinary` alone,
  exactly as for claude/codex — `found` means *binary present on PATH*, not
  authenticated, consistent with the existing prerequisite notice.
- Extend the `AgentCliProbes` type (`shared/models/ecosystem-plugin.ts`) from
  `Record<"claude" | "codex", AgentCliProbe>` to include `"ezio"`, and thread the
  third probe through the existing `agentClis` IPC (`plugin-ipc.ts`,
  `electron/preload/index.ts`, `electron/main/index.ts`).

## 6. Architecture (component decomposition)

Approach: a new dedicated header component owning terminal/shell chrome.

- **`TerminalChromeHeader`** (new, `src/features/terminals/components/`) — layout
  container rendering `[AgentLauncherBar]  …spacer…  [TerminalActions]`. Owns no
  state; receives its inputs from `App.tsx`. This is the extensible home for
  future terminal/shell chrome.
- **`AgentLauncherBar`** (new, `src/features/terminals/components/`) — renders one
  launcher chip per detected provider and, when whisper-on, the aggregate status
  pill. On click it asks `agent-launch.ts` for the command and calls the provided
  `launchInTerminal`. Inputs: `agentClis` (probes), `whisperHealthy`,
  `whisperState` (the lens snapshot for the active worktree). One output: a launch
  command string.
- **`agent-launch.ts`** (new pure logic, `src/features/terminals/logic/`) — the
  testable core:
  - `visibleProviders(probes)` → ordered providers with `kind === "found"`.
  - `launchCommandFor(provider, { whisperHealthy, boundCount })` → the §4 rule.
  - `collabStatus(whisperState | undefined, whisperHealthy)` → the §3.4 pill state
    (or `null`).
- **`TerminalActions`** (existing) — moved as-is into the header (its markup and
  behavior are unchanged; only its render location moves).
- **Removed:** the inline Start-collab `<button>` in `App.tsx`, the
  `useStartCollab` hook, and `logic/start-collab.ts` (`advanceStartCollab`,
  `StartCollabPhase`) — all superseded by the launcher model.

`SessionChipBar` drops its `terminalActions` and `startCollab` (`plugins`-adjacent)
slots; the `🧩 Plugins` button stays in `SessionChipBar`.

### 6.1 Data flow

```
App.tsx
  ├─ capabilityProbes.probeAgentClis()  ──► agentClis (claude/codex/ezio probes)
  ├─ whisperOnHealthy (plugin snapshot) ──► whisperHealthy
  ├─ whisperStates.get(activeWorktree)  ──► whisperState (daemonAlive, bindings)
  └─ renders <TerminalChromeHeader agentClis whisperHealthy whisperState
                                   launchInTerminal terminalActionsProps />
        └─ <AgentLauncherBar>  click → agent-launch.launchCommandFor(...)
                                     → launchInTerminal(command)   (existing path)
```

## 7. Edge cases

- **No agent CLIs detected** → no agent group; header keeps `+ Shell` / `Layout` /
  `Presets`.
- **Whisper on, collab full (2 bound)** → further clicks spawn plain agents; pill
  reads `ready for workflows`.
- **Rapid double-click of the same provider while creating a collab** → two mount
  terminals; whisper resolves/serializes this itself (not the auto-fired pair the
  old code produced). A light optional guard (briefly disabling other mount-capable
  chips until `daemonAlive`) may be added but is not required for correctness.
- **ezio present but `ezio doctor` fails** → `found` with `version: null`; chip
  still shows.
- **Provider binary disappears between probes** → the cached probe TTL
  (`capability-probe-service`, 60s) and existing re-probe/invalidate flow apply
  unchanged.

## 8. Non-regression constraints

- **Cmd+P (files) and Cmd+J (review) must keep working even when the terminal pane
  is focused** (`mem-2026-05-23-…-532e34`). The new header and its chips must not
  steal focus or swallow these globals, and must not introduce a colliding
  shortcut.
- The `aria-label="Session"` chip-bar region is unchanged (the header is a separate
  sibling element below it), so the existing shortcut e2e
  (`cumulative-flow.phase-10`) stays green. New e2e covers the header.
- 14all remains fully functional with whisper off/absent — agent launchers degrade
  to plain spawns; nothing requires the peer app.

## 9. Testing

- **Unit (TDD) — `agent-launch.ts`:** `visibleProviders` (filters by `found`,
  stable order); `launchCommandFor` across every §4 branch (whisper off → plain;
  no collab → mount; 1 bound → mount; 2 bound → plain; unhealthy → plain);
  `collabStatus` for each pill state and the whisper-off `null`.
- **Unit — capability probe:** ezio reports `found` via a stubbed `resolveBinary`
  and a version parsed from a stubbed `ezio doctor`; `found` with `null` version
  when `ezio doctor` fails; claude/codex still use `--version`.
- **Component / e2e:** header renders between chip-bar and terminals; agent chips
  appear only for detected providers; clicking issues the correct command per mode
  (assert against a stubbed `launchInTerminal`); the relocated `+ Shell` / `Presets`
  still function; the aggregate pill reflects bound count; shortcut non-regression
  holds.

## 10. Acceptance criteria

1. With whisper off/absent, each detected provider shows a launcher chip; clicking
   spawns a bare agent terminal; no collab pill is shown.
2. With whisper on and no collab, clicking a provider creates the collab via
   `whisper collab mount <provider>`; the pill advances `0 → 1 → ready`.
3. With a full collab (2 bound), clicking any provider spawns a plain agent
   terminal (no mount), and the pill reads `ready for workflows`.
4. `ezio` is detected and shown whenever the `ezio` binary is on PATH.
5. `+ Shell`, `Layout`, and `Presets` now live in the terminal-chrome header and
   still work; `🧩 Plugins` remains in the session chip-bar.
6. The mount race (`no live daemon for collab`) no longer occurs.
7. Cmd+P / Cmd+J still fire from terminal focus; the shortcut e2e remains green.
8. Repo gates green: typecheck, lint, unit, e2e.

## 11. Out of scope / deferred

- A light "disable other mount chips until `daemonAlive`" guard (optional polish).
- Surfacing per-agent health (`ezio doctor` richer output) beyond found/version.
- Any workflow-control affordances in the header (those stay in the lens/CLI).
