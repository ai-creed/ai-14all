# XBP Resize-on-Watch — ai-14all Child Spec (host PTY resize + viewer policy + desktop presentation)

**Date:** 2026-07-20 · **Status:** approved design, ready for SDD
**Parent:** `2026-07-20-xbp-resize-on-watch-umbrella-design.md` (normative for the contract, watch lifecycle, resize semantics — read it first).
**Base:** the shipped PTY-inspect/reflow/L2 host on this worktree (`services/pty-inspect/*`, `services/terminals/terminal-service.ts`, contract v6 = `0.1.0-alpha.5` vendored).

Everything deliverable inside ai-14all: the vendored contract bump to v7, the `set-watch-viewport` handler that SIGWINCHes the real PTY to phone geometry, the restore/grace/teardown lifecycle, the viewer policy (phone owns geometry; desktop auto-fit yields; a desktop keystroke reclaims), and the **R2** desktop presentation (frozen snapshot + "phone watching" chip + pleat). The phone consumes all of this via the ai-xavier child.

---

## 1. Re-vendor contract v7 (`package.json`, `vendor/`)

- Pack the published contract at `0.1.0-alpha.6` from ai-xavier (`pnpm --filter @ai-creed/command-contract build`, then `pnpm --filter @ai-creed/command-contract pack --pack-destination <ai-14all>/vendor/`), drop `ai-creed-command-contract-0.1.0-alpha.6.tgz` into `vendor/`, bump both `file:` refs (dependencies + resolution) from `…alpha.5.tgz`, `pnpm install`. Keep prior tarballs. Same mechanism as the L2 re-vendor.

## 2. `set-watch-viewport` handler (R1)

**Capability wiring (`services/xbp/xbp-peer-session.ts`):** register `setWatchViewportCapability` (from the vendored v7 contract) → a new `PtySubscriptionRegistry.setWatchViewport(worktreeId, agentId, cols, rows)` method, alongside the existing `subscribe`/`pullRows`/`unsubscribe` wiring. Schema-valid refusal union (`no-live-agent` | `no-such-pty` | `internal`), never throws for expected refusals.

**Registry method (`services/pty-inspect/pty-subscription-registry.ts`):**
- Resolve the session via the catalog (same lookup as `pullRows`); no live session → `no-such-pty` / `no-live-agent`.
- On the **first** `set-watch-viewport` for a session, capture the current PTY geometry as `preWatchGeometry` and mark the PTY **phone-owned** (suspends desktop auto-fit for it, §4).
- Clamp `cols`/`rows` to `[MIN_FLOOR … preWatchGeometry.axis]` per axis (`MIN_FLOOR = 40` cols; a matching rows floor). Never resize wider/taller than the desktop originally was.
- **Coalesce** rapid calls (rotation bursts) with a short trailing debounce; apply only the latest geometry.
- Apply via the terminal service: `TerminalService.resize(sessionId, cols, rows)` (`terminal-service.ts:370`) — this resizes the real node-pty (SIGWINCH → TUI repaints) **and** the teed mirror, whose `resize()` bumps the epoch. No change to `PtyMirror` itself.
- Idempotent: the same geometry re-sent is a no-op (skip the resize).

## 3. Restore lifecycle (R1)

- **Grace restore on watch-end.** `unsubscribe-pty` (the phone's stop-watching, §umbrella-4) schedules a restore after **~1s**; a new `set-watch-viewport` (re-watch) before it fires **cancels** it. On fire: resize the PTY back to the desktop's current fit geometry (§4), clear phone-owned, re-enable desktop auto-fit.
- **Hard restore on teardown.** `pty-inspect-service.ts` teardown (`peer-detach` / `re-pair` / `session-teardown`) restores **immediately**, no grace — an explicit `unsubscribe` is not guaranteed on app-kill / network-drop.
- Restore targets the desktop's **current** desired geometry (the desktop may have been resized during the watch), not a stale `preWatchGeometry` snapshot — see §4.

## 4. Viewer policy (R1)

- While a PTY is phone-owned, the desktop's fit-addon-driven auto-resize for that terminal is **suspended** (otherwise desktop fit and phone geometry fight). The desktop still tracks its *desired* geometry (container size) without applying it to the PTY.
- **Desktop reclaim:** a real user keystroke routed to that terminal restores the desktop's desired geometry immediately and marks the PTY desktop-owned until the phone re-asserts (`set-watch-viewport`) or the desktop blurs. Phone watch otherwise wins.
- On restore (§3), the PTY resizes to the desktop's *current* desired geometry and auto-fit resumes.

## 5. Desktop presentation — R2 (`src/features/terminals/…`)

- While a PTY is phone-owned, the embedded desktop terminal view **freezes** at the pre-watch wide render and shows a **"phone watching" chip** (provider/agent + elapsed). Narrow-epoch bytes keep feeding the mirror (and the phone) but do **not** repaint the frozen desktop view.
- The watch period collapses into a **pleat** ("phone watched HH:MM–…") in the desktop scrollback; expanding it may reveal the live narrow view.
- On watch-end, unfreeze and restore the live desktop render (which re-fits per §4).
- View-level only — the mirror/PTY buffers are untouched (umbrella §2.8).

## 6. Tests

**Contract/vendor:** all pre-existing pty-inspect/reflow/L2 suites green against the v7 vendored tarball.

**`set-watch-viewport` (extend `pty-subscription-registry` unit tests):**
1. A `set-watch-viewport(cols, rows)` on a live session calls `TerminalService.resize(sessionId, cols, rows)` once, clamped to `[MIN_FLOOR…desktop]`; a too-narrow request clamps to `MIN_FLOOR`; a no-session request refuses `no-such-pty`.
2. First call captures `preWatchGeometry` and marks phone-owned; the same geometry re-sent is a no-op (no second resize).
3. Rapid calls coalesce to a single resize at the latest geometry.

**Restore lifecycle:**
4. `unsubscribe` schedules a restore that fires after the grace and resizes to the desktop's current geometry; a `set-watch-viewport` within the grace cancels it (no restore).
5. Teardown (`peer-detach`) restores immediately with no grace.

**Viewer policy:**
6. While phone-owned, a simulated desktop auto-fit does not resize the PTY; a simulated desktop keystroke reclaims (restores desktop geometry, marks desktop-owned).

**R2 desktop presentation** (renderer unit/component tests): the terminal view enters the frozen "phone watching" state when its PTY is phone-owned and restores on watch-end; narrow bytes do not repaint the frozen view.

## 7. Definition of done (ai-14all scope only)

- Contract vendored at `0.1.0-alpha.6` (v7); all pre-existing suites green.
- `set-watch-viewport` handler resizes the real PTY + mirror via `TerminalService.resize`, clamped and coalesced, with the §6 tests green.
- Restore lifecycle: grace restore on `unsubscribe` (cancellable), immediate restore on teardown, targeting the desktop's current geometry — §6.4–6.5 green.
- Viewer policy: desktop auto-fit yields while phone-owned; desktop keystroke reclaims — §6.6 green.
- R2 desktop presentation (frozen snapshot + chip + pleat) lands with its renderer tests; PTY/mirror buffers untouched.
- No phone-side behavior claimed here; joint acceptance per umbrella §9 after both repos land.
