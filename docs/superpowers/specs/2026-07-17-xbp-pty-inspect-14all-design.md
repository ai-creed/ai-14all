# XBP PTY Inspect — ai-14all Child Spec (host serializer + grants)

**Date:** 2026-07-17 · **Status:** approved design, ready for SDD (after the contract bump ships)
**Parent:** `2026-07-17-xbp-pty-inspect-umbrella-design.md` (normative for protocol semantics — read it first)
**Prerequisite:** `@ai-creed/command-contract` version with the `control:inspect` capability family (delivered by the ai-xavier child SDD).
**Worktree:** dev-integration (the xbp/phone-bridge state of record — do not verify against master).

This spec covers the host side: serving `list-ptys` / `subscribe-pty` / `unsubscribe-pty` / `pty-rows` and emitting `xavier.control.pty-changed`, sourced from the xterm buffers of every agent in a session.

---

## 1. The buffer source — visibility-independent

**Requirement (normative):** every agent PTY in a session is watchable regardless of desktop layout. A pane unmounted from the current layout must still serve rows.

**Recommended approach:** an `@xterm/headless` mirror per agent PTY in the main process. The PTY byte stream already flows through the main process to the renderer; tee it into the headless instance. The mirror is the single serialization source — the renderer's visible xterm is never queried, so no renderer IPC on the pull path and no dependency on pane mount state.

- **Dimensions:** mirror cols/rows track the renderer pane's current size (resize messages already exist for the PTY); when an agent has never been mounted, default 120×40.
- **Scrollback:** **10,000, matching the renderer.** `TerminalPane` constructs its xterm with `scrollback: 10_000` (`src/features/terminals/components/TerminalPane.tsx:197-205`), and a committed unit test locks that value (`tests/unit/components/TerminalPane.test.tsx:295-309`). A 2,000-row mirror would silently lose up to 8,000 rows the desktop still shows, breaking the umbrella's "same text" goal. Extract the value into a shared constant consumed by both the renderer and the mirror, and add a regression test asserting both construction sites use it, so the two buffers cannot drift. (The umbrella's "~2000 scrollback rows" figure was an approximation and is superseded by this section: retention = the renderer's configured scrollback. xterm buffer lines allocate lazily, so 10,000 is a cap, not a preallocation.)
- If implementation reveals a cheaper equally-correct source, the SDD may substitute it — the visibility requirement and the contract semantics are the invariants, not the library choice.

### 1.1 Identity mapping (normative)

The contract's identifiers resolve to host identities as follows:

- The contract's session identifier = the ai-14all **`worktreeId`** — the same identity the existing XBP lifecycle capabilities target.
- `agentId` = the renderer **`ProcessSession.id`** (`shared/models/process-session.ts:10-39`).
- The PTY link is `ProcessSession.terminalSessionId`, naming the main-process `TerminalService` session that owns the byte stream.

None of this mapping exists in the main process today: `TerminalService` holds only `{ meta, pty }` per terminal id (`services/terminals/terminal-service.ts:34-37`) and deletes the record on PTY exit (`terminal-service.ts:221-253`); provider/label/agent-detection live only in renderer workspace state; the Samantha slice publishes a single `activeProcessSessionId` per worktree, with no terminal id and no agent enumeration (`src/features/workspace/logic/samantha-slice-builder.ts:61-71`). The bridge below is therefore a required deliverable, not an integration afterthought.

### 1.2 Agent PTY catalog (renderer → main bridge)

A main-process **agent PTY catalog** keyed `(worktreeId, agentId)` is the authoritative source for `list-ptys` and for mirror lifecycle. The renderer — the only place agent detection happens — publishes to it over a new IPC channel on `ProcessSession` transitions:

- **Upsert** on spawn, `terminalSessionId` binding, label change, provider detection (`agentDetected` flip), and status change → `{ worktreeId, agentId, terminalSessionId, provider, label, live }`.
- **Remove** on process close (the `handleCloseProcess` → `session/closeProcess` path, `src/app/hooks/use-process-actions.ts:144-173`) and on worktree/workspace teardown. This explicit remove message **is the session-teardown signal**: an already-exited process is removed in the renderer without any further privileged lifecycle call, so main-process PTY events alone cannot distinguish "exited but readable" from "torn down".

Catalog rules:

- Only entries with `agentDetected` true are enumerable via `list-ptys` (the feature's scope is agents, not ad-hoc shells).
- PTY exit (observed in main via `TerminalService`'s `onExit`) marks the entry `live: false` but never removes it — the catalog entry owns the retained mirror until the renderer's remove message arrives (§3 post-exit retention).
- Renderer reload replays the full catalog as idempotent upserts so the main process reconverges; mirrors live in main and survive the reload.

### 1.3 Mirror lifecycle

- **Create** when a catalog entry first carries a `terminalSessionId`: tee that terminal's output (the same stream already flowing through `TerminalService`'s `onOutput` path) into the headless instance.
- **Resize** by hooking `TerminalService.resize(sessionId, cols, rows)` (`services/terminals/terminal-service.ts:305-321`) — the renderer already routes pane resizes through it; never-mounted agents stay at the 120×40 default.
- **Retain** on PTY exit: entry `live: false`, mirror keeps serving `pty-rows`.
- **Dispose** on catalog remove (process closed / session torn down): mirror freed, active subscription for it torn down, subsequent calls refuse `no-such-pty`.

## 2. Serializer + epoch/watermark machinery

Per mirror:

- **Absolute line identity & trim accounting (normative):** xterm's `IBuffer.getLine(i)` indexes the *retained* buffer, so retained indices shift as scrollback trims — they cannot be the contract's stable line IDs directly. The serializer maintains a per-epoch, monotonically non-decreasing **`trimmedBefore`** counter (lines dropped from the top of the buffer since the epoch began) and defines `absoluteLine = retainedIndex + trimmedBefore`. Trim detection: once the buffer reaches capacity (`buffer.length === scrollback + rows`), every further scroll drops exactly one top line — increment `trimmedBefore` per such scroll (instrument via the scroll callback plus buffer-length accounting; if the headless build exposes the core buffer's trim event, use it instead — both mechanisms must produce identical counts, so pick one as primary and assert against the other in tests). Absolute IDs are append-only within an epoch and never reused; anything that could reshuffle them (resize/reflow, alt-screen flip) bumps the epoch instead.
- **Dirty-line tracking:** hook the headless instance's write/scroll/resize callbacks; record dirtied **absolute** line indices (after the `trimmedBefore` mapping above).
- **Coalescer:** 200ms tick (only while dirty lines exist). Each tick: `watermark++`, stamp dirty set with the new watermark, clear the set, emit `pty-changed { worktreeId, agentId, epoch, watermark }` to the subscribed peer (if any).
- **Epoch manager:** epoch is a **monotonically increasing integer within a serializer run** — `epoch++` and full dirty-reset on: resize/reflow, alt-screen enter/exit, mirror (re)creation. Line indices and watermarks are meaningful only within an epoch. The phone adopts the current epoch at subscribe time, so cross-run monotonicity is not required.
- **Serialization on pull:** read `line.translateToString()` + per-cell attributes from the buffer; compress per-cell attributes into `StyleRun`s (adjacent cells with identical attrs merge). **Run `start`/`len` are UTF-16 code-unit offsets into the translated string** (umbrella §5): a wide cell (wcwidth 2) contributes its glyph's full UTF-16 length to exactly one run; zero-width/combining cells merge into the preceding glyph's run; runs must tile `text` exactly. wcwidth sum of `text` ≤ `cols`; trailing whitespace trimmed.
- **Cursor pagination + resume:** responses capped at 500 rows. **Every success response returns a non-null cursor** — the resume position after its rows (internally `(epoch, watermark, line)`, opaque to the phone) — plus `more: boolean`. The same cursor serves the next replay page (`more: true`) and later live-tail pulls (`more: false`). A stale/unknown cursor (older epoch, trimmed range, new serializer run) is answered as a fresh current-epoch snapshot, never an error. A cursor whose line position predates `trimmedBefore` is in that stale class: dropped lines are never re-served, and every success response carries the current `trimmedBefore` so the phone can evict its copies of dropped rows.

## 3. Subscription registry & capability wiring (`xbp-peer-session` layer)

- Registry: at most **one active subscription** for the paired phone; `subscribe-pty` for a new target replaces the previous (mirrors the single-paired-device model).
- Auto-teardown: peer detach, unpair/re-pair, agent exit, session teardown.
- `list-ptys`: enumerate the session's agents → `{ agentId, provider, label, cols, epoch, watermark, live }`.
- Refusal mapping (fail-closed, structured — remember the Slice 2b.2 lesson: no leaked stderr, mem-2026-07-07-…-3c899b): unknown session/agent → `no-such-pty`; session known but agent not running and buffer discarded → `no-live-agent`; anything unexpected → `internal` with a clean message.
- **Post-exit retention:** after an agent exits, keep its mirror readable until session teardown; `subscribe-pty` refuses `no-live-agent`, `pty-rows` still serves. After teardown, both refuse `no-such-pty`. "Exited" vs "torn down" is decided by the §1.2 catalog: PTY exit marks the entry `live: false` (the catalog entry owns the retained mirror), while the renderer's explicit remove message — process closed or worktree/workspace teardown — is the teardown signal that disposes it.
- Refusals fire no events (house rule from the acting path).

## 4. Grants & audit

- Add `control:inspect` to `NEW_PAIRING_GRANTS`. Existing pairings lack it — acquiring the capability requires a re-pair (acceptable: single-phone product; surface this in the pairing UI copy if it names granted scopes).
- **Audit — two layers, both required.** The protocol layer (`XbpAuditSink`, `services/xbp/xbp-audit-sink.ts`) keeps working unchanged: it records envelope-level accept/reject, and a domain refusal returned in-band still counts as protocol-`accepted` — the established acting-path behavior (`tests/integration/xbp/acting-lifecycle.test.ts:217-239`). Neither it (`{ ts, cap, risk, outcome, reason? }`) nor `ActingAuditLogger` (whose `route`/`guard` shape is acting-specific, `services/diagnostics/acting-audit-logger.ts`) can express inspect semantics, so this slice adds a dedicated semantic sink modeled on `ActingAuditLogger`: **`InspectAuditLogger`** (`services/diagnostics/inspect-audit-logger.ts`, append-only `inspect-audit.jsonl`, size-capped, best-effort — never breaks the app). Entry schema (normative):

  ```ts
  type InspectAuditEntry = {
    ts: number;
    op: "subscribe" | "unsubscribe" | "replace" | "teardown" | "refusal";
    cause: "peer-detach" | "re-pair" | "agent-exit" | "session-teardown" | null; // op === "teardown" only
    capability: string | null; // originating capability id; null for auto-teardown
    worktreeId: string;        // the contract's session identity (§1.1)
    agentId: string | null;
    refusalCode: "no-such-pty" | "no-live-agent" | "internal" | null; // op === "refusal" only
    rowsServed: number | null; // cumulative rows for the subscription being ended (unsubscribe/replace/teardown)
  };
  ```

  Every subscribe, unsubscribe, replacement (one `replace` entry naming the new target; the displaced subscription's `rowsServed` total rides on it), auto-teardown (with its cause), and every refusal from any of the four capabilities lands here. Row *content* never does: the schema has no content-bearing field, successful `pty-rows` pulls produce no per-pull entries (hot path), and the only pull metric is the cumulative `rowsServed` count stamped on the entry that ends a subscription.

## 5. Performance budget

- Coalescer ≤5 hints/sec per subscription under spinner churn; zero work with no subscriber (dirty tracking may stay armed, but no serialization happens without a pull).
- Full-replay worst case = a saturated 10,000-row buffer (§1) = ≤20 pulls at the 500-row cap; typical agents sit far below saturation, so common replays remain a handful of pulls. Each response stays well under frame-size limits (verify the actual XBP frame ceiling during implementation — if tighter than expected, lower the row cap, not the semantics).
- Serialization is on-demand (pull-time) — no caching of serialized rows; the buffer is the cache.

## 6. Edge cases (test these)

1. Spinner redrawing one line at 10Hz — hints coalesce, pull returns just that line re-stamped.
2. Scroll-trim past capacity (10,000) — assert the **exact** `trimmedBefore` value; that surviving rows keep their absolute IDs (same content under the same ID before and after the trim); that no dropped ID is ever reused within the epoch; and that a pull from a pre-trim cursor is answered per §2 (fresh snapshot, no dropped lines returned).
3. Resize while subscribed — epoch bump, hint carries new epoch, stale-epoch pull answered as fresh snapshot.
4. Alt-screen enter/exit (vim in a pane) — epoch bumps both ways; while active, retained set = viewport, `altScreen: true`.
5. Subscribe to an unmounted pane's agent — rows serve from the mirror at its default/last-known size.
6. Agent exits mid-watch — final hint, then subscribe refusals + rows still pullable until teardown.
7. Phone re-pairs — old subscription torn down with the old peer; `control:inspect` present in the new grant set.
8. Two rapid subscribe-pty calls (agent switch) — second replaces first; no hint leaks for the abandoned target.
9. Process closed after exit (renderer `session/closeProcess`) — the catalog remove disposes the retained mirror; `pty-rows` flips from serving to `no-such-pty`.
10. Renderer reload mid-session — catalog replays via idempotent upserts; mirrors and the active subscription survive (mirror state lives in main, not the renderer).

## 7. Tests & acceptance

- Unit: serializer against synthetic ANSI scripts (colors, truecolor, inverse, in-place redraw, scroll, resize reflow, alt-screen, and a **wide-character script** — CJK + emoji + combining marks — asserting UTF-16 run tiling and `wcwidth(text) ≤ cols`, including a combining-mark line whose UTF-16 length exceeds its occupied columns, proving the budget is columns rather than string length). Cursor durability tests: replay page → `more:false` tail cursor → new output → tail pull returns exactly the delta; stale cursor → fresh snapshot. Trim tests per §6.2: exact `trimmedBefore`, stable surviving IDs, no ID reuse. Registry lifecycle tests with a mocked peer. `InspectAuditLogger` tests covering every op (subscribe, unsubscribe, replace, each of the four teardown causes) and every refusal code, plus an assertion that no serialized entry contains row text.
- Retention parity regression: the mirror and the renderer construct xterm from the same shared scrollback constant (§1) — one test cross-checks both construction sites so the buffers cannot silently diverge.
- Integration: capability round-trips through the real dispatch path with structured-refusal assertions (no leaked stderr — regression-guard the 2b.2 gotcha). End-to-end catalog/lifecycle (§§1.2–1.3): renderer publishes an agent whose pane is never mounted → `list-ptys` sees it and `pty-rows` serves from the mirror; natural exit → entry `live: false`, retained pull still serves; renderer close/teardown message → mirror disposed and both capabilities refuse.
- Joint acceptance (with the phone, umbrella §10): real iPhone + LAN + live agent; layout-switch reset observed end-to-end; audit entries verified.
- `docs/shared/XBP-PROTOCOL.md` (in ai-xavier; secret, gitignored) gains its PTY Inspect section at acceptance time.
