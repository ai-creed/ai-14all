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
- **Scrollback:** 2000, matching the renderer configuration.
- If implementation reveals a cheaper equally-correct source, the SDD may substitute it — the visibility requirement and the contract semantics are the invariants, not the library choice.

## 2. Serializer + epoch/watermark machinery

Per mirror:

- **Dirty-line tracking:** hook the headless instance's write/scroll/resize callbacks; record dirtied absolute line indices.
- **Coalescer:** 200ms tick (only while dirty lines exist). Each tick: `watermark++`, stamp dirty set with the new watermark, clear the set, emit `pty-changed { sessionId, agentId, epoch, watermark }` to the subscribed peer (if any).
- **Epoch manager:** `epoch++` and full dirty-reset on: resize/reflow, alt-screen enter/exit, mirror (re)creation. Line indices and watermarks are meaningful only within an epoch.
- **Serialization on pull:** read `line.translateToString()` + per-cell attributes from the buffer; compress per-cell attributes into `StyleRun`s (adjacent cells with identical attrs merge). `text.length ≤ cols`, trailing whitespace trimmed.
- **Cursor pagination:** responses capped at 500 rows; continuation cursor encodes `(watermark, line)` ordering internally, opaque to the phone.

## 3. Subscription registry & capability wiring (`xbp-peer-session` layer)

- Registry: at most **one active subscription** for the paired phone; `subscribe-pty` for a new target replaces the previous (mirrors the single-paired-device model).
- Auto-teardown: peer detach, unpair/re-pair, agent exit, session teardown.
- `list-ptys`: enumerate the session's agents → `{ agentId, provider, label, cols, epoch, watermark, live }`.
- Refusal mapping (fail-closed, structured — remember the Slice 2b.2 lesson: no leaked stderr, mem-2026-07-07-…-3c899b): unknown session/agent → `no-such-pty`; session known but agent not running and buffer discarded → `no-live-agent`; anything unexpected → `internal` with a clean message.
- **Post-exit retention:** after an agent exits, keep its mirror readable until session teardown; `subscribe-pty` refuses `no-live-agent`, `pty-rows` still serves. After teardown, both refuse.
- Refusals fire no events (house rule from the acting path).

## 4. Grants & audit

- Add `control:inspect` to `NEW_PAIRING_GRANTS`. Existing pairings lack it — acquiring the capability requires a re-pair (acceptable: single-phone product; surface this in the pairing UI copy if it names granted scopes).
- Audit (existing layered audit log, info level): subscribe, unsubscribe, replace, auto-teardown, and every refusal with its code. Pull contents are **not** logged — only counts (rows served) if the audit layer wants a metric.

## 5. Performance budget

- Coalescer ≤5 hints/sec per subscription under spinner churn; zero work with no subscriber (dirty tracking may stay armed, but no serialization happens without a pull).
- A full 2000-row replay = ≤4–5 pulls at the 500-row cap; each response well under frame-size limits (verify actual XBP frame ceiling during implementation — if tighter than expected, lower the row cap, not the semantics).
- Serialization is on-demand (pull-time) — no caching of serialized rows; the buffer is the cache.

## 6. Edge cases (test these)

1. Spinner redrawing one line at 10Hz — hints coalesce, pull returns just that line re-stamped.
2. Scroll-trim past 2000 — `trimmedBefore` advances; a pull from an old cursor never returns dropped lines.
3. Resize while subscribed — epoch bump, hint carries new epoch, stale-epoch pull answered as fresh snapshot.
4. Alt-screen enter/exit (vim in a pane) — epoch bumps both ways; while active, retained set = viewport, `altScreen: true`.
5. Subscribe to an unmounted pane's agent — rows serve from the mirror at its default/last-known size.
6. Agent exits mid-watch — final hint, then subscribe refusals + rows still pullable until teardown.
7. Phone re-pairs — old subscription torn down with the old peer; `control:inspect` present in the new grant set.
8. Two rapid subscribe-pty calls (agent switch) — second replaces first; no hint leaks for the abandoned target.

## 7. Tests & acceptance

- Unit: serializer against synthetic ANSI scripts (colors, truecolor, inverse, in-place redraw, scroll, resize reflow, alt-screen). Registry lifecycle tests with a mocked peer.
- Integration: capability round-trips through the real dispatch path with structured-refusal assertions (no leaked stderr — regression-guard the 2b.2 gotcha).
- Joint acceptance (with the phone, umbrella §10): real iPhone + LAN + live agent; layout-switch reset observed end-to-end; audit entries verified.
- `docs/shared/XBP-PROTOCOL.md` (in ai-xavier; secret, gitignored) gains its PTY Inspect section at acceptance time.
