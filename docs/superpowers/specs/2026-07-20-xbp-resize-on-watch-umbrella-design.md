# XBP Resize-on-Watch — Umbrella Design (R1 core + R2 duplication mitigation)

**Date:** 2026-07-20 · **Status:** approved design, ready for per-repo SDD
**Parent seed:** `2026-07-19-xbp-native-prompt-input-seed.md` **leg 1** (resize-on-watch — the ratified rendering direction), building on the shipped watch-latency arc (`2026-07-19-xbp-pty-watch-latency-l1-design.md`, `…-l2-phone-design.md`, and the L2 host serializer).
**Spike:** `~/.ai-pref-nsync/local-docs/ai-xavier/misc/2026-07-19-resize-on-watch-spike.html` (real Claude Code, live PTY resized 110→53→110 mid-session, replayed through @xterm/headless).

This umbrella is normative for the contract delta, the resize/watch lifecycle, and the shared rendering semantics. Child specs:

- ai-14all: `2026-07-20-xbp-resize-on-watch-14all-design.md` (host PTY resize + `set-watch-viewport` handler + viewer policy + R2 desktop presentation).
- ai-xavier: `2026-07-20-xbp-resize-on-watch-phone-design.md` (contract v7 + phone geometry report + verbatim gate + multi-epoch divider + R2 "Show earlier" collapse).

Scope is **R1 core + R2 duplication mitigation**. The one-shot overlap-trim polish (seed) is **R3, deferred**. Legs 2 (phone input bar) and 3 (status strip) of the parent seed are out of scope.

---

## 1. Problem & direction

The phone renders desktop-width PTY rows through reflow heuristics (`pty-reflow.ts` v2.1). Heuristics are secretly tuned per provider (glyphs, indent idioms, box styles) and can never be native quality. The seed's ratified direction: when the phone actively watches, the 14all host **resizes the real PTY to phone geometry (SIGWINCH)**; the agent TUI — whatever the provider — repaints itself natively at phone width, and the phone renders a faithful narrow grid with **no reflow heuristics for live content**. Provider-neutral at the *rendering* level, not just transport. Watch ends → resize back.

**Spike finding (the cost to mitigate):** a narrow SIGWINCH repaint re-renders the entire visible transcript natively at the new width, but each resize **appends a duplicate copy** — one watch cycle leaves scrollback reading wide→narrow→wide. Viewport-only TUIs (alt-screen, ratatui) repaint only the visible screen — no duplication, but no free native history either. Both are strictly ≥ today's all-heuristics rendering.

## 2. Ratified decisions

1. **Dedicated `set-watch-viewport` capability** (not baked into `subscribe-pty`). The phone measures its panel *after* mount, so a subscribe-time geometry would fire before measurement; a dedicated call also handles mid-watch rotation. `control:inspect`, low-risk — the resize is a bounded, auto-reverting consequence of watching, never agent control (§3).
2. **Resize both cols AND rows** to the phone's measured viewport (with a `MIN_FLOOR`), so full-screen/alt-screen TUIs fit the phone and normal TUIs paint a phone-sized screen (older lines scroll to scrollback, backfilled by L2).
3. **Multi-epoch phone transcript.** The phone retains the pre-resize (old-epoch) copy **above a watch-start divider** rather than discarding it (today's dim-and-swap). This is load-bearing: for viewport-only TUIs the new epoch holds *only* the visible screen, so the pre-watch history exists *only* in the old epoch.
4. **Verbatim gate.** When `hostCols ≤ phoneCols`, reflow heuristics are bypassed — rows render 1:1 (a near-full native row would otherwise trip the join threshold and re-join the app's already-correct wraps).
5. **Viewer policy:** the active phone watch owns the geometry; a real desktop keystroke to that terminal restores desktop geometry and suspends phone-resize until the phone re-asserts / the desktop blurs.
6. **Debounce-both churn policy** (§4): resize only after the watch is stable ~300ms (glances never disrupt the desktop); restore after a ~1s grace (rapid blur/refocus doesn't thrash); hard-restore immediately on real teardown.
7. **`MIN_FLOOR = 40` cols** (and a matching rows floor) guards TUIs that misbehave when very narrow; validate per provider on device (only Claude Code is spike-verified).
8. **Duplication mitigation is view-level, never buffer surgery** — buffers stay complete; only presentation collapses, and every mechanism fails open (§6–§7).

## 3. Contract delta (v6 → v7)

One new capability, one version bump. `@ai-creed/command-contract` `0.1.0-alpha.5 → 0.1.0-alpha.6`, `COMMAND_CONTRACT_VERSION 6 → 7`.

```ts
export const SetWatchViewportArgs = z.object({
  worktreeId: z.string(),
  agentId: z.string(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export const SetWatchViewportResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  ptyRefusal, // no-live-agent | no-such-pty | internal — the existing PTY refusal shape
]);
```

- Capability id `controlId("set-watch-viewport")`, `permission: CONTROL_INSPECT`, `risk: "low"`, `requiresConfirmation: false`.
- Everything else stays v6 semantics (rows/cursors/epochs/watermarks/`pty-changed` and the L2 tail/before channel are unchanged).
- **Compatibility:** a v6 host has no `set-watch-viewport` handler → it refuses `unknown-capability` (or the phone's call is a no-op); the phone falls back to today's desktop-width reflow. No handshake gating; the phone ships v7 before the host, exactly as L2 did.

## 4. Watch lifecycle (normative)

Resize-on-watch rides the phone's **existing** watch boolean — no new lifecycle.

- **`watching = isFocused && appActive`** (`use-terminal-watch.ts`), per active agent. `isFocused` = the terminal screen is the current route; `appActive` = `AppState === "active"`. This already drives `subscribe-pty` / `unsubscribe-pty`.
- **Start watching → resize.** When `watching` is true for the selected agent *and* the panel has been measured, the phone sends `set-watch-viewport(cols, rows)` — but only after `watching` has been **stable ~300ms** (glance guard). It re-sends on rotation / geometry change while watching. The host resizes on receipt.
- **Stop watching → restore.** `watching` goes false (blur, background/inactive, agent switch, unmount, agent-end) → `unsubscribe-pty` fires (as today). The host restores desktop geometry after a **~1s grace**; a re-watch (new `set-watch-viewport`) within the grace cancels the pending restore. A real watcher **teardown/peer-disconnect** (app kill, network drop, re-pair) restores **immediately** — an explicit `unsubscribe` cannot be relied on there.
- **Agent switch** = stop-A (restore A's PTY) + start-B (resize B). Each watched agent's PTY is phone-sized only while it is the active watched agent.

The phone does not distinguish blur from unmount to the host; both send `unsubscribe`, and the ~1s grace + hard-restore-on-teardown covers every case.

## 5. Host resize semantics (normative)

- The terminal service owns the real node-pty and tracks `desktopGeometry` (the embedded terminal's current cols/rows).
- On `set-watch-viewport(cols, rows)`: clamp to `[MIN_FLOOR … desktopGeometry]` per axis, coalesce rapid calls (rotation bursts), then `pty.resize(cols, rows)` → SIGWINCH → the TUI repaints → `PtyMirror.resize` bumps the epoch (existing behavior). Record that this PTY is phone-resized.
- On restore (grace-elapsed `unsubscribe`, or immediate teardown): `pty.resize(desktopGeometry)` → epoch bump → the TUI repaints wide.
- **Viewer policy:** while phone-resized, a real desktop keystroke routed to that PTY restores `desktopGeometry` and marks the PTY desktop-owned until the phone re-asserts geometry or the desktop blurs. Phone watch otherwise wins.
- Epoch/watermark/trim/cursor semantics are untouched — resize is the existing `PtyMirror.resize` path; this feature only *triggers* it from a phone watch and *reverts* it.

## 6. Phone rendering semantics (normative)

- **Verbatim gate.** In the render pipeline, when the current-epoch `hostCols ≤ phoneCols`, bypass the reflow heuristics entirely and render each row 1:1 (still slicing style runs per row). Above that width, reflow v2.1 applies (pre-watch/desktop-width epochs).
- **Multi-epoch transcript.** The store retains rows across a watch-start epoch bump. The transcript renders oldest→newest with a **divider** at each epoch boundary; the newest (phone-width) epoch renders verbatim, older (desktop-width) epochs render through reflow. The list **lands at the bottom** of the newest epoch (already bottom-anchored). Only the **active (newest) epoch is backfillable** via L2 tail/before — the L2 backward cursor is epoch-scoped and dies on the watch-start epoch reset, and the host serves only the current epoch. **Older epoch segments are frozen at their cached extent** (what was fetched before the resize) and show a static cap; deeper pre-watch history needs addressable epoch snapshots the v7 protocol lacks (§9 deferred).
- **R2 "Show earlier" collapse.** Everything above the newest watch-start divider defaults to a **collapsed section** ("Show earlier"); tapping expands it, issuing no request. Fails open — collapse never mutates the store; expanding reveals exactly the **cached** old-segment rows (it does not imply the full pre-resize history is present). For Ink-style full repaints this hides the duplicate (the active epoch already holds the whole transcript at phone width); for viewport-only TUIs it is the cached pre-watch tail.

## 7. Desktop presentation — R2 (normative, ai-14all renderer)

During an active phone watch, the desktop **freezes** the embedded terminal at the pre-watch wide render and shows a **"phone watching" chip**; the watch period collapses into a **pleat** ("phone watched HH:MM–…"). Narrow-epoch bytes feed the phone but never repaint the desktop presentation, reducing desktop duplication to the single watch-end wide repaint. Expanding the pleat may reveal the live narrow view. Restore to the live desktop render on watch-end.

## 8. Slice split & sequencing

Two cross-repo arcs, one SDD workflow per repo (`mem-2026-07-02`):

- **R1 (core):** contract v7 (ai-xavier) → host resize + `set-watch-viewport` + viewer policy (ai-14all) → phone geometry report + verbatim gate + multi-epoch divider + land-at-bottom (ai-xavier). Delivers native narrow rendering with a clean seam.
- **R2 (duplication mitigation):** phone "Show earlier" collapse (ai-xavier) + desktop frozen-snapshot/chip/pleat (ai-14all renderer).

Contract publishes before the ai-14all host SDD (same rule as L2). Within R1, the phone can develop against a mocked `set-watch-viewport` API; on-device joint acceptance is gated on the host landing.

## 9. Joint acceptance (on device, operator-run)

- Watching a live session narrows the desktop PTY; the phone shows a native, verbatim narrow grid with no reflow seams on live content; the desktop shows the "phone watching" chip.
- A watch-start epoch divider appears; the phone lands at the bottom of the new native epoch; pre-watch history sits above it, collapsed under "Show earlier".
- Blur/background/agent-switch restores the desktop geometry (after the grace); a glance under ~300ms never resizes the desktop; rapid blur/refocus does not thrash.
- Alt-screen / viewport-only TUIs: the new epoch shows the native screen; pre-watch history stays available above the divider.
- A v7 phone against a still-v6 host degrades to today's desktop-width reflow (no resize, no crash).

Deferred (not this arc): **addressable epoch snapshots** — a host archival / epoch-selector endpoint so the phone can page an *old* epoch beyond its cached extent (R1/R2 bound old segments to what was cached at resize); **R3** one-shot overlap-trim at resize boundaries; parent-seed legs 2 (phone input bar) and 3 (native status strip); disk-persistent history.
