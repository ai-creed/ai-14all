# XBP PTY Inspect — Umbrella Design (ai-xavier + ai-14all)

**Date:** 2026-07-17 · **Status:** approved design, pre-implementation
**Owner:** Vu Phan · **Scope:** cross-repo feature design — protocol contract, host serializer, phone viewer
**Children:**
- `2026-07-17-xbp-pty-inspect-xavier-design.md` — contract + phone (runs as SDD in ai-xavier)
- `2026-07-17-xbp-pty-inspect-14all-design.md` — host serializer + grants (runs as SDD in ai-14all, dev-integration)

**Approved mockup:** `~/.ai-pref-nsync/local-docs/ai-xavier/misc/2026-07-17-terminal-watch-mockup-approved.html`

---

## 1. Goal

From the phone, watch the actual terminal of any agent running in an ai-14all session — replay what happened while away, then live-tail — faithfully enough to judge "intervene or leave it alone" without walking to the desktop.

The phone becomes a read-only window onto the desktop xterm: same text, same colors, same grid.

## 2. Non-goals and guardrails

- **No input path.** The contract defines no keystroke, signal, or resize capability. ai-xavier is not a remote shell; read-only is enforced by construction, not by policy.
- No scrollback persistence across host restart; retention is the live xterm buffer only (~2000 scrollback rows + viewport).
- No simultaneous multi-PTY watching on the phone (one PTY on screen at a time; switching is cheap).
- No pixel/image streaming, no font/zoom settings sync. Phone renders rows at its own fixed readable type size.
- Pinch-to-zoom and fit-to-width toggles are v2 candidates, out of scope here.

## 3. Prior decisions honored

- **Symmetric Peer + addressed frames** (mem-2026-06-28-…-171f2e): this feature is the "deferred observation shape" that decision paid for; no core Peer changes are expected.
- **Push is hint, pull is authoritative** (Arc B decision, mem-2026-07-08-…): the PTY stream follows the same law — content-free-ish hints, idempotent pulls.
- **Read-only terminal inspection parked design** (mem-2026-06-28-…-4f3997): replay by sequence + live-tail, no shell control — this spec is that memory's revisit.
- **Layered permission scopes** (`control:read` / `control:act` / `control:notify`): PTY inspection gets its own scope, `control:inspect`, because raw terminal output is the hottest read surface Xavier will expose (echoed secrets, file contents, tokens in command output).

## 4. Architecture overview

```
ai-14all (host)                          XBP (sealed+signed)              ai-xavier phone
┌───────────────────────────┐                                          ┌──────────────────────┐
│ agent PTY ─▶ xterm buffer │   event: pty-changed {epoch, watermark}  │ Terminal watch screen│
│   row serializer          │ ────────────────────────────────────▶    │  row store (by line) │
│   (dirty-line tracker,    │                                          │  styled mono renderer│
│    200ms coalescer,       │   request: pty-rows {epoch, cursor}      │  follow-tail + pill  │
│    epoch manager)         │ ◀────────────────────────────────────    │  agent switcher      │
│ subscription registry     │   ack: rows + runs + watermark           │                      │
└───────────────────────────┘                                          └──────────────────────┘
```

The desktop xterm has already done the hard emulation work (cursor addressing, redraw, reflow). We serialize its **buffer rows**, never raw PTY bytes, so the phone needs no terminal emulator.

## 5. Contract additions (`@ai-creed/command-contract`)

New permission: **`control:inspect`**. Added to `NEW_PAIRING_GRANTS`; existing pairings re-pair to acquire it.

New capabilities (all under `control:inspect`, all fail-closed; refusals fire no events):

| Capability | Request | Success result |
|---|---|---|
| `list-ptys` | `{ sessionId }` | `{ ptys: [{ agentId, provider, label, cols, epoch, watermark, live }] }` |
| `subscribe-pty` | `{ sessionId, agentId }` | `{ cols, epoch, watermark }` — hints start flowing |
| `unsubscribe-pty` | `{ sessionId, agentId }` | `{ ok: true }` |
| `pty-rows` | `{ sessionId, agentId, epoch, cursor }` | `{ epoch, cols, altScreen, watermark, trimmedBefore, rows, cursor }` |

Refusal codes (result-union style, like `LifecycleResult`): `no-live-agent`, `no-such-pty`, `internal`.

New event topic: **`xavier.control.pty-changed`** — payload `{ sessionId, agentId, epoch, watermark }`. Emitted only to a subscribed peer, coalesced to ≥200ms. Carries no row content.

### Row model

```ts
type PtyRow = { line: number; text: string; runs: StyleRun[] };   // text.length ≤ cols
type StyleRun = {
  start: number; len: number;
  fg?: number | { r: number; g: number; b: number };   // 0–255 xterm palette index, or truecolor
  bg?: number | { r: number; g: number; b: number };
  bold?: true; dim?: true; italic?: true; underline?: true; inverse?: true;
};
```

- `line` is the absolute line index **within the current epoch** (stable as scrollback trims; trimming only raises `trimmedBefore`).
- `watermark` is a monotonic per-epoch revision counter. Each coalesce tick stamps all dirty lines with the new watermark.
- `cursor` is an **opaque continuation token**. `null` means "from the start of the epoch" (full replay). A non-null `cursor` in a response means more rows are immediately available — pull again. Responses are capped (host cap, ~500 rows) so a full 2000-row replay is a handful of pulls, safely under frame-size limits.
- **Epoch** increments on anything that invalidates line identity: terminal resize/reflow (desktop layout change), alt-screen enter/exit, serializer restart. On epoch mismatch between request and host, the host answers with a fresh-epoch snapshot (as if `cursor: null`); the phone clears its row store and rebuilds. Resize correctness comes from reset, not incremental patching.

### Flow

1. Phone opens terminal screen → `list-ptys` → render agent chips → `subscribe-pty` for the chosen agent.
2. Replay: `pty-rows` with `cursor: null`, loop while response `cursor` non-null.
3. Live-tail: on each `pty-changed` hint (or screen re-focus), `pty-rows` with last epoch + continuation. Lost hints heal on the next hint or re-focus — no gap-repair machinery.
4. Leave screen / background app → `unsubscribe-pty` (host also auto-tears-down on peer detach).

## 6. Host requirements (ai-14all) — summary

Detail in the 14all child spec. Requirements the host must meet regardless of internal approach:

- **Every agent PTY in a session is watchable, regardless of desktop layout visibility.** A pane not mounted in the current layout must still serve rows. Recommended approach: an `@xterm/headless` mirror per agent PTY in the main process, fed the same byte stream, resized to match the visible pane (default 120 cols when never mounted).
- Rows serialize from the buffer with cell-level styles; dirty-line tracking + 200ms coalescer + per-epoch watermark as in §5.
- One active subscription per paired phone; a new `subscribe-pty` replaces the previous one.
- After an agent exits, its buffer stays pullable until session teardown; `subscribe-pty` then refuses `no-live-agent` while `pty-rows` still serves retained rows. After teardown both refuse.
- Subscribe/unsubscribe/refusals land in the existing layered audit log at info level.
- `control:inspect` added to `NEW_PAIRING_GRANTS`.

## 7. Phone requirements (ai-xavier) — summary

Detail in the xavier child spec. The approved composition (mockup above, ratified 2026-07-17):

- **Header, one strip:** fixed back chevron → pinned identity block (3pt provider spine spanning two lines; workspace name 15/600; subtitle row: 6pt ready-blue dot + LIVE + `· branch` in mono 11 muted) → vertical hairline separator → horizontally scrollable agent chips (pill, provider dot + name; active chip filled `surface-2`, neutral selection; 44pt hit-slop). Chips render only when the session has >1 agent; the spine follows the watched agent's provider color.
- **Terminal panel:** always dark (`#0f1317` family) in both app themes; ANSI palette lifted from 14all's actual xterm theme at implementation. Rows in 11pt mono at fixed cell width; no soft-wrap; horizontal pan with right-edge fade; content width = `cols × cell-width`. Static block cursor, no blink.
- **Follow-tail:** pinned to bottom while following; scrolling up pauses follow and shows the coral pill (`↓ Live · N new`, 44pt); tap returns to tail. The pill is the screen's only brand-chroma element.
- **States:** loading (spinner + "Catching up…" + skeleton rows), empty ("No output yet" + explainer), ended (quiet done-wash banner + relative time; rows kept, never blanked), stream states LIVE / SYNCING via dot + label — never color alone.
- Subscribe on screen focus, unsubscribe on blur/background.

## 8. Security

- Transport: existing sealed+signed XBP channel; no new crypto surface.
- Authorization: `control:inspect` pairing grant, enforced at capability dispatch like `control:act`.
- No input path exists in the contract (§2).
- PTY content is never pushed — hints carry watermarks only; content moves exclusively in acked, grant-checked pulls.
- Push-wake (APNs/Expo) remains content-free and is untouched by this feature.

## 9. Edge semantics (normative)

| Situation | Behavior |
|---|---|
| Phone reconnects after hours | Pull with stale cursor/epoch → snapshot or delta, heals by construction |
| Desktop layout resize | Epoch bump → phone clears + full re-pull (≤2000 rows, a few pulls on LAN) |
| Host restart | New epoch (serializer restart) → same reset path |
| Alt-screen TUI (vim-style) | Epoch bump on enter/exit; while active, retained set = viewport rows, `altScreen: true` |
| Agent exits mid-watch | Final hint; subscribe refuses afterwards; rows remain pullable until session teardown; phone shows ended banner over kept rows |
| Hint lost in transit | Next hint or screen re-focus triggers pull; no dedicated repair |
| Spinner redraw churn | Coalescer collapses to ≤5 hints/sec; pulls return only re-stamped lines |

## 10. Testing & acceptance

- **Contract:** round-trip encode/decode tests for all four capabilities + event payload (ai-xavier).
- **Host:** serializer unit tests against synthetic ANSI — in-place spinner redraws, color runs, scroll-trim past 2000, resize reflow epoch bump, alt-screen flip (ai-14all).
- **Phone:** TDD on pure helpers — row-store reducer (apply pull, epoch reset, trim), follow-tail state machine, run→style mapping (ai-xavier).
- **Joint acceptance (house tradition):** real iPhone + real LAN + real 14all running a live agent; verify replay, live-tail latency feel, layout-switch reset, agent switcher, ended state, re-pair with `control:inspect`.
- `docs/shared/XBP-PROTOCOL.md` (secret, gitignored) gains a PTY Inspect section as part of acceptance, not before.

## 11. Delivery plan

1. **ai-xavier SDD** — contract types + phone screen against contract fixtures/mocked host. Version-bump `@ai-creed/command-contract`.
2. **Publish/vendor the contract bump** for 14all consumption (same flow as Slice 2a).
3. **ai-14all SDD** (dev-integration worktree) — host serializer, subscriptions, grants, audit.
4. **Joint real-device acceptance** + protocol doc update + memory capture.

One whisper workflow per repo (mem-2026-07-02-…-16c76e); the umbrella spec is synced into both repos so each workflow reads the same truth.
