# XBP PTY Input (V1) — ai-14all child: host input handler

**Date:** 2026-07-23 · **Status:** approved design, pre-implementation · **Runs as:** SDD in ai-14all (**dev-integration worktree** — `mem-2026-07-09`)
**Parent umbrella:** `2026-07-23-xbp-pty-input-v1-design.md` (authoritative for decisions & rationale)
**Sibling:** `2026-07-23-xbp-pty-input-xavier-design.md` (contract + phone)

This child scopes the ai-14all host work: enforce the grant, gate on the arm toggle, translate named keys → bytes, write to the real PTY, audit, **and disclose the pairing's granted scopes to the phone via `session-report`**. It consumes the `pty-input` capability and produces the `session-report.grantedScopes` disclosure the phone's dock gate reads (xavier child, contract v8). File paths below are from the acting-path precedent (`mem-2026-07-02`); verify against the dev-integration worktree, not master.

---

## 1. Grant & pairing
- Add `control:pty-write` to the host pairing grant set (wherever `control:inspect` is added today). Existing pairings must re-pair to acquire it — fail closed.
- Enforce at capability dispatch exactly like `control:act`: a `pty-input` request from a pairing lacking `control:pty-write` is a **protocol rejection** in the Peer (`packages/xbp/src/peer/peer.ts`), never reaching the executor. It gets a protocol audit entry and no semantic entry.

### 1.1 Disclose granted scopes to the phone (`session-report`)
The phone gates its input dock on whether **its** pairing holds `control:pty-write`, and its only authoritative source is the `grantedScopes` field the xavier child adds to `SessionReportResult` (xavier child §1.3). **This host owns producing it** — without it the phone never learns it holds the grant and the dock stays hidden forever (the gap this closes).
- In the `session-report` handler, populate `grantedScopes` from **this pairing's live grant set** — the same set `control:pty-write` is added to above. Report exactly the granted scopes, **never a superset**: the phone treats this as authoritative and shows the dock on the strength of it.
- A pairing granted `control:pty-write` reports a `grantedScopes` containing it (dock eligible); a read-only pairing reports one that omits it (dock stays hidden). This is the fail-closed dock-gate signal (xavier child §3.3).
- The field is **optional on the wire** only so a not-yet-upgraded host can omit it and leave the phone fail-closed (xavier child §1.3); this V1 host, once shipped, **always** includes `grantedScopes` on every `session-report` response.
- No new capability and no new round trip — `session-report` is already fetched every connect (sealed + signed, `control:read`), so the disclosure is authenticated and cannot be spoofed across the boundary.

## 2. Arm toggle
- Add `isPtyInputEnabled`, **default `true`** (mirrors `isActingEnabled` but default-on — the grant is the deliberate opt-in; the toggle is a live disarm switch).
- Surface a disarm control in the host UI (next to the acting-enabled control).
- When `false`, the executor returns `{ ok: false, code: 'pty-input-disabled' }` — an executor-level refusal (single semantic reject entry), not a protocol rejection.

## 3. `pty-input` executor
Model on `xbp-acting-executor.ts`. Contract: **always** return a schema-valid `PtyInputResult`; **never throw** for an expected refusal (an unexpected throw becomes the Peer's fail-closed `rejected`).

1. Gate: `isPtyInputEnabled` → else `pty-input-disabled`.
2. Resolve `{ worktreeId, agentId }` → the live PTY handle the host already holds (the handle it spawned the agent through; the same registry `set-watch-viewport` / `pty-rows` resolve against). Unknown → `no-such-pty`; resolved but not live → `no-live-agent`.
3. Translate `chunks` → bytes (table below) and `write()` them to the PTY **in order, as one contiguous write**.
4. Return `{ ok: true, appliedAt }`.

### Translation table (normative)
| Chunk | Bytes |
|---|---|
| `{ text }` | UTF-8 of the string |
| `{ key: 'enter' }` | `\r` (`0x0D`) |
| `{ key: 'up' }` | `\x1b[A` |
| `{ key: 'down' }` | `\x1b[B` |
| `{ key: 'esc' }` | `\x1b` (`0x1B`) |
| `{ key: 'ctrl-c' }` | `\x03` |

**`{ text }` is control-free by contract.** The contract's `PtyText` schema (xavier child §1.2) rejects C0/DEL/C1 code points, and the Peer validates args at dispatch **before** the executor runs, so the UTF-8 encoding of a `{ text }` chunk can never emit `\x03` (ETX), `\x1b` (ESC), `\r` (CR), or NUL. Named keys are therefore the **only** way a control byte reaches the PTY — the executor must not add any control-byte synthesis of its own, and must not attempt to "sanitize" or re-encode text (it is already safe). This keeps `⌃C` reachable only through the confirmed `{ key: 'ctrl-c' }` path.

No new PTY is ever created; input only reaches already-live, host-spawned PTYs. There is no echo response — the agent's redraw flows back through the existing `pty-changed` → `pty-rows` loop.

### 3.1 Hardening — apply the acting-path lessons (`mem-2026-07-07`, **critical**)
The acting executor shipped two defects that this executor must design out, because injecting into a possibly-dead PTY is the exact same shape:
- **State-aware liveness (Bug-1 analogue).** Do **not** gate liveness only on "handle missing / process object present." A PTY whose agent has **exited / is in a terminal state** must map to `no-live-agent` *before* any `write()` — never forward bytes to a dead PTY and surface the resulting throw as `internal`. Resolve → check the agent is genuinely writable-live → only then translate+write.
- **Sanitize `internal` (Bug-2 analogue).** The `message?` field on **any** refusal — especially `internal` — must be a bounded, **path-free** string. Never place `err.message`, `stderr`, stack traces, or host filesystem paths into a `PtyInputResult` that crosses the protocol boundary (blind-transport / minimal-disclosure posture). Log the raw detail host-side only.

## 4. Layered audit (mirror the acting path)
Per `mem-2026-07-02` (verified against `xbp-acting-executor.ts` + `services/diagnostics/acting-audit-logger.ts`):
- **Protocol layer:** automatic in `Peer.dispatchRequest` — one `XbpAuditSink` entry per dispatched `pty-input` request `{ ts, cap: 'pty-input', risk: 'high', outcome, reason? }`.
- **Semantic layer:** a new logger sibling to `ActingAuditLogger`.
  - **Executed** input (passed the toggle + resolved live): **one** entry with the **full literal** `chunks` and `route: 'apply'`. Input is atomic — *no* start+result pair (unlike lifecycle ops).
  - **Executor-level refusal** (`pty-input-disabled` / `no-live-agent` / `no-such-pty`): **single** entry, `route: 'reject'`, with the code (via the `refuse()` helper pattern).
  - **Pre-dispatch protocol rejection** (missing `control:pty-write`, tamper / forge / replay): protocol entry only, **no** semantic entry.
- Full-literal content is the deliberate decision (umbrella §8): forensic completeness for the hottest write surface; accepted secret-persistence tradeoff.

## 5. Resize-on-watch host leg (coordination, not new contract)
Already shipped in ai-xavier (contract + phone). If the host SIGWINCH/restore is still pending, finish it here alongside `pty-input`, under its **shipped `control:inspect`** gating (unchanged): on `set-watch-viewport`, resize the real PTY to the reported viewport (phone wins); restore desktop geometry on unwatch/detach. This is independent of `pty-input` and shares no gate with it.

## 6. Host tests
- Translation: each `PtyInputKey` → exact bytes; text → UTF-8; mixed ordered list preserves order in one write.
- Grant enforcement: missing `control:pty-write` → protocol reject, no semantic entry.
- **Grant disclosure:** `session-report.grantedScopes` reflects the pairing grant set — a pairing granted `control:pty-write` includes it; a read-only pairing omits it. This is the signal the phone's dock gate consumes (xavier child §3.4). Assert the field is present and content-exact for both pairing kinds.
- Arm toggle: default on; disarmed → `pty-input-disabled` single reject entry.
- Resolver refusals: `no-live-agent`, `no-such-pty`.
- **Exited/terminal-state agent → `no-live-agent`** (not `internal`) with **no** `write()` attempted (`mem-2026-07-07` Bug 1). Write the failing test first.
- **Sanitized `internal`**: an induced internal failure returns a bounded, path-free `message` — assert no host filesystem paths, no `stderr`, no stack frames cross the boundary (`mem-2026-07-07` Bug 2). Write the failing test first.
- Executor never throws for expected refusals; unexpected throw → Peer `rejected`.
- **Control byte in `{ text }` never reaches `write()`:** a handcrafted `pty-input` frame with a control byte (ETX/ESC/CR/NUL) in a `{ text }` chunk is schema-rejected at Peer dispatch (`schema-invalid`), so the executor is never invoked and no bytes are written. Build the byte via `String.fromCharCode` — never a literal control byte in the test source. Proves the named-key boundary holds even against a client that skips its own validation.
- Audit shapes: protocol entry present for all; semantic apply entry carries literal `chunks`; reject entries single, no pair.

## 7. SDD delivery order
1. Grant set + `control:pty-write` enforcement in the Peer path.
2. **`session-report.grantedScopes` population from the pairing grant set (§1.1) + its disclosure test** — the phone's dock-gate signal; land it with the grant set so the phone half is never stranded.
3. `isPtyInputEnabled` toggle + host UI control.
4. `pty-input` executor (resolve + translate + write + result union).
5. Semantic audit logger + wiring; verify protocol entries.
6. (Coordinate) finish resize-on-watch host leg if pending.
7. Joint real-device acceptance with the phone (umbrella §10) → `XBP-PROTOCOL.md` PTY Input section → memory capture.
