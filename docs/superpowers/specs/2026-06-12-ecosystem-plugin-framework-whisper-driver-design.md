# Ecosystem Plug-in Framework & ai-whisper Driver — Design

**Date:** 2026-06-12
**Status:** Design approved in brainstorm session; implementation plan not yet written.
**Companions:**
- `2026-06-12-ai-14all-first-integration-research.md` (ai-samantha local-docs, brainstorm)
- `2026-06-12-ai-whisper-r0-exploration.md` (ai-samantha local-docs, brainstorm)
- Memory records: `mem-2026-06-12-ecosystem-apps-stay-independent-f858ec`,
  `mem-2026-06-12-whisper-integration-generic-opt-in-plug-cd608b`,
  `mem-2026-06-12-formalize-cortex-as-an-explicit-plugin-6fa01f`

## 1. Context and governing principle

The post-R0 strategic decision said ai-whisper would be "merged into ai-14all as its
embedded workflow engine (consumed as packages)". During this design session the
packaging reading of that decision was examined and rejected. The governing principle,
stated explicitly by Vu:

> The ecosystem apps (ai-14all, ai-whisper, ai-cortex, ai-ezio, ai-samantha,
> ai-pref-nsync) are designed to be independent of each other. A power user
> downloads/uses whatever subset they want. The goal is to offer best practices for
> using them together — never to force one app as a prerequisite of another.
> Plug-and-play is an opt-in functionality.

**This design amends the merge decision: the merge is realized at the API level, not
the source level.** ai-whisper remains exactly one external installation per machine
(npm-global or a dev checkout); ai-14all bundles none of its engine code and becomes a
typed client over sanctioned local contracts.

Bundling was rejected for three concrete reasons:

1. **Release coupling** — engine fixes must not wait for an ai-14all release.
2. **Dev loop** — Vu develops whisper daily; the app must be able to drive an
   uncommitted working tree.
3. **Two engines on one machine** — a bundled engine next to the power-user CLI
   creates schema-migration races on the shared `~/.ai-whisper/state.db`.

A managed-download plugin model was also rejected for now (heavy infra — fetcher,
signature verification, Gatekeeper handling — amortized only when multiple downloadable
plugins exist). Raw CLI-scraping integration (parse human-oriented stdout, poll
SQLite) was rejected because whisper-side additions are small and buy push semantics
and a typed contract.

## 2. Decision summary

ai-14all hosts a **generic ecosystem plug-in framework**: one built-in "driver" per
peer app, compiled into ai-14all (a static registry — no dynamic plugin loading).
A driver knows how to detect, read, command, and represent one peer app when the user
has installed it and opted in. The ai-whisper driver is the first instance; the
existing code-nav/ai-cortex integration is the in-house precedent and will be
formalized as the second driver after whisper ships (deferred, see §10).

The in-house precedent: `electron/code-nav/` already consumes ai-cortex exactly this
way — `source/cortex-store-reader.ts` is the "sole owner of ai-cortex's v3.1 `.db`
schema knowledge, read-only", written against the cortex repo's published
`cortex-index-contract.md`, with graceful unavailability when no index cache exists.
This design names that pattern and generalizes it.

## 3. Framework core (ai-14all side)

New main-process area `services/plugins/` (sibling of `services/mcp/`,
`services/terminals/`).

### 3.1 Driver interface

```ts
interface EcosystemPlugin {
  id: "whisper" | "cortex";                            // grows with the ecosystem
  probe(): Promise<ProbeResult>;                       // installed? version? compatible?
  start(ctx: PluginContext): Promise<PluginSession>;   // connect data plane
  stop(): Promise<void>;
  capabilities: PluginCapability[];                    // UI surfaces that light up
}

type ProbeResult =
  | { kind: "not-installed" }
  | { kind: "installed"; version: string; installPath: string; protocolVersion: string }
  | { kind: "incompatible"; found: string; required: string };
```

`ProbeResult` maps 1:1 to the Plugins-panel chips.

### 3.2 Registry (`plugin-registry.ts`)

Static array of drivers. Boot rule per plugin: probe at startup; `start()` only if
the probe is compatible AND the TOML config enables it. A plugin crash or a peer
disappearing mid-session triggers `stop()` and a degraded state; core ai-14all is
never affected.

### 3.3 Config (`plugin-config.ts`)

`config.toml` in the app userData directory
(`~/Library/Application Support/ai-14all/config.toml`). The file is canonical: the
GUI toggle writes through this module, power users edit the file directly, and the
app watches it so hand-edits apply without restart.

```toml
[plugins.whisper]
enabled = true
# dev-loop override — the app drives this working tree instead of the npm install:
# install_path = "~/Dev/ai-whisper"

[plugins.cortex]
enabled = true
```

`install_path` feeds directly into `probe()`. It is both the dev-loop mechanism and
the e2e test seam (§7).

### 3.4 Probe runner (`capability-probe-service.ts`)

One service that checks agent CLIs (claude, codex) and plugin peers — this is also
the implementation of the previously planned "prerequisite-missing notice" roadmap
item. Mechanics:

- Probes run as one-shot `$SHELL -lc '…'` child processes (login shell → correct PATH
  under nvm/asdf). Headless; never through `terminal-service`.
- Login shell is used only to *locate* binaries. Commands with arguments are always
  spawned directly on the resolved binary path with an argv array (no shell, no
  quoting hazards).
- Timeout per probe; malformed output is treated as `not-installed`, never a throw
  (user rc-files are known-hostile; see the zsh-rc e2e gotcha).
- Results cached; re-probe on app start, window focus, Plugins-panel open, and
  toggle flip.

### 3.5 Renderer plumbing

Plugin states travel over the existing typed IPC contract pattern
(`shared/contracts/`) to the settings panel and sidebar lenses — the same road the
agent-attention bridge uses.

## 4. The ai-whisper driver — five planes

### 4.1 Probe

New whisper-side command: `whisper env --json`, printing one JSON object — engine
version, install path, state root, DB schema version, protocol version. This is the
single sanctioned machine-readable answer to "are you there and can we talk?".
An older whisper without the command yields `incompatible (upgrade whisper)`.

### 4.2 Data

Two paths, snapshot and live:

**Snapshot/history — a documented read contract on `state.db`.** The whisper repo
publishes a `state-db-read-contract.md` (the cortex playbook) listing what external
readers may rely on: `workflows`, `workflow_phases`, `relay_chains`, `relay_handoff`,
`collab`, `session_binding`, plus the schema-version rule. ai-14all implements a
`WhisperStoreReader` shaped like `CortexStoreReader`: read-only open,
`busy_timeout`, version check via meta, null on any error. WAL mode makes concurrent
readers safe. The key join: `collab.workspace_root` ↔ ai-14all worktree paths
(realpath-canonicalized via the existing `WorktreePathResolver` approach).

**Live — an event socket on the broker daemon (whisper-side addition).** Each
per-collab daemon forwards its in-process `BrokerEventBus` events
(`workflow.created/phase-started/round-started/phase-done/done/halted/paused/
resumed/canceled`, `chain.escalated`) to a Unix socket under
`~/.ai-whisper/sockets/` (existing socket infrastructure precedent: the turn-event
listener). The daemon records its socket path in its DB heartbeat row; the driver
watches those rows and connects to each live daemon. First frame on connect is a
hello: `{ engineVersion, protocolVersion }` — the version handshake.

**Fallback:** if the installed whisper predates the event socket but the DB is
readable, the driver silently downgrades to polling the DB (a few seconds
interval). The UI is identical, only less instant; the chip shows
"limited (upgrade for live events)". The fallback is internal to the driver.

### 4.3 Control

v1 control is "run whisper's own commands":

- Catalog: `workflow pause <id>`, `workflow resume <id> --message "…"`,
  `workflow cancel <id>`, `collab tell <agent> "<msg>"`.
- Invocation: resolved binary + argv array, never through a shell.
- Async with real results: exit code and output captured per invocation;
  `collab tell` blocks until the agent replies (verified: `waitForReply` in
  whisper's `commands/collab/tell.ts`), so commands run async and completion
  surfaces as a notification.
- **Audit log from day one:** every driver-initiated command is appended to a JSONL
  log (the `agent-attention-logger` pattern in `services/diagnostics/`). Cheap now;
  load-bearing when ai-samantha starts originating commands and trust classes matter.
- v2 (only if needed): daemon HTTP control endpoints instead of process spawns.

### 4.4 Lifecycle

ai-14all **observes** daemons; it never owns them and never runs an orchestrator.
With no embedded engine, the two-orchestrators-per-collab collision is impossible by
construction.

- Daemon alive (fresh heartbeat row) → driver connects the socket, reads the DB,
  routes commands via CLI.
- Daemon dead but collab exists → lens shows "daemon not running" with a restart
  action that shells out to whisper's own start command (exact command: open
  verification item, §9).
- Quitting ai-14all never kills workflows: daemons are independent processes whisper
  owns. Reopen the app and the lens re-attaches.
- Mount sessions (agents in PTYs) need nothing from the driver — a
  `whisper collab mount` run inside an ai-14all terminal is just a process in a
  terminal.

### 4.5 UI

**Plugins panel** — new settings section; one card per registered driver: status chip
(`not installed` / `installed, off` / `on, healthy` / `degraded`), detected version +
install path, a one-paragraph value pitch, and actions — Install (opens an ai-14all
terminal that visibly types `npm i -g ai-whisper`, re-probes on exit), Enable toggle
(writes TOML), and for degraded states the reason plus an upgrade suggestion. The
card component is plugin-agnostic; cortex's card later renders from the same
component fed by a different descriptor.

**Workflow lens** — what the whisper plugin adds to the existing sidebar:

- A workflow row under any worktree session whose path joins a
  `collab.workspace_root`: workflow type (sdd / ralph / bugfix), current phase,
  round `n/m`, status badge. Live via the event socket.
- Escalations join the existing attention system rather than a parallel one: a new
  `workflow` value in `AgentAttentionSource` (today `mcp | terminal | lifecycle`).
  `workflow.halted` / `chain.escalated` become attention reasons (halt reason as
  summary) flowing through the same reducer and
  `shouldReplaceAgentAttentionReason` precedence (extended for the new source).
- Detail view on click: phase timeline, rounds, halt reason, handback history
  (`relay_handoff` request/response/verdict rows), and action buttons — Pause,
  Resume (message dialog → `--message`), Cancel, Tell agent. Each action is §4.3's
  audited CLI call.
- Renderer code lives at `src/features/workflows/`, sibling to
  `src/features/workspace/`.

**Start-collab capability (v1, deliberately dumb).** One button on the worktree
session, visible only when the whisper plugin is on and healthy: creates two
terminals, injects `whisper collab mount claude` into one and
`whisper collab mount codex` into the other (the proven preset/sendInput path), then
watches `session_binding` rows (`unbound → pending_attach → bound`) to flip the
button into "collab ready ✓". Failure → point at the terminals' own output; timeout →
"check terminal output". No retry logic, no orchestration. Roles are per-workflow,
not per-binding, so spin-up is just bind-two-agents. The line not crossed in v1:
kicking off SDD with a spec picker from the UI (workflow control, later milestone).

## 5. Opt-in UX rules

The independence principle as concrete behavior:

1. **Absence is silent.** A user without whisper never sees a popup about whisper.
2. **Availability is discoverable.** Detection runs quietly; the Plugins panel is
   where availability, value pitch, and guided install live.
3. **Enabling is explicit.** Detection never auto-enables; the user flips the toggle.
4. **Breaking is graceful.** Uninstall or incompatible upgrade → degraded chip with
   a reason; the rest of ai-14all is unaffected.

## 6. Versioning and error handling

Two version numbers govern compatibility, both reported by probe/hello:

- **DB schema version** (currently v6) gates the read path. The driver declares a
  supported range. DB newer → refuse reads, chip says "update ai-14all"; DB older →
  "upgrade whisper". The driver never migrates anything; whisper keeps sole
  migration ownership (single engine per machine — no second migrator exists).
- **Protocol version** (event socket hello / `env --json`) gates the live feed.
  Mismatch → fall back to DB polling if reads are still allowed, else degraded chip.

Failure behavior:

| failure | driver behavior | user sees |
|---|---|---|
| whisper uninstalled mid-session | probes fail → plugin stops | chip → `not installed`; lens unmounts; core untouched |
| daemon dies mid-workflow | socket drops; heartbeat stale | lens row → "daemon not running" + restart action |
| DB locked/corrupt read | reader returns null (CortexStoreReader pattern) | stale-data marker; quiet retry |
| CLI command fails | non-zero exit captured + audit-logged | toast with whisper's actual stderr |
| event socket garbage | disconnect; fall back to polling | nothing — lens updates slower |

Principle: **a driver may only ever degrade itself.** No driver state is load-bearing
for core ai-14all; every failure lands in a chip, a marker, or a toast.

## 7. Testing strategy

**Unit (vitest, `tests/unit/plugins/`):**

- Registry boot matrix: probe result × TOML state → expected plugin state.
- TOML config load/watch/write round-trips.
- Probe-output parsing: valid JSON, garbage, timeout, command-not-found — each maps
  to the right `ProbeResult`, never a throw.
- `WhisperStoreReader` against fixture DBs built by `make-whisper-fixture-db.ts`
  (sibling of the existing `make-cortex-fixture-db.ts`). The fixture builder
  hand-rolls the schema *from the read-contract doc*, deliberately not from
  whisper's code — schema drift without a contract bump trips these tests.
- Event mapping: canned socket frames → lens state + attention reasons (including
  the `workflow` source through `shouldReplaceAgentAttentionReason`).
- Command layer: action → exact argv array (no shell interpolation) + audit-log
  entry shape.

**E2E (Playwright, existing harness):** the TOML `install_path` override points at a
**stub whisper binary** (answers `env --json`, records invocations, writes binding
rows into a fixture DB). Scenarios:

- Plugins panel chips render per stubbed probe state; toggle persists to TOML.
- Stub daemon socket emits `workflow.halted` → sidebar row + attention dot.
- Start-collab: terminals created, mount commands injected, binding rows flip →
  "ready ✓".
- The independence test: no stub at all → sidebar pixel-identical to today, zero
  prompts.

**Cross-repo contract layers:**

1. Whisper-repo CI contract test: generate a real `state.db` via migrations and
   assert the contract-documented tables/columns exist — schema drift without a
   contract bump fails whisper's CI.
2. ai-14all CI thin live smoke: install real whisper from npm, run
   `whisper env --json`, open the DB read-only. Skipped when unavailable.

No full collab-with-agents e2e across repos (needs real agent CLIs, buys little; the
contract layers carry the weight). Existing release discipline (full suite green
before tagging) applies unchanged.

## 8. Whisper-side deliverables

Small, and useful to any future supervisor (ai-samantha can consume the same
contracts later); nothing ai-14all-specific leaks into whisper:

1. `whisper env --json` command (probe).
2. Event-socket fanout in the broker daemon (`BrokerEventBus` → Unix socket) +
   socket path recorded in the daemon heartbeat row + hello frame with versions.
3. `state-db-read-contract.md` + the CI contract test guarding it.
4. (Later, only if needed) daemon HTTP control endpoints.

## 9. Open verification items (before the implementation plan)

1. Exact collab/daemon ceremony order: must `collab create` / daemon start precede
   the mounts; can the two mounts run concurrently given the 5-minute claim expiry?
   (Read whisper's `commands/collab/`.)
2. The sanctioned daemon (re)start command for the lens's restart action.
3. Final field list for `whisper env --json` and the hello frame.
4. Whether the daemon heartbeat row can carry the socket path as-is or needs a
   schema addition (which would itself bump the read contract).

## 10. Out of scope / deferred

- **Cortex driver formalization** — after the whisper driver ships
  (`mem-2026-06-12-formalize-cortex-as-an-explicit-plugin-6fa01f`).
- **Samantha connector** — all Samantha milestones remain deferred per the research
  note; she later joins the same registry as an *outbound* plug (consumes ai-14all's
  connector API) and can reuse whisper's read contract + event socket.
- **SDD-from-UI with spec picker** — workflow-control capability, later milestone.
- **Daemon HTTP control plane** — v2, only if CLI shell-out proves limiting.
- **Dynamic/third-party plugin loading** — not needed for the curated ecosystem.

## 11. Relation to prior documents

- Amends the post-R0 "merge-first" decision in
  `2026-06-12-ai-14all-first-integration-research.md`: "consumed as packages"
  narrows to pure-TS shared-types packages at most; the engine is consumed as a
  service behind sanctioned contracts. The merged lower layer that gates Samantha
  work is now: framework core + whisper driver + whisper-side deliverables (§8).
- R0 exploration's open questions 1–3 (topology, schema coupling, command
  transport) are answered: ai-14all reads whisper's DB under a published contract +
  subscribes to daemon event sockets; commands shell out to the CLI in v1.
- R0 open questions 4–5 (collab↔session mapping cardinality, autonomy envelope)
  remain open and belong to the Samantha arc.
