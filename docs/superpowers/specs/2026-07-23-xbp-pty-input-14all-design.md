# XBP PTY Input (V1) — ai-14all child: host input handler

**Date:** 2026-07-23 · **Status:** approved design, pre-implementation · **Runs as:** SDD in ai-14all (**dev-integration worktree** — `mem-2026-07-09`)
**Parent umbrella:** `2026-07-23-xbp-pty-input-v1-design.md` (authoritative for decisions & rationale)
**Sibling:** `2026-07-23-xbp-pty-input-xavier-design.md` (contract + phone)

This child scopes the ai-14all host work: enforce the grant, gate on the arm toggle, translate named keys → bytes, write to the real PTY, and audit. It consumes the `pty-input` capability published by the xavier child (contract v8). File paths below are from the acting-path precedent (`mem-2026-07-02`); verify against the dev-integration worktree, not master.

---

## 1. Grant & pairing
- Add `control:pty-write` to the host pairing grant set (wherever `control:inspect` is added today). Existing pairings must re-pair to acquire it — fail closed.
- Enforce at capability dispatch exactly like `control:act`: a `pty-input` request from a pairing lacking `control:pty-write` is a **protocol rejection** in the Peer (`packages/xbp/src/peer/peer.ts`), never reaching the executor. It gets a protocol audit entry and no semantic entry.

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
- Arm toggle: default on; disarmed → `pty-input-disabled` single reject entry.
- Resolver refusals: `no-live-agent`, `no-such-pty`.
- **Exited/terminal-state agent → `no-live-agent`** (not `internal`) with **no** `write()` attempted (`mem-2026-07-07` Bug 1). Write the failing test first.
- **Sanitized `internal`**: an induced internal failure returns a bounded, path-free `message` — assert no host filesystem paths, no `stderr`, no stack frames cross the boundary (`mem-2026-07-07` Bug 2). Write the failing test first.
- Executor never throws for expected refusals; unexpected throw → Peer `rejected`.
- Audit shapes: protocol entry present for all; semantic apply entry carries literal `chunks`; reject entries single, no pair.

## 7. SDD delivery order
1. Grant set + `control:pty-write` enforcement in the Peer path.
2. `isPtyInputEnabled` toggle + host UI control.
3. `pty-input` executor (resolve + translate + write + result union).
4. Semantic audit logger + wiring; verify protocol entries.
5. (Coordinate) finish resize-on-watch host leg if pending.
6. Joint real-device acceptance with the phone (umbrella §10) → `XBP-PROTOCOL.md` PTY Input section → memory capture.
