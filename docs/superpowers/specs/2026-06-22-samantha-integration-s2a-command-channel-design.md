# Samantha Integration — S2a (Command Channel) Design

**Date:** 2026-06-22
**Status:** Approved design, ready for implementation planning.
**Scope:** S2a only — the benign-act *command channel*. ai-14all opens a WebSocket
to Samantha's connector server, receives extended `command` frames, dispatches two
read-only capabilities (`focus-worktree`, `session-report`), and returns correlated
`commandResult` frames. S2b — wiring Samantha's LLM to invoke these capabilities as
voice-driven tool calls — is a separate, later spec. No approval gate, no auth, no
registration token (those are S3); both capabilities are read-only / UI-only and
touch no agent.

## Context

This is the second slice of the ai-14all ↔ ai-samantha integration. S1 (rich
observe) has shipped: a main-process Samantha driver pushes a rich per-worktree
state document out to Samantha over plain HTTP (`register` / `PATCH snapshot` /
`POST events`). The settled overall shape lives in the high-level plan
(`docs/superpowers/specs/2026-06-21-samantha-14all-integration-highlevel-design.md`),
§4.2 (Act / commands-in) and §5 (roadmap).

This design was grounded by reading the actual code (2026-06-22). Key verified
facts that shaped it:

- **Ownership splits in two.** Samantha owns the connector server and the **wire
  envelope** — her `127.0.0.1:7841` HTTP+WS protocol (`register` / `PATCH` /
  `events` / the WS `command` frame). ai-14all owns the **capability vocabulary and
  payload semantics** — which capabilities exist, their arguments, and their result
  content (Samantha has no concept of a "worktree"). S2a therefore *extends
  Samantha's envelope* (a Samantha-side change) and *defines + implements* 14all's
  capability half. The eventual "connector boundary becomes a 14all-owned public
  API" direction (handoff §1) is **aspirational and undecided** — it is explicitly
  *not* what S2a does. S2a keeps Samantha's envelope and extends it.
- **Samantha's command frame today is arg-free.** The server→connector WS frame is
  `{ "type": "command", "capabilityId": "…" }` — no argument payload, no
  `requestId`, no acknowledgement (handoff §3.6). The connector→server WS direction
  today carries only events `{ summary, signal?, details? }`.
- **Samantha's WS upgrade requires prior registration.** The upgrade is on the same
  path as the events POST (`/connectors/:id/events`) and an unknown id 404s, so a
  connector must be registered (over HTTP) before it can bind a socket. The command
  channel's WS lifecycle is therefore gated on the driver's registration state.
- **Samantha's LLM tool-calling for voice→command is missing.** Connector commands
  and her assistant's LLM tool loop are disjoint subsystems; `executeCommand` is
  wired only to hardcoded ConnectionsPanel UI buttons, never from voice. That
  bridge is a substantial Samantha-side build and is **S2b**. S2a is fully testable
  *today* by driving commands from Samantha's UI — and in our automated tests, from
  a mock connector server — with no LLM involved.
- **S1's observe assembly is reusable as-is.** `assembleObserve({ identities,
  reviewCounts, whisper, session }) → { summary, status, details, signals }` is a
  pure function; `details` is keyed `"<repo>/<branch>"` (the focused worktree's
  *value* is prefixed `★ `; the key itself is clean), one dense readable line per
  worktree (`observe-assembler.ts:58-135`). `session-report` reuses this wholesale.

## Decisions locked (during brainstorm)

1. **Split S2 by concern.** S2a = the command channel (this spec). S2b = the
   voice→tool-call LLM bridge (separate spec). The user dogfoods once S2b lands;
   S2a ships and is tested first, de-risking the deterministic plumbing before the
   fuzzier LLM work.
2. **Extend the envelope** (not the minimal arg-free path). The command frame gains
   `args` + `requestId`; a new `commandResult` frame returns correlated results.
   This is the channel's core complexity and it is channel mechanics — not LLM work
   — so it belongs in S2a. Rejected alternative: reuse Samantha's existing arg-free
   frame and return results as ordinary events; rejected because it leaves
   `focus-worktree` unable to name a target and provides no request/result
   correlation.
3. **Ownership split** (above): Samantha owns the envelope, 14all owns the
   capability vocabulary and semantics.
4. **Spec packaging = split.** This 14all-side spec implements 14all's half **and**
   carries an explicit "Samantha-side contract" section that a separate Samantha
   session conforms to. Rationale is practical executability: the two repos have
   separate memory scopes and the SDD workflow runs in this repo, so we execute
   14all's half here and hand the envelope-extension requirements to a Samantha
   session. (Rejected: one bundled cross-repo spec — reads as one design but cannot
   be executed by this repo's SDD as-is.)
5. **Two benign capabilities:**
   - `focus-worktree(worktree)` — targeted; selects a worktree in the 14all UI.
     Exercises the **args-in** path.
   - `session-report()` — arg-free; returns a whole-app roll-up across all
     worktrees. Exercises the **result-out** path.
   Together they prove the full extended channel (args, result, `requestId`
   correlation) with each capability single-purpose. Both are read-only / UI-only.
6. **`focus-worktree` window-raise is customizable.** The capability always selects
   the worktree (UI state). It additionally raises the 14all window to the
   foreground only when `focusRaisesWindow` is set (default **true**). The knob
   lives in the samantha plugin config under a `behavior` sub-table, shaped so later
   agency knobs (as Samantha acts more autonomously in S2b/S3) join the same group.
   No policy framework is built now — only the one knob this capability needs.

## Architecture — components & boundaries

New units (main-process unless noted), alongside S1's existing
`services/plugins/samantha/` modules without disturbing the observe path:

| Unit | Responsibility | Depends on | Tested by |
|---|---|---|---|
| `command-types.ts` (new) | **Wire vocabulary.** Zod schemas + TS types for the inbound `command` frame and the outbound `commandResult` frame. The single place that knows the command envelope shape, analogous to how `samantha-connector-client.ts` owns the HTTP wire. | `zod` | unit (parse/serialize) |
| `samantha-command-client.ts` (new) | **The WS seam / all command I/O.** Opens `ws://127.0.0.1:7841/connectors/ai-14all/events` after the driver registers; receives messages, Zod-validates each (trust boundary), hands valid `command` frames to the dispatcher, and writes the correlated `commandResult` back. Owns WS lifecycle: connect-when-registered, backoff reconnect, close on stop, graceful absence. | `command-types`, dispatcher, a WebSocket impl | mock WS server |
| `samantha-command-dispatcher.ts` (new) | **Routing + result shaping.** Maps `capabilityId` → handler, builds the `commandResult`, and guarantees **exactly one result per inbound command** (including every error path). Calls injected capability callbacks; holds no I/O of its own. | injected callbacks | unit |
| renderer focus subscriber (new, renderer) | Listens on `PLUGINS_SAMANTHA_FOCUS_WORKTREE`; sets the focused worktree and switches workspace if the target is in another. Pure UI state change; does not know Samantha exists. | IPC | unit (logic) |

**Coordination with the S1 driver (`samantha-driver.ts`).** The driver stays the
orchestrator and connector identity owner. S2a adds to it:

- **Capability advertising** — `ensureRegistered()` now registers the two
  capabilities instead of `capabilities: []`.
- **Command-client ownership** — the driver constructs/holds the command-client,
  calls `connect()` after a successful register and `close()` on `stop()`, and
  re-`connect()`s after a re-register (Samantha restart). The command-client's
  connect is gated on `registered` so it never races an upgrade Samantha would
  reject.
- **Three injected capability callbacks** the dispatcher uses (the driver owns the
  data + effects these need):
  - `buildReport(): Promise<string>` — runs the same input gathering as
    `rebuild()` (identities + whisper + review counts + the latest session slice),
    calls `assembleObserve`, and renders the roll-up string (below).
  - `resolveWorktree(key: string): ResolveResult` — maps a `"<repo>/<branch>"` key
    to the internal `worktreeId` via the current identities. The result is a
    discriminated union so ambiguity is a first-class outcome rather than something
    silently collapsed: `{ kind: "found"; worktreeId }` when exactly one worktree
    carries the key, `{ kind: "none" }` when none does, and
    `{ kind: "ambiguous"; candidates: string[] }` when two or more do (`candidates`
    are the colliding worktrees' paths, surfaced in the error message). See
    "Worktree targeting & key uniqueness" below for why the key is not globally
    unique.
  - `focusWorktree(worktreeId: string): void` — sends
    `PLUGINS_SAMANTHA_FOCUS_WORKTREE` to the renderer and, when
    `getFocusRaisesWindow()` is true, raises the window (guarded against a destroyed
    window/webContents).

**Rejected alternative — route everything through the renderer** (it already builds
session slices): rejected because `session-report`'s roll-up needs main-owned data
(identities + whisper states + review counts) that the renderer does not hold
cleanly. Main is the right home for dispatch; only the `focus-worktree` UI select is
delegated to the renderer.

## Worktree targeting & key uniqueness

The `"<repo>/<branch>"` observe key is the only handle Samantha can name in
`focus-worktree` — it is what she sees in the observe document, and S1 exposes
nothing else. `repo` is `basename(toplevel)` (`worktree-service.ts:116-120`) and
`branch` is the worktree's branch. Within a single repository the branch is unique
(git forbids two worktrees checked out on the same branch), so the key uniquely
identifies a worktree for the common single-repo case and for multi-repo setups
whose top-level directory basenames differ.

The key is **not globally unique**, however. Two distinct repositories whose
top-level directories share a basename (e.g. `~/a/ai-14all` and `~/b/ai-14all`),
each with a worktree on the same branch, both produce `"ai-14all/<branch>"`. This is
a pre-existing S1 property, not something S2a introduces: `assembleObserve` already
overwrites one such worktree's `details`/`signals` entry with the other
(`observe-assembler.ts:109-111`), and S1 deferred the unique `worktree.id` / `path`
precisely *because* they are command-targeting identifiers a voice supervisor does
not reason over (S1 spec field inventory: `worktree.id` / `path` → "deferred → S2
typed"). The earlier "unique across repos" characterization of the key was an
over-claim that this slice corrects.

S2a's targeting contract follows from that reality:

- **Unambiguous key (the common case)** → resolve to the one worktree and focus it.
- **Colliding key** → the dispatcher **refuses safely** with `ambiguous-worktree`
  rather than guess. `focus-worktree` therefore never focuses the *wrong* worktree;
  at worst it declines an ambiguous one with an error that names the colliding paths.

Eliminating collisions entirely — exposing a stable, unique target identifier
(`worktree.id`) to Samantha so every worktree is addressable — requires the **typed
observe schema** that S1 deferred to S2. That is a separate S2 observe slice and is
out of S2a's command-channel scope (see Out of scope). S2a makes targeting *safe and
defined*; the typed-observe slice later makes it *unambiguous*.

## Capability data flow

**`focus-worktree`:** command-client receives + validates → dispatcher resolves
`args.worktree` via `resolveWorktree`, which yields one of three outcomes:
`{ kind: "none" }` → `commandResult` error `unknown-worktree`;
`{ kind: "ambiguous" }` (the key matches more than one worktree) → `commandResult`
error `ambiguous-worktree` whose `message` names the colliding paths — the dispatcher
never focuses on an ambiguous key, because refusing safely beats guessing wrong;
`{ kind: "found"; worktreeId }` → `focusWorktree(worktreeId)` (renderer select +
conditional window-raise) → `commandResult` ok `{ focused: "<repo>/<branch>" }`. Main
owns the ok/error verdict (it can resolve worktree existence itself), so no renderer
round-trip is needed for the result; the renderer select is best-effort UI.

**`session-report`:** command-client receives arg-free command → dispatcher calls
`buildReport()` → `commandResult` ok `{ report: "<roll-up string>" }`. The roll-up is
rendered from `assembleObserve`'s output as the `summary` headline followed by one
`"<repo>/<branch>: <line>"` per `details` entry. Zero worktrees → the headline alone
(`assembleObserve` already yields `"[…] — no active sessions"`), a defined non-empty
string. A string (not structured JSON) keeps S2a testable by eye and lets Samantha
speak/show it directly; S2b can parse it if the LLM later needs structure (YAGNI now).

S1's HTTP paths (`register` / `PATCH snapshot` / `POST events`) are **unchanged**.
The WebSocket is added purely for the command channel: 14all *receives* `command`
frames and *sends* `commandResult` frames over it; observe events continue to ride
HTTP `POST /events`.

## Samantha-side contract (envelope extension)

This is the delta a **separate Samantha session** implements. Everything else in
Samantha's connector surface is unchanged from S1.

**Inbound — server → 14all (extends today's `{ type, capabilityId }`):**

```json
{ "type": "command",
  "capabilityId": "focus-worktree" | "session-report",
  "args": { "...": "..." },
  "requestId": "req_abc" }
```

- `requestId` (string, **new, required**) — opaque correlation token; 14all echoes
  it on the result.
- `args` (object, optional; capability-specific):
  - `focus-worktree` → `{ "worktree": "<repo>/<branch>" }` (the observe-document
    key Samantha already sees, e.g. `"ai-14all/master"`).
  - `session-report` → omitted / empty.

**Outbound — 14all → server (new connector→server message type, on the same WS that
today carries `{ summary, signal?, details? }` events):**

```json
{ "type": "commandResult",
  "requestId": "req_abc",
  "status": "ok" | "error",
  "result": { "...": "..." },
  "error": { "code": "...", "message": "..." } }
```

- `result` present on `ok`: `focus-worktree` → `{ "focused": "<repo>/<branch>" }`;
  `session-report` → `{ "report": "<string>" }`.
- `error` present on `error`: `code` ∈ `unknown-capability | unknown-worktree |
  ambiguous-worktree | invalid-args | internal`, plus a human-readable `message`.

**What Samantha must change:**

1. Send `args` + a fresh `requestId` on each command frame she emits (today she
   sends only `capabilityId`).
2. On the connector→server WS direction, **disambiguate by `type`**: a message with
   `type: "commandResult"` is a command result to correlate by `requestId`;
   everything else remains a `{ summary, signal?, details? }` event (unchanged).
3. Provide a minimal affordance to *exercise* the channel before the LLM bridge
   exists — e.g. a ConnectionsPanel control that sends `focus-worktree` with a
   chosen `worktree` and `session-report`, and surfaces the returned `result`. This
   is what makes S2a testable ahead of S2b.

14all advertises both capabilities in its `register` payload, so Samantha discovers
them.

## Lifecycle & resilience

- **WS open is gated on registration.** The command-client never opens a bare
  socket. The driver calls `connect()` only after `ensureRegistered()` succeeds; on
  a WS drop, the client backoff-reconnects *while the driver still considers itself
  registered*. If registration was lost (Samantha restarted — surfaced as a `404`
  on the next HTTP PATCH/POST in the S1 path), the client waits for the driver's
  next successful re-register and reopens then. This reuses S1's reconnect
  discipline rather than inventing a parallel one.
- **Graceful absence (standing constraint).** Samantha down ⇒ the WS never connects
  ⇒ the command path is simply inert; 14all is fully functional and nothing is
  surfaced to the user. `reportDegraded` is **never** used for an absent or dropped
  command channel — the same rule S1 set for transient disconnects (it is terminal
  until reprobe).
- **`stop()`** closes the WS and tears down command-client timers, in addition to
  S1's existing `DELETE` unregister + timer teardown.

## Validation, trust boundary & error handling

Mirrors S1's `safeParse`-at-the-edge discipline (`plugin-ipc.ts` drops invalid
session slices).

- **Every inbound WS message is Zod-validated** (`command-types.ts`). A schema
  mismatch that still carries a recoverable `requestId` → `commandResult` error
  `invalid-args`; an unparseable message with no recoverable `requestId` → dropped +
  logged (it cannot be correlated). The receive handler **never throws out** — a bad
  frame must not kill the socket.
- **Unknown `capabilityId`** → `unknown-capability`.
- **`focus-worktree` missing `worktree: string`** → `invalid-args`.
- **`focus-worktree` worktree key resolves to none** → `unknown-worktree`; **resolves
  to more than one** (a colliding `"<repo>/<branch>"`) → `ambiguous-worktree`, message
  naming the colliding worktree paths. The dispatcher never focuses a worktree on an
  ambiguous key — refusing safely beats guessing wrong (see "Worktree targeting &
  key uniqueness").
- **A capability callback throws** → caught → `commandResult` error `internal`
  (logged main-side; no stack leaked over the wire).
- **Invariant: exactly one `commandResult` per inbound `command`** — every path,
  success or error — so Samantha never hangs on a correlation.

## Config knob

`focusRaisesWindow` (boolean, default **true**) lives in the samantha plugin config:

```toml
[plugins.samantha]
enabled = true

[plugins.samantha.behavior]
focus_raises_window = true
```

- `PluginConfigEntry` (`plugin-config.ts`) gains an optional
  `behavior?: { focusRaisesWindow: boolean }`, parsed from the `behavior` sub-table's
  `focus_raises_window` key (TOML snake_case → camelCase). Absent ⇒ default `true`.
- The existing chokidar `watch` + `reload()` + `onChange` already reload the file on
  edit, so the value is **live** — no restart needed once the parser reads it.
- `focusWorktree` reads it at dispatch time via an injected
  `getFocusRaisesWindow: () => boolean` (the driver closes over the config store).
- No UI toggle in S2a — `config.toml` is the customization surface; a toggle can
  join the Plugins panel later.

## Window-raise mechanics

Main-side `BrowserWindow.show()` + `focus()` (with the macOS app-level focus where
needed), **guarded against a destroyed window/webContents** — the same guard S1
flagged as a follow-up for `pushSamanthaHealth`. A single main window is assumed; if
that ever changes, raise the main window.

## Capability advertising

`RegisterBody.capabilities` is currently typed as the empty tuple `[]`
(`samantha-connector-client.ts:12`). S2a changes it to `SourceCapability[]`
(`{ id: string; title: string }[]`), and the driver registers:

```json
[ { "id": "focus-worktree",  "title": "Focus a worktree" },
  { "id": "session-report",  "title": "Report session status" } ]
```

## Edge cases

| # | Case | Handling |
|---|---|---|
| 1 | Samantha down / absent | WS never connects; command path inert; 14all unaffected (graceful absence) |
| 2 | Samantha restarts mid-session | S1 PATCH/POST `404` → driver re-registers → command-client reopens WS |
| 3 | Garbage WS frame, no `requestId` | dropped + logged; socket survives; handler never throws |
| 4 | Unknown `capabilityId` | `commandResult` error `unknown-capability` |
| 5 | `focus-worktree` unknown `worktree` | `commandResult` error `unknown-worktree` |
| 6 | `focus-worktree` key matches >1 worktree (two repos, same basename + branch) | `commandResult` error `ambiguous-worktree` naming the colliding paths; never focuses the wrong one |
| 7 | `focus-worktree` worktree known to main but renderer not yet mounted | main still returns ok; renderer select is best-effort (logged no-op if it can't apply) |
| 8 | Capability callback throws | caught → `commandResult` error `internal` |
| 9 | `session-report` with zero worktrees | ok with the defined headline-only roll-up string |
| 10 | WS drops *before* the result is sent | logged; **no** replay/queue across reconnects (a command is best-effort; Samantha re-issues) |
| 11 | `focusRaisesWindow = false` | select only; window stays where it is |

## Testing strategy

- **Unit — `command-types`.** Valid `command` frame parses; missing `requestId` →
  reject; bad `type` → reject; `commandResult` serializes for ok and both error
  shapes.
- **Unit — dispatcher.** `capabilityId` → handler routing; `unknown-capability` for
  anything unadvertised; the **exactly-one-result** invariant on every path
  (including injected-callback throw → `internal`).
- **Unit — `focus-worktree` path.** `resolveWorktree` maps `"<repo>/<branch>"` →
  `worktreeId` against an identities fixture: unknown key → `unknown-worktree`; a key
  carried by two identities (same `repo` basename + branch) → `ambiguous-worktree`
  with the focus IPC **not** emitted; a uniquely-matched key → emits the focus IPC and
  returns ok `{ focused }`. Knob: `focusRaisesWindow` true → window raise called
  (mocked window); false → not called; both still send the focus IPC and return ok.
  The ambiguous case is unit-only (it needs two same-basename repos, impractical to
  stage in e2e), mirroring how window-raise is asserted only in unit.
- **Unit — `session-report` path.** Given an `assembleObserve` input fixture (reuse
  S1's), `buildReport` renders the headline + one line per worktree; the
  **zero-worktree** case returns the defined headline-only string.
- **Unit — renderer focus subscriber.** On the IPC, sets the focused worktree and
  switches workspace when the target is elsewhere.
- **Unit — command-client lifecycle.** WS open gated on registered; drop-while-
  registered → reconnect; registration-lost → wait-then-reopen; Samantha-absent →
  connect no-ops, no throw, no `reportDegraded`.
- **e2e (Playwright) — the round-trip proof.** Extend the mock Samantha server
  (`tests/e2e/fixtures/samantha-mock-server.ts`, HTTP-only today) with a `ws` server
  on `/connectors/ai-14all/events`, plus `sendCommand(frame)` and a captured
  `commandResults` list — standing in for Samantha's UI. Three flows in the samantha
  e2e suite:
  1. **focus-worktree** → mock sends `command{ worktree }`; Playwright asserts 14all
     selected that worktree **and** the mock received `commandResult` ok `{ focused }`.
     Run with `focusRaisesWindow: false` so the assertion is the deterministic UI
     change, not an OS window event.
  2. **session-report** → mock sends an arg-free `command`; the mock receives
     `commandResult` ok whose `report` string names the worktree(s).
  3. **error** → mock sends `focus-worktree` with a bogus `worktree`; the mock
     receives `commandResult` error `unknown-worktree`.
  Window-raise is asserted only in unit (mocked window), never in e2e (OS-level,
  non-deterministic).

## Dependencies

- **`ws` as a devDependency** for the e2e mock connector server (a WebSocket
  *server*, which core Node does not provide). S1 deliberately had no `ws`
  dependency; S2a adds it for tests only.
- **Production command-client uses the built-in global `WebSocket`** (Electron 41
  bundles Node 22, where `WebSocket` is stable globally) — keeping the production
  dependency surface clean. **Verify during implementation** that
  `globalThis.WebSocket` exists in the Electron main runtime; if it does not, add
  `ws` as a production dependency and use its client. This is a planned verification
  step, not an assumption.

## Out of scope (deferred)

- **S2b:** wiring Samantha's assistant LLM to invoke these capabilities as
  voice-driven tool calls (the verified-missing bridge — a substantial Samantha-side
  build).
- Approval gate, audit log, registration token (**S3** — only commands that touch an
  agent need them; S2a's two are read-only / UI-only).
- Targeted per-worktree `session-report(worktreeId)` and a structured (non-string)
  result — add in S2b if voice phrasing / the LLM needs them.
- **Globally unique worktree targeting.** Eliminating `"<repo>/<branch>"` collisions
  by exposing a stable, unique `worktree.id` to Samantha in the observe document (the
  typed-observe S2 schema S1 deferred). Until it lands, `focus-worktree` targets by
  the human key, resolves it whenever it is unambiguous, and refuses colliding keys
  with `ambiguous-worktree`; it never focuses the wrong worktree. Changing the S1
  observe key format to disambiguate is explicitly *not* done here — it would disturb
  the shipped S1 observe path this slice leaves unchanged.
- Multi-window focus semantics; OS-window-raise assertions in e2e.

## Files to add / touch

**Add (`services/plugins/samantha/`):** `command-types.ts`,
`samantha-command-client.ts`, `samantha-command-dispatcher.ts`, plus their tests.
**Add (renderer):** the focus subscriber in the workspace feature, plus its test.

**Touch:**
- `shared/contracts/plugins.ts` — `PLUGINS_SAMANTHA_FOCUS_WORKTREE` channel (and any
  shared focus payload type).
- `services/plugins/samantha/samantha-connector-client.ts` — `RegisterBody.capabilities`
  type (`[]` → `SourceCapability[]`).
- `services/plugins/samantha/samantha-driver.ts` — advertise the two capabilities;
  construct/own the command-client; provide `buildReport` / `resolveWorktree` /
  `focusWorktree` callbacks; connect/close the WS across the registration lifecycle.
- `services/plugins/plugin-config.ts` — parse `[plugins.samantha.behavior]
  focus_raises_window`; extend `PluginConfigEntry`.
- `electron/main/index.ts` — construct the command-client + dispatcher, wire the
  driver callbacks, `getFocusRaisesWindow` (from the config store), and the
  window-raise effect.
- `electron/preload/index.ts` + `src/lib/desktop-client.ts` — the
  `onSamanthaFocusWorktree` push channel.
- `tests/e2e/fixtures/samantha-mock-server.ts` — add the `ws` server + `sendCommand`
  + `commandResults`.
- the samantha e2e suite (`tests/e2e/plugins-samantha.test.ts` or a sibling) — the
  three new flows.
- `package.json` — `ws` devDependency.

(The implementation plan decomposes these into TDD tasks; this list is the coverage
map, not a single change set.)

## References (verified 2026-06-22)

- `services/plugins/samantha/observe-assembler.ts:58-135` — `assembleObserve`,
  `"<repo>/<branch>"` keys, `★ ` focus prefix on the value, `signals` map; the
  `details[key] = …` assignment (`:109-111`) that overwrites on a colliding key.
- `services/worktrees/worktree-service.ts:116-120` — `Repository.name =
  basename(toplevel)`, the source of `"<repo>/<branch>"` collisions across distinct
  repositories whose top-level directories share a basename.
- `electron/main/index.ts:266-281` — `getSamanthaIdentities` builds
  `worktreeId → { repo, branch, path }`, keyed by the unique internal `wt.id`; the
  many-to-one `wt.id → "<repo>/<branch>"` mapping is what makes the inverse lookup
  ambiguous.
- `services/plugins/samantha/samantha-connector-client.ts:8-13,79-85` — `RegisterBody`
  (`capabilities: []`), HTTP wire, `127.0.0.1` + `AI_SAMANTHA_CONNECTOR_PORT`.
- `services/plugins/samantha/samantha-driver.ts:77-95,100-200,243-277` —
  `ensureRegistered`, `rebuild` input gathering, registration lifecycle, `stop()`.
- `shared/contracts/plugins.ts:26-29,97-134` — `PLUGINS_SAMANTHA_*` channels,
  `SamanthaSessionSlice`/`SamanthaHealth` types (channel + schema patterns to mirror).
- `services/plugins/plugin-config.ts:6-9,40-64,71-82` — `PluginConfigEntry`, `load()`
  parse loop, chokidar `watch` + `reload`/`notify`.
- `tests/e2e/fixtures/samantha-mock-server.ts:1-31` — HTTP-only mock to extend with
  `ws`.
- High-level plan `…2026-06-21-samantha-14all-integration-highlevel-design.md` §4.2
  (commands-in frame + ack/result convention), §5 (roadmap S1→S5).
- Hand-off `…ai-samantha/brainstorm/2026-06-21-samantha-14all-integration-handoff.md`
  §3.6 (arg-free command frame, WS on `/connectors/:id/events`), §5 (open questions
  this slice settles: command expressiveness, channel direction).
