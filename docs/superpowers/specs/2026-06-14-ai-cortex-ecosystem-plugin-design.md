# ai-cortex ecosystem plugin — design

**Date:** 2026-06-14
**Status:** Approved design, pending implementation plan
**Author:** Vu Phan (with Claude)

## 1. Context and goal

ai-14all hosts a generic, opt-in ecosystem plugin framework: one built-in "driver" per peer
app, answering five planes (Probe, Data, Control, Lifecycle, UI), with a TOML switchboard and a
Plugins panel. The ai-whisper driver shipped first and is the reference implementation.

This work activates the deferred follow-up: formalize ai-cortex as an explicit plugin through the
same framework. Today, code-nav already consumes the cortex index *silently* — it works whenever a
cache exists, with no user-visible toggle, status, or value story. We are turning that implicit
consumption into a first-class, opt-in integration.

Two value propositions must be explicit in the Plugins panel:

1. **Substrate knowledge for the agents** — ai-cortex is the memory layer the coding agents recall
   from and record to across sessions.
2. **Code navigation inside ai-14all** — the same index unlocks go-to-definition, references, and
   symbol search as a power feature.

### Guiding constraints (from prior ecosystem decisions)

- Ecosystem apps stay independent; integrations are opt-in. ai-14all must never *require* a peer.
- An external integration's data store is a read-only contract — never write to or mutate it to fix
  an ai-14all issue.
- Opt-in UX rules: absence is silent; availability is discoverable; enabling is explicit (never
  auto-enable on detection); degradation is graceful.

## 2. Locked decisions

| # | Decision |
|---|----------|
| D1 | The cortex enable toggle **gates code-nav**: defs/refs/symbol search are active only when the cortex plugin is enabled. Disabled → code-nav off with an "enable ai-cortex" hint. |
| D2 | The Plugins panel advertises **both** value props (substrate-for-agents + code-nav power feature). |
| D3 | v1 functional scope = **probe + code-nav gate + dual-value pitch + a "Configure ai-cortex" shortcut**. No ongoing control plane, no auto-wiring of agent MCP config. |
| D4 | The probe is **14all-side only**: resolve the `ai-cortex` binary + parse `ai-cortex --version`. No peer-side `env --json` command is added (cortex has none, and per-worktree index-contract compatibility is already handled by code-nav). |
| D5 | The "Configure ai-cortex" action runs the peer's **full canonical agent-wiring sequence** (ai-cortex README Quick Start): register the MCP server for each installed agent (`claude mcp add -s user ai-cortex -- ai-cortex mcp`, `codex mcp add ai-cortex -- ai-cortex mcp`), then `ai-cortex history install-hooks`, then `ai-cortex memory install-prompt-guide`. The command is **composed from the agent-CLI probes** (only installed agents get an `mcp add`) and **idempotency-guarded**, then run by **reusing the existing terminal-injection path** (`handlePluginInstall`). No new IPC or command-runner. |
| D6 | Code-nav is gated via a **predicate injected at the code-nav IPC boundary** (`getCortexEnabled`), sourced from `pluginConfig.get("cortex").enabled`. No dynamic IPC register/unregister; no renderer-only gate. |

## 3. Key facts established about ai-cortex (verified against v0.15.1)

- Binary name is **`ai-cortex`** (resolves at `/opt/homebrew/bin/ai-cortex`), *not* `cortex`.
- `ai-cortex --version` prints `ai-cortex 0.15.1`.
- There is **no `env` command**. Subcommands: `index`, `rehydrate`, `suggest`, `mcp`, `stats`,
  `history`, `memory`, `graph`, `help`, `version`.
- `ai-cortex memory install-prompt-guide` and `ai-cortex history install-hooks` are **global,
  idempotent** setup commands (the prompt guide writes the memory-consultation block into
  `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`).
- Authoritative agent setup (ai-cortex README Quick Start, in order): register the MCP server per
  agent — `claude mcp add -s user ai-cortex -- ai-cortex mcp`, `codex mcp add ai-cortex -- ai-cortex
  mcp` — then `ai-cortex history install-hooks`, then `ai-cortex memory install-prompt-guide`. **The
  MCP registration is the part that actually gives agents the tools** (`recall_memory`, `get_memory`,
  `suggest_files`, `search_history`, …). `claude mcp add` supports `-s/--scope` (local|user|project,
  default local); `codex mcp` has `add`/`get`/`remove`/`list`. Re-adding an existing server errors,
  so guard with `<agent> mcp get ai-cortex || <agent> mcp add …`; the server is frequently already
  registered (e.g. claude reports `ai-cortex … ✔ Connected`).
- **Gotcha:** ai-cortex subcommands do **not** support `--help`; passing `--help` to a subcommand
  *executes* it. Never probe cortex subcommands with `--help`.
- Code-nav data-source layout: cortex writes a per-worktree SQLite store at
  `~/.cache/ai-cortex/v1/<repoKey>/<worktreeKey>.db` (WAL) with a sibling `<worktreeKey>.meta.json`
  sidecar (index-contract v3.1). `CortexKeyResolver` maps a worktree path to `{repoKey, worktreeKey}`
  by scanning those sidecars; code-nav then ingests cortex's `.db` into its **own mirror** under
  `~/.cache/ai-14all/code-nav/` and serves queries from the mirror. Per-worktree schema
  compatibility is checked via `meta.schemaVersion` + `isSupportedSchemaVersion()`
  (`electron/code-nav/source/version-compat.ts`, pinned to contract MAJOR 3, accept minor ≥ written).
- Framework is pre-wired: `EcosystemPluginId` already includes `"cortex"`; the Plugins panel
  already renders a cortex card; `PluginCapability` already has a `"code-nav-index"` slot.

## 4. The five planes for the cortex driver

### Probe
`probeCortex(binary)`:
- No binary resolved → `{ kind: "not-installed" }` (owned by the driver's null-binary check).
- `ai-cortex --version` parses to `ai-cortex <semver>` → `{ kind: "installed", version, installPath,
  protocolVersion: "" }`. `protocolVersion` is empty: cortex has no protocol handshake, and
  index-contract compatibility is surfaced per-worktree by code-nav, not globally.
- Binary resolved but `--version` fails to exec / times out / returns unparseable output →
  `{ kind: "degraded", reason: "could not run ai-cortex --version" }` (present but unusable → panel
  shows Re-probe, never a misleading Install).
- *(Optional, deferred)* a minimum-version floor that maps to `{ kind: "incompatible" }` with an
  "upgrade ai-cortex" message. Not in v1 — keep the probe permissive; per-worktree schema mismatch
  is the existing, more precise signal.

Routed through `capabilityProbes.probePlugin("cortex", …)` so registry re-probes hit the cache,
exactly like whisper.

### Data
Reuse the existing `CortexIndexService` / `CortexStoreReader` / `CortexKeyResolver`. The driver
adds **no** new reader. The data store remains a read-only contract. Whether code-nav eventually
queries cortex's `.db` directly vs. keeps mirroring it is a separate, still-deferred decision
(mem-2026-06-03) and is **out of scope** here — this work keeps the status-quo mirror.

### Control
No command-runner. A single **"Configure ai-cortex"** action runs the peer's canonical
agent-wiring sequence (ai-cortex README Quick Start) in a visible terminal. The command is
**composed from the agent-CLI probes** the panel already fetches (`plugins.agentClis()`), so only
installed agents get an MCP registration, and each MCP step is **idempotency-guarded** (the server
may already be registered):

```sh
# included only if `claude` is found:
claude mcp get ai-cortex >/dev/null 2>&1 || claude mcp add -s user ai-cortex -- ai-cortex mcp
# included only if `codex` is found:
codex mcp get ai-cortex >/dev/null 2>&1 || codex mcp add ai-cortex -- ai-cortex mcp
# always (idempotent):
ai-cortex history install-hooks
ai-cortex memory install-prompt-guide
```

Steps are joined with `;` (not `&&`) so one failure does not abort the rest. This wires the full
agent substrate: **MCP server registration** (gives agents the `recall_memory` / `record_memory` /
`get_memory` / `suggest_files` / … tools), session-history capture hooks, and the memory prompt
guide. ezio is excluded (no documented MCP registration path). It reuses `handlePluginInstall`'s
create-session → register-process → sendInput path verbatim (re-probe on exit included). The
renderer composes the command from the probes and passes it to that path.

### Lifecycle
The driver's `start`/`stop` are minimal (no polling watcher like whisper's collab loop). On
enable/disable transitions, code-nav availability must refresh in the renderer without a manual
re-open (see §5).

### UI
- Rewrite the cortex descriptor pitch to the dual-value message.
- Add a **Configure** button to `PluginCard`, shown when the plugin is installed.
- Code-nav surfaces a "cortex disabled — enable ai-cortex to use code navigation" state when the
  toggle is off.

## 5. Code-nav gating (D1 + D6)

`registerIpcHandlers(mainWindow, deps)` (`electron/main/index.ts:331`) gains a dep
`getCortexEnabled: () => pluginConfig.get("cortex").enabled`. `pluginConfig` already exists at
`index.ts:165`, before this call. Inside `electron/main/ipc.ts`, the predicate flows into:

- `registerCodeNavIpc({ …, isCortexEnabled })` — every code-nav query first checks the predicate.
  When disabled, queries return a new availability reason **`cortex-disabled`** (added alongside the
  existing `no-cortex` / `unsupported-schema` / `not-indexed` reasons in
  `electron/code-nav/source/availability-marker.ts` and `getWorktreeStatus`).
- The background re-index no-ops when disabled: `CortexRefreshController.refresh` — the single choke
  point for both the IPC `refreshWorktree` handler and the `WorktreeWatcher` `onBatch` — returns
  early, so a disabled cortex spawns no `ai-cortex rehydrate`. The file watcher itself stays
  registered (`watchWorktree` / `unwatchWorktree` are **not** gated), so there are no leaked or
  missing watchers across enable / disable / unmount; only the re-index work is suppressed.

**Live update on toggle:** when the toggle flips, the renderer must re-render code-nav state
without re-opening the panel. The cortex driver's `start`/`stop` (invoked by the registry on
enable/disable) emit a code-nav availability event to the renderer (a `code-nav:availabilityChanged`
or reuse of `code-nav:worktreeUnavailable` / `worktreeIndexRefreshed`). The renderer's code-nav
layer re-queries `getWorktreeStatus` on that event. Exact event name to be finalized in the plan.

The renderer shows the "enable ai-cortex" hint wherever code-nav availability is consumed
(cmd+click affordance, code-nav status surface), reusing the existing unavailable-state UX.

## 6. Components and files

New:
- `services/plugins/cortex/cortex-probe.ts` — `probeCortex(binary)`, version parsing.
- `services/plugins/cortex/cortex-driver.ts` — `createCortexDriver(...)` implementing
  `EcosystemPlugin` (`id: "cortex"`, `capabilities: ["code-nav-index"]`, `probe`, `start`, `stop`).

Modified:
- `electron/main/index.ts` — resolve `ai-cortex` binary (`resolveBinary("ai-cortex", { installPath:
  pluginConfig.get("cortex").installPath })`), construct the cortex driver, add it to
  `createPluginRegistry([whisperDriver, cortexDriver], pluginConfig)`, and pass `getCortexEnabled`
  into `registerIpcHandlers`.
- `electron/main/ipc.ts` — thread `getCortexEnabled` into `registerCodeNavIpc` + refresh/watcher
  gating.
- `electron/code-nav/ipc/register.ts` (+ `cortex-index-service.ts` / `availability-marker.ts`) —
  honor the predicate; add the `cortex-disabled` availability reason.
- `src/features/plugins/components/PluginsPanelDialog.tsx` — rewrite the cortex pitch; **compose the
  Configure command from the agent-CLI probes it already fetches** (`agentClis`), guarded for
  idempotency; pass it to the Configure handler.
- `src/features/plugins/components/PluginCard.tsx` — render the Configure button when installed.
- `src/app/App.tsx` — wire the Configure handler (reuse `handlePluginInstall`).
- Renderer code-nav layer — render the "enable ai-cortex" hint on the `cortex-disabled` state.

## 7. Edge cases

- ai-cortex installed but never indexed this worktree → code-nav already reports `not-indexed`;
  unchanged. With the plugin disabled, `cortex-disabled` takes precedence in the status.
- Plugin enabled but binary missing → probe is `not-installed`; the toggle is hidden (per existing
  `PluginCard` logic: toggle shows only when `state !== "not-installed"`). Enabling is impossible
  until installed, which is correct.
- Toggle flipped off while a code-nav query / background re-index is in flight → in-flight query
  returns its result; subsequent queries return `cortex-disabled`; subsequent background refreshes
  no-op (the file watcher stays registered for lifecycle correctness but spawns no re-index).
- Existing users who relied on silent code-nav lose it until they enable cortex once. This is the
  intended explicit-opt-in behavior (D1). The panel pitch + the "enable ai-cortex" hint make the
  one-time action discoverable.
- `ai-cortex --version` output format drift (e.g. a `v` prefix or extra build metadata) → the parser
  must tolerate a leading `ai-cortex ` and extract the first semver-looking token; unparseable →
  `degraded`, not a crash.
- Configure command run when ai-cortex is not on PATH for a GUI-launched app → relies on the same
  login-shell PATH repair already in place for whisper (`shell-path.ts`); the visible terminal
  surfaces any failure.
- MCP server already registered for an agent (common — e.g. claude shows `ai-cortex … ✔ Connected`)
  → the `mcp get … ||` guard skips the re-add, so no scary "already exists" error.
- An agent CLI is absent → its `mcp add` step is omitted from the composed command (driven by
  `agentClis`). ezio is excluded entirely (no documented MCP registration path).
- Steps joined with `;` so a failure in one (e.g. `codex mcp add`) does not block the hooks /
  prompt-guide from running.
- Re-running Configure is safe end-to-end — `install-hooks` / `install-prompt-guide` are idempotent
  and the MCP adds are guarded.

## 8. Test plan

Unit:
- `cortex-probe`: not-installed (null binary), installed (parses `ai-cortex 0.15.1`), degraded
  (exec error / unparseable output), version-format tolerance.
- `cortex-driver`: `id`/`capabilities` shape; `probe` delegates to `probeImpl`; `start`/`stop`
  no-throw and emit the availability signal.
- code-nav gating: with predicate `false`, `getWorktreeStatus` returns `cortex-disabled` and queries
  short-circuit; refresh/watcher no-op; with `true`, behavior is unchanged from today.

Component:
- `PluginCard`: Configure button visible only when installed; click passes the configure command.
- `PluginsPanelDialog`: cortex card shows the dual-value pitch.
- `PluginsPanelDialog`: Configure-command composition — includes `claude mcp add` only when claude
  is found, `codex mcp add` only when codex is found, always appends the two `ai-cortex` commands,
  uses the `mcp get … ||` idempotency guard, and joins steps with `;`.

E2e (where feasible, following existing plugin e2e patterns):
- Toggle cortex on/off and assert the code-nav availability state flips (cmd+click affordance vs.
  "enable ai-cortex" hint).
- Configure button opens a terminal running the **full composed agent-wiring sequence** — the
  idempotency-guarded `mcp add` for *each installed agent* (claude/codex) **plus** `ai-cortex history
  install-hooks` **plus** `ai-cortex memory install-prompt-guide` — never a subset that omits the MCP
  registration (the step that actually gives agents the tools). The E2E asserts the command string
  injected into the terminal equals the composition expected for the probed agent set; the exact
  guard form (`mcp get … ||`) and `;` joining are asserted by the `PluginsPanelDialog` composition
  component test above (E2E need not re-assert those mechanics, only that the full sequence is what
  gets launched).

Per project convention, prefer existing test helpers/fixtures over bespoke setup.

## 9. Task decomposition (each step ≤ ~3 source files)

The full change spans more than three files, so it is split into independently shippable steps:

1. **Driver + probe + registry wiring.** New `cortex-probe.ts`, `cortex-driver.ts`; wire into
   `electron/main/index.ts` (binary resolve + registry). Outcome: the cortex card shows
   installed/off with a real version chip. No code-nav behavior change yet. Tests: probe + driver
   units.
2. **Panel UX.** Dual-value pitch rewrite + Configure button (`PluginsPanelDialog.tsx`,
   `PluginCard.tsx`, `App.tsx` handler). Tests: component render.
3. **Code-nav gating.** `getCortexEnabled` predicate threaded through `index.ts` → `ipc.ts` →
   `registerCodeNavIpc`; `cortex-disabled` availability reason; renderer hint; live-update on
   toggle. Tests: gating units + e2e.

## 10. Out of scope (possible future work)

- Control plane (re-index / rehydrate buttons).
- Auto-wiring the ai-cortex MCP into launched agents.
- A peer-side `ai-cortex env --json` probe command.
- A global "incompatible" version floor for the probe.
- Resolving the deferred code-nav data-source decision — query cortex's `.db` directly vs. keep
  mirroring (mem-2026-06-03). This work keeps the status-quo mirror untouched.
- Folding per-worktree `ai-cortex index <path>` into Configure — Configure does **global agent
  wiring only**. Indexing a worktree (the prerequisite for code-nav content) is handled by code-nav's
  existing refresh pipeline (`CortexRefreshController` spawns `ai-cortex rehydrate`), or a future
  "Index this worktree" control action.
