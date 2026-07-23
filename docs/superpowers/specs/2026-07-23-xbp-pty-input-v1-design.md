# XBP PTY Input (V1) — Umbrella Design (ai-xavier + ai-14all)

**Date:** 2026-07-23 · **Status:** approved design, pre-implementation
**Owner:** Vu Phan · **Scope:** cross-repo feature design — the terminal **input** path (contract + phone + host)
**Roadmap:** v1.0 workstream **V1** (interactive PTY input). Reverses the former "remote terminal (interactive shell)" non-goal — see `docs/shared/product-map-and-roadmap.md` § Never. Defines the scope of the v1.0 security review (V6).
**Handoff basis:** `docs/superpowers/brainstorm/2026-07-23-v1-pty-input-handoff.md`.
**Read-side counterpart:** `docs/superpowers/specs/2026-07-17-xbp-pty-inspect-umbrella-design.md` (ratified). V1 is the write half of that read-only watch.
**Children (SDD inputs):**
- `2026-07-23-xbp-pty-input-xavier-design.md` — contract capability + phone input dock (runs as SDD in ai-xavier)
- `2026-07-23-xbp-pty-input-14all-design.md` — host input handler + grant + audit (runs as SDD in ai-14all, dev-integration)

---

## 1. Goal

Let the phone send real input into a **live agent PTY the host already owns** — so you can answer a Claude Code prompt, send a follow-up instruction, or interrupt a runaway from the phone instead of walking to the desktop.

The primary job is **answering agent prompts and follow-ups**, not driving an interactive shell. Input targets an existing, host-spawned PTY under the host's authority; the phone never spawns a session, never escalates, never executes locally.

## 2. Relationship to resize-on-watch (already shipped)

Prompts render cleanly on the phone because **resize-on-watch already ships** — this spec builds on it, it does **not** redefine it:

- The contract already declares **`set-watch-viewport`** under **`control:inspect`** (`risk: low`), deliberately reasoned in-source as *"a bounded, auto-reverting consequence of watching, never agent input."* Its result is `{ ok: true }`.
- The phone already reports its measured geometry during a watch (`use-terminal-watch.ts` calls `callSetWatchViewport(worktreeId, agentId, geo.cols, geo.rows)`), so the host SIGWINCHes the real agent PTY to phone width (**phone wins while watching**); the epoch bump flows through the normal `pty-changed` hint. A `v6`-host fallback (result `null`) leaves the phone on client-side reflow.
- **Remaining resize-on-watch work is host-side only** (the ai-14all SIGWINCH + restore-desktop-geometry-on-unwatch), tracked as its own item; it is *not* part of this spec's new design and is *not* re-gated. This umbrella lists it in the host child only for coordination.

Net: V1's genuinely-new surface is the **input path** — one new capability, `pty-input`, under a new **`control:pty-write`** permission. `control:inspect` stays strictly read-only.

## 3. Non-goals and guardrails

- **No session spawn, no new PTY.** Input reaches only PTYs the host already spawned and reports as `live`.
- **No shell escalation / no arbitrary spawning.** Input injects bytes into an existing agent session; it grants no execution authority beyond what that session already has.
- **Not an interactive shell driver.** The design bar is prompt-answering and follow-ups.
- **No raw-byte synthesis on the phone.** The phone sends named keys + text; the host owns all byte translation.
- **No per-keystroke streaming.** Input is submitted per event (a text submission or one named key).
- **Scope = live agent PTYs only.** A dead/ended/unknown agent rejects input.
- **No local grid echo.** The terminal panel updates only from authoritative host pulls.

## 4. Prior decisions honored

- **Dedicated hot-surface scopes** (read-side umbrella §3): the read path minted `control:inspect`; V1 mints **`control:pty-write`** for injecting input — the symmetric "this phone may type into the live session" boundary.
- **The phone runs no emulator** (read-side umbrella §4): the phone never produces raw PTY bytes; it sends named keys + text, the host translates.
- **Push is hint, pull is authoritative** (`mem-2026-07-08`): input causes a host redraw that arrives through the *existing* `pty-changed` → `pty-rows` loop. V1 adds no new event topic.
- **Tail-first replay + epoch reset shipped** (`mem-2026-07-19-…-0bdd54`, verified in `use-terminal-watch.ts`, `pty-agent-cache.ts`, `pty-reflow.ts`): the machinery that absorbs a resize-induced epoch bump is already in place; input's redraw rides the same path.
- **`LifecycleResult`-style union + layered audit** (`mem-2026-07-02-xbp-acting-design-contract`): the executor returns a schema-valid discriminated union and never throws for an expected refusal; audit is layered (automatic protocol entry per request + a semantic entry).
- **Second factor = the pairing grant** (same memory): no per-device token; the device is sealed + signed and grant-checked at SAS-confirmed pairing. V1 keeps this and adds a host arm toggle (§5.4).
- **PTY addressing + error style** (`packages/command-contract/src/capabilities/pty-inspect.ts`): PTY capabilities address by `{ worktreeId, agentId }`, name args `…Args`, and refuse with a shared `{ no-live-agent | no-such-pty | internal }` style — *not* the lifecycle `unknown/ambiguous-worktree` codes. `pty-input` follows its siblings.

## 5. Contract additions (`@ai-creed/command-contract`)

### 5.1 Permission

New permission **`control:pty-write`** (new constant in `descriptor.ts` alongside `CONTROL_INSPECT` / `CONTROL_ACT` / `CONTROL_READ`), added to `NEW_PAIRING_GRANTS`. Existing pairings must re-pair to acquire it — fails closed; pre-V1 pairings gain no input rights silently.

### 5.2 Capability

One new capability **`pty-input`**, sibling to the `pty-inspect` family, under `control:pty-write`, `risk: high`, `requiresConfirmation: false` (the `⌃C` confirm is phone-side UX, not a per-request host gate). Fail-closed — a refused request fires no events.

### 5.3 Types (aligned to `pty-inspect.ts` conventions)

```ts
export const PtyInputKey = z.enum(["enter", "up", "down", "esc", "ctrl-c"]);
export type PtyInputKey = z.infer<typeof PtyInputKey>;

// `{ text }` is PRINTABLE-only — C0 (U+0000–U+001F), DEL (U+007F), and C1
// (U+0080–U+009F) controls are rejected, so free text cannot synthesize the
// bytes the named keys own (ETX 0x03 = ctrl-c, ESC 0x1B = esc, CR 0x0D = enter)
// or NUL. Named keys are the ONLY path to control bytes (§3, "no raw-byte
// synthesis on the phone"); this also keeps ⌃C behind its confirm gate.
export const PtyText = z.string().min(1).regex(/^[^\u0000-\u001F\u007F-\u009F]+$/u);

// Exactly one of text | key per chunk. BOTH members are `.strict()`: zod strips
// unknown keys by default, so a non-strict union would accept `{ text, key }`
// (matching the first member and dropping `key`). `.strict()` makes both
// `{ text, key }` and `{}` fail to parse. (Verified against zod 4.4.3.)
export const PtyInputChunk = z.union([
  z.object({ text: PtyText }).strict(),
  z.object({ key: PtyInputKey }).strict(),
]);
export type PtyInputChunk = z.infer<typeof PtyInputChunk>;

export const PtyInputArgs = z.object({
  worktreeId: z.string(),
  agentId: z.string(),
  chunks: z.array(PtyInputChunk).min(1),   // ordered
});
export type PtyInputArgs = z.infer<typeof PtyInputArgs>;

export const PtyInputErrorCode = z.enum([
  "no-live-agent",       // agent PTY not live (ended / dead)
  "no-such-pty",         // unknown agent / worktree PTY
  "pty-input-disabled",  // host arm toggle is OFF
  "internal",
]);

export const PtyInputResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), appliedAt: z.number().int().nonnegative() }),
  z.object({ ok: z.literal(false), code: PtyInputErrorCode, message: z.string().optional() }),
]);
export type PtyInputResult = z.infer<typeof PtyInputResult>;
```

- **Malformed requests** (empty `chunks`, a chunk with neither/both of `text`/`key`, an empty `text`, an unknown `key`, **or a `{ text }` carrying a terminal control byte** — ETX/ESC/CR/LF/NUL/DEL/C1) are rejected at the **schema/protocol layer** — never as a result-union code. The control-byte rejection is the schema-level enforcement of "no raw-byte synthesis" (§3): free text cannot reach the bytes the named keys own, so `⌃C` stays behind its confirm gate.
- **Missing `control:pty-write`**, and tamper / forge / replay, are handled at the **protocol layer** (Peer → `rejected`); no result code.
- The executor **always** returns a schema-valid result for expected refusals and never throws; the Peer records `accepted` and the refusal rides back in the ack. Only an *unexpected* throw becomes a Peer handler-error → protocol `rejected` (fail-closed net). Mirrors the acting path.

### 5.4 Named-key translation (host-owned)

The phone never emits these bytes:

| Chunk | Bytes written to PTY |
|---|---|
| `{ text }` | UTF-8 encoding of the string |
| `{ key: 'enter' }` | `\r` (CR, `0x0D`) |
| `{ key: 'up' }` | `\x1b[A` |
| `{ key: 'down' }` | `\x1b[B` |
| `{ key: 'esc' }` | `\x1b` (`0x1B`) |
| `{ key: 'ctrl-c' }` | `\x03` (ETX → SIGINT via the pty line discipline) |

Chunks in a single request are written **in order**, as one contiguous write.

### 5.5 Host arm toggle

A host-side enable flag (mirrors acting's `isActingEnabled`) named **`isPtyInputEnabled`**, **default `true`**. Granting `control:pty-write` is itself the deliberate, re-pair-gated opt-in, so the toggle is a **live disarm switch** rather than a default-off gate. When `false`, `pty-input` refuses `pty-input-disabled`. The always-available V4 kill switch remains the master off. This divergence from acting's default-off is intentional and recorded for V6 (§8).

### 5.6 Echo path (no new event)

Input causes an agent redraw that surfaces through the existing read-side `xavier.control.pty-changed` hint and the `pty-rows` pull. `pty-input` returns no rows — its echo arrives purely via the hint→pull loop.

### 5.7 Grant disclosure (`session-report`)

The phone gates the dock on holding `control:pty-write`, but nothing in the trust path discloses that to the phone today: `PairingOffer` is pre-trust QR data with no scopes, `PairedHost` persists only keys + URL, and the phone grants **nothing** to the host (`peer.addPeer(..., [])`). V1 adds one **optional** field to `SessionReportResult` — `grantedScopes?: string[]` — the authenticated (sealed + signed, `control:read`) host→phone disclosure of the scopes granted to *this* pairing, fetched every connect and never persisted.

- **Optional on the wire**, exactly like the read side's v6 `cursorBefore`/`moreBefore` (`pty-inspect.ts`): the phone ships before the host (§11), so a v7 host omits the field and the phone must still parse the report. A *required* field would fail-parse a v7 report at `Peer.call`'s `cap.result.safeParse`, null the report, and panic reconnect — bricking the phone against a not-yet-upgraded host. Absent ⇒ dock hidden (fail-closed).
- The **host populates it** from the live pairing grant set (14all child §1.1); the **phone reads it** through a `canPtyWrite` selector and shows the dock only when it contains `control:pty-write` **and** the PTY is live (xavier child §3.3).

## 6. Host requirements (ai-14all)

Detail in the 14all child spec:

- **`pty-input` handler.** Resolve `{ worktreeId, agentId }` to the live PTY handle the host already holds (the handle it spawned the agent through); translate chunks to bytes per §5.4 and `write()` them in order as one contiguous write; return `{ ok: true, appliedAt }`. Refuse `pty-input-disabled` (toggle off), `no-live-agent` (not live), `no-such-pty` (unknown).
- **Grant enforcement** at capability dispatch, like `control:act`: missing `control:pty-write` → protocol `rejected`.
- **Arm toggle** `isPtyInputEnabled` (default on) with a disarm control in the host UI.
- **Layered audit** (§8): one automatic protocol entry per dispatched request; one semantic entry per submitted input capturing the **full literal** chunk content and outcome.
- **`control:pty-write`** added to the host grant registry / `NEW_PAIRING_GRANTS`.
- **`session-report.grantedScopes` populated** from this pairing's live grant set (§5.7) — the phone's authoritative, fail-closed dock-gate signal; always sent by this V1 host.
- **(Coordination, not new here)** Finish the resize-on-watch host leg if still pending — SIGWINCH the PTY to the reported viewport on watch and restore desktop geometry on unwatch/detach. Gated by `control:inspect` (shipped decision), independent of `pty-input`.
- No new PTY is ever created by this path.

## 7. Phone requirements (ai-xavier)

Detail in the xavier child spec. The approved composition (visual brainstorm, 2026-07-23):

- **API seam.** `PtySessionApi.callPtyInput(worktreeId, agentId, chunks)` (sibling to the existing `callSetWatchViewport` / `callPtyRows`).
- **Input dock (layout A).** A two-tier dock below the terminal panel: a key bar `⌃C ┊ ↑ ↓ Esc ⏎` above a compose row (`text field` + circular Send). `⌃C` is pinned far-left behind a hairline divider and red-tinted (out of the resting-thumb corner); `⏎` (bare Enter) sits far-right, stacked over Send. All key targets ≥ 44pt.
- **Send model (split, strict).** The compose box stages free text; Send / keyboard-Return submits `[{text},{key:'enter'}]` as one event (Send disabled on empty text). Key-bar keys fire **immediately**, one event each, and **never read the compose buffer**: `⏎` → `[{key:'enter'}]`, `↑`/`↓` → single arrow, `Esc` → `[{key:'esc'}]`.
- **`⌃C` confirm.** Tapping `⌃C` sends nothing; it raises a destructive confirm sheet whose **Interrupt** action sits at the bottom center (away from `⌃C`), so a fast double-tap hits the dismiss scrim. Copy names the stakes (SIGINT, hard to restart from phone). No "don't ask again". `⌃C` is the only gated control.
- **Keyboard-up (option B).** When the compose box is focused, the dock rides above the keyboard but the **key bar collapses** — only the compose row stays, giving the terminal ~30% more height. This is a phone-side scroll/layout change only. **It must not re-report the viewport** (no resize thrash): the phone keeps reporting its stable keyboard-down geometry to the shipped `set-watch-viewport` path.
- **No grid echo + sent/syncing affordance.** On submit, show a brief "sent · syncing" state on the submit control until the next `pty-changed` hint lands, then clear.
- **Grant- and live-gated dock.** The dock renders only when the phone holds `control:pty-write` **and** the watched agent's PTY is `live`. The phone learns it holds `control:pty-write` from the authenticated `session-report.grantedScopes` (§5.7); absent or omitting the scope ⇒ dock stays hidden (fail-closed). A read-only phone sees no dock. On session end, the dock disappears and the read-side "ended" banner covers it; a stale in-flight send is answered `no-live-agent`.
- **Agent switch clears staged text.** Switching agent chips clears any unsent compose text. Immediate keys always target the currently-active agent.
- **Submit snaps to tail.** Sending input re-engages follow-tail so the redraw is visible.
- **Phone-side sent log.** The phone keeps a local record of what it sent, consistent with the host's authoritative audit.

## 8. Security (V6)

- **New surface:** an authenticated, paired phone injecting bytes into a live agent PTY under host authority. V1 defines V6's scope; V1 must land before V6 starts.
- **Clean boundary:** input (the session-mutating write) sits under the new dedicated **`control:pty-write`**; `control:inspect` remains strictly read-only. Resize-on-watch keeps its shipped `control:inspect` gating (a bounded, auto-reverting consequence of watching — the deliberate prior decision).
- **Guardrails (must stay intact and be verified):**
  - Capability-gated by `control:pty-write`; fails closed for pre-V1 pairings.
  - Rides the existing **sealed + signed + anti-replay** envelope; no new crypto surface.
  - **Audited** with full literal input content (below).
  - Covered by the always-available **V4 kill switch** plus the host **disarm toggle** (`isPtyInputEnabled`).
  - **No session spawn / no escalation**; host-owned **live** PTYs only.
- **Audit content:** the semantic entry records the **full literal** injected input (named keys verbatim, free text verbatim). Maximum forensic value for the hottest write surface; the operator owns both ends. Accepted tradeoff: an occasionally-typed secret persists in the audit sink.
- **Layered audit structure** (mirrors the acting path):
  - **Protocol layer:** every dispatched `pty-input` request gets exactly one `XbpAuditSink` entry `{ ts, cap: 'pty-input', risk: 'high', outcome, reason? }`, automatic in `Peer.dispatchRequest`.
  - **Semantic layer:** an **executed** input (passed grant + arm toggle + live-agent resolution) writes **one** entry with literal `chunks` and `route: 'apply'`; input is atomic, so no start+result pair. An **executor-level refusal** writes a **single** entry with `route: 'reject'` and the code. **Pre-dispatch protocol rejections** (missing grant, tamper / forge / replay) get a protocol entry and no semantic entry.
- **`⌃C` confirm is a UX safety guard, not a security boundary** — the host enforces authorization regardless of phone-side confirmation.
- **Intentional divergence, recorded for V6:** `isPtyInputEnabled` defaults **on** (acting's `isActingEnabled` defaults off), because the dedicated grant is the deliberate opt-in.

## 9. Edge semantics (normative)

| Situation | Behavior |
|---|---|
| Agent exits between compose and send | Send refused `no-live-agent`; phone hides dock, shows ended banner over kept rows |
| Arm toggle turned off on host mid-compose | Send refused `pty-input-disabled`; phone surfaces "input disarmed on host" |
| `control:pty-write` revoked (re-pair without it / unpair) | Protocol `rejected`; dock hidden |
| Unknown / stale agent target | Refused `no-such-pty` |
| Agent switched mid-compose | Staged compose text cleared; immediate keys retarget to the new active agent |
| Keyboard opens/closes (rows change) | No viewport re-report, no resize; phone scrolls its inverted list |
| Malformed chunk (unknown key / empty text / empty list) | Schema/protocol rejection; never a result code |
| `{ text }` carries a control byte (ETX/ESC/CR/LF/NUL) | Schema/protocol rejection; control bytes reach the PTY only via named keys, never free text |
| Rapid arrow taps for menu nav | Each tap = its own event + audit entry; host writes in order; coalesced redraws pull back |
| Hint lost after input | Next hint or screen re-focus triggers a pull (read-side healing) |
| Submit while scrolled up | Snaps to follow-tail so the redraw is visible |
| Empty compose + Send | Send disabled; a lone newline is available via the key-bar `⏎` |

## 10. Testing & acceptance

- **Contract (ai-xavier):** round-trip encode/decode of `PtyInputArgs` (every chunk kind, ordered lists) and the `PtyInputResult` union; schema rejection of malformed chunks (both/neither/empty — against the `.strict()` members); **`{ text }` control-byte rejection** (ETX/ESC/CR/LF/NUL/DEL/C1 reject, ascii/accented/emoji accept — build via `String.fromCharCode`, never literal control bytes in source); `SessionReportResult` round-trips **with and without** `grantedScopes` (a v7-shaped report with the field absent must parse, proving the field is optional — the reconnect-bricking regression).
- **Conformance (ai-xavier, `packages/xbp`):** since control caps ride the **Peer** layer, add **Peer-level** `pty-input` checks — missing `control:pty-write` → `permission-denied`; malformed args (incl. **a handcrafted frame with a control byte in `{ text }`**, proving a downlevel/malicious client can't smuggle ETX past the boundary) → `schema-invalid`; accepted request audited at `risk: 'high'`; and a `Peer.call` **`bad-result`** negative test proving a malformed `PtyInputResult` handler return is rejected (result validation lives in `Peer.call`, not the serving side). XBP-PROTOCOL §12 requires this — the trust-model change lands as a conformance change.
- **Host (ai-14all):** translation-table unit tests (each `PtyInputKey` → exact bytes; text → UTF-8); order preservation of a mixed chunk list; grant enforcement; **`session-report.grantedScopes` reflects the pairing grant set** (granted vs read-only pairing); arm-toggle gate (default-on, disarmed refusal); `no-live-agent` / `no-such-pty` refusals; audit entry shapes (protocol + semantic, literal content, apply vs reject routes).
- **Phone (ai-xavier):** TDD on pure helpers — chunk builder (text submit → `[{text},{key:'enter'}]`); strict key-bar (never reads the buffer); agent-switch-clears-staged reducer; submit-snaps-to-tail state; sent/syncing affordance state machine; `⌃C` confirm gate (tap arms, only Interrupt fires); keyboard-up does not re-report viewport.
- **Joint acceptance (house tradition):** real iPhone + real LAN + real 14all running a live agent — answer a Claude Code permission prompt with `↑`/`↓` + `⏎`; send a free-text follow-up; interrupt a runaway with `⌃C` (through the confirm); feel out echo latency; toggle host disarm and confirm refusal; re-pair to acquire `control:pty-write`.
- `docs/shared/XBP-PROTOCOL.md` (secret, gitignored) gains a **PTY Input** section as part of acceptance, not before.

## 11. Delivery plan

1. **ai-xavier SDD** — contract type + capability (`pty-input`, `control:pty-write` in `NEW_PAIRING_GRANTS`) + the phone input dock, against contract fixtures / a mocked host. Version-bump `@ai-creed/command-contract`.
2. **Publish/vendor the contract bump** for 14all consumption (same flow as Slice 2a / PTY Inspect).
3. **ai-14all SDD** (dev-integration worktree) — `pty-input` handler (translation + write), grant + arm toggle, layered audit. (Coordinate the still-pending resize-on-watch host leg alongside, under its shipped `control:inspect` gating.)
4. **Joint real-device acceptance** + `XBP-PROTOCOL.md` update + memory capture.
5. **V6 security review** consumes this spec as its scope input.

One whisper workflow per repo (`mem-2026-07-02-…-16c76e`); this umbrella is synced into both repos so each workflow reads the same truth.

## 12. Parallelism with V2 (off-LAN)

V1 is a **command-layer** change (one capability + input UX + a host PTY write); V2 is a **transport-layer** change (which network path the sealed channel rides). They meet only at the envelope, which neither alters. The one coordination point is the contract package — V1 adds `pty-input` in `@ai-creed/command-contract`; V2 may widen `PairingOffer.connect` in `@xavier/xbp` — different types in different packages, so the two workstreams proceed in parallel.
