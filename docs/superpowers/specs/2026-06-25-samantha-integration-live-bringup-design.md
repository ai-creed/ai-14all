# Samantha Integration — Live Two-Process Bring-Up (Cross-Repo) Design

**Date:** 2026-06-25
**Status:** Approved design (brainstormed 2026-06-25), ready for implementation planning.
**Scope:** Make the *real* ai-14all and ai-samantha processes talk full-duplex — observe, benign act, and real act (`instruct-session`) — over the live `127.0.0.1:7841` connector wire, with a hardened-enough acting token, a dual-channel confirmation UX, contract drift-prevention, and a durable automated two-process harness. This is the cross-repo counterpart that S4 deliberately deferred (high-level plan §8, "S4 amendment"), plus the Samantha-side S2/S3 counterparts.
**Repos:** **ai-14all** (keystone) + **ai-samantha** (proprietary). Both are touched; the bulk of *new* code is Samantha-side.

---

## 1. Context & goal

The ai-14all side of the integration is built and hardened through S4 (observe S1, benign command channel S2a, real-act S3 with token + ActGuard + audit, harden S4) — all on `master`, all validated **hermetically** against a *mock* Samantha server. The Samantha side independently shipped S1 (observe server) and S2b (voice→tool-call bridge), merged to her `master`. The two halves were built to the **same mirrored contract** (her `connector-commands.ts` is a documented mirror of ai-14all's `command-types.ts`).

What has **never** run is the real two-process duplex: ai-14all and a real Samantha, talking over the live wire, with acting authorized end-to-end. This design closes that gap and makes it durable.

**Definition of done:**
- The 3 baseline Samantha-side fixes land (token, error-code reconciliation, secret persistence).
- The real two processes round-trip **observe → benign act → real act** by hand (the manual smoke).
- The automated two-process **harness gate** is green and exercises the full wire deterministically.
- The acting token is hardened to the agreed level (Model B, below).
- Risky acts are gated by a **dual-channel confirmation** (voice + card), whose gate behavior (either-resolves, cancel/timeout safe-deny) is locked by **committed automated tests**, not manual checking alone.
- The contract **cannot silently desync** again (three drift guards).

This precedes S5 (Triage) and does not change it.

---

## 2. Current state (grounded) — what exists vs. the gaps

**ai-14all (`/Users/vuphan/Dev/ai-14all`, on `master`):**
- `services/plugins/samantha/command-types.ts` — `CommandFrameSchema` accepts an **optional `token`** (line 13); **9** `COMMAND_ERROR_CODES` (lines 18–28): `unknown-capability, unknown-worktree, ambiguous-worktree, invalid-args, no-live-agent, session-busy, acting-disabled, unauthorized, internal`.
- `services/plugins/samantha/samantha-driver.ts` — `CAPABILITIES` (lines 81–128) advertises `focus-worktree`, `session-report`, and `instruct-session` (`requiresConfirmation: true`, `risk: "drives-agent"`); idempotent dedup; reconnect backoff.
- S3 acting chain — `ActingTokenVerifier` (reads the shared secret from `SAMANTHA_ACTING_TOKEN_PATH`, default `~/.ai-samantha/connector-token`; constant-time; default-deny), `ActGuard` (token-first gate, audit start+result), `ActingAuditLogger` (`<userData>/logs/acting-audit.jsonl`). Master opt-in `acting_enabled` (default **off**) in `~/.ai-14all/config.toml` `[plugins.samantha.behavior]`.

**ai-samantha (`/Users/vuphan/Dev/ai-samantha`, on `master`):**
- Connector server on `127.0.0.1:7841` (`electron/main/connector-server.ts`; `electron/main/index.ts:25–28,177`): `POST /connectors/register`, `PATCH /connectors/:id/snapshot`, `POST /connectors/:id/events`, WS upgrade on `/connectors/:id/events`, plus `POST /connectors/:id/commands/:capabilityId`.
- `electron/main/connector-registry.ts` — `executeCommand` (lines 123–143) **already** returns `Promise<CommandResult>`, mints a `requestId`, sends the extended frame `{type, capabilityId, requestId, args}`, and correlates the reply with a 5s timeout; `handleCommandResult` (145–153); `listCommandableCapabilities` (155–164, gated on a bound socket); `unbindCommandSocket` rejects pending on close.
- `electron/main/connector-commands.ts` — mirror of ai-14all's types, but **only 5** `COMMAND_ERROR_CODES` (lines 13–19): `unknown-capability, unknown-worktree, ambiguous-worktree, invalid-args, internal`. `CommandFrame` (lines 6–11) has **no `token` field**. `parseCommandResult` (39–61) returns **`null`** for an unrecognized error code.
- S2b voice→tool bridge merged (`connector-tools.ts`, the merged tool registry, `assistant-service.ts` tool loop) — connector capabilities become LLM tools on a **user-voiced** turn.
- `ConnectionsPanel.tsx:495` — the existing UI fire-and-forget command path.

**The three live-blocking gaps:**
1. **Token.** ai-14all requires a valid `token` on acting frames (default-deny when `acting_enabled`). Samantha sends **no** token and **never writes** `~/.ai-samantha/connector-token`. → `instruct-session` denies as `unauthorized`.
2. **Error codes.** ai-14all can return 4 codes Samantha's parser rejects (`no-live-agent, session-busy, acting-disabled, unauthorized`) → `parseCommandResult` returns `null` → the result frame is dropped → her pending command **times out at 5s** with no reason. Acting failures become opaque timeouts.
3. **Confirmation metadata.** Samantha's `SourceCapability` (`src/core/connectors.ts`) is `{id, title, description?, inputSchema?}` — it carries **no `requiresConfirmation`/`risk`**. ai-14all already advertises both on `instruct-session` (S3), but they are dropped at Samantha's register parse, so her confirmation gate has no flag to read. This is exactly the "per-cap risk/sideEffect descriptor" forward-hook that S2b deferred to S3.

---

## 3. Design decisions

### 3.1 Acting-token model — **B: Samantha-owned file secret**

The token lets ai-14all (the verifier) be sure an acting command came from the legitimate Samantha, not another local process holding `:7841`. A secret exchanged **over** the `:7841` channel cannot authenticate the `:7841` peer (circular); only an **out-of-band** secret can. Hence a file, not a register-issued token.

- **Samantha** generates a random secret on startup, writes it to `~/.ai-samantha/connector-token` (`chmod 600`), and holds it in memory. Regenerating on each startup is the rotation story.
- **Samantha** adds a `token` field to her outbound `CommandFrame` and stamps the secret into it. Stamp it on **all** command frames (simplest; benign caps ignore it, acting caps require it).
- **ai-14all** reads the same path (its existing S3 default) and verifies via `ActGuard` — **no ai-14all change to the token source** (keeps the frozen S3 path intact).
- **Rotation handling:** because the secret regenerates per Samantha startup, ai-14all must read the file **fresh** (at verification time, or re-read on (re)register) so a Samantha restart with a new secret does not wedge acting. ai-14all must also tolerate the file being **absent at its own startup and appearing later** (Samantha may boot after ai-14all).

**Trust scope (honest):** this defends against a `:7841` squatter that cannot read the user's home dir; it does **not** defend against same-uid malware (which can read any local secret). It is one layer alongside `acting_enabled` (opt-in/kill switch), audit, dedup, and confirmation.

**Deferred (out of scope):** OS-keychain storage or a unix-domain socket with peer-uid checks. **Revisit trigger:** the smart-remote-control mobile app — once the channel leaves loopback, the threat model changes and this hardening becomes warranted.

### 3.2 Confirmation UX — dual-channel, **Samantha-enforced**

**Who enforces:** the human-confirmation gate is **Samantha's** — she is the only layer that touches the human. ai-14all is a headless main-process driver; it cannot render UI or hear a voice, so it cannot verify a human confirmed (requiring a `confirmed:true` field would be theater — Samantha generates it). ai-14all therefore **declares** the requirement (`requiresConfirmation`/`risk` in its advertised capabilities) and enforces the orthogonal **machine** gates (token, `acting_enabled`, dedup, audit). A two-phase ai-14all-side confirm protocol is **rejected**: it adds no human guarantee, reopens the frozen S3 path, and creates a new cross-repo drift surface.

**The UX:** when a capability advertised with `requiresConfirmation` is invoked on a user-voiced turn, Samantha presents **both** confirmation channels simultaneously, bound to a **single** pending confirmation:
- **Voice** — speaks a readback: capability + target + a short instruction summary ("Drive auth-worktree's agent → 'run the tests' — confirm?").
- **Card** — a visual confirm card with the action, target, and **full** args, plus Approve/Cancel.

Rules:
- **Either channel resolves it**, first-to-resolve wins (idempotent; the other dismisses). Lets you say "yes" hands-free or click in a meeting.
- **Approve** → send the command frame. **Cancel or timeout → safe-deny** (never send). A pending confirmation **auto-cancels** after a bounded window so a forgotten prompt cannot hang.
- The flag is read from the **advertised capability list** (data-driven), not hardcoded to `instruct-session`. Benign caps (`focus-worktree`, `session-report`) skip confirmation and fire immediately.

**Prerequisite (Samantha-side).** The flag only reaches the gate once Samantha's `SourceCapability` (`src/core/connectors.ts`) is widened to carry `requiresConfirmation?`/`risk?` and her register parse + capability→tool bridge preserve them. This is the S2b forward-hook, realized here; ai-14all already advertises both, so no ai-14all change.

**S3 lineage.** The **voice read-back + approval verb** is the gate S3 already locked (Samantha-side, Layer 1 — an approval verb is short and acoustically distinct, hard to mishear); the **card** is the new second channel added here for hands-busy / meeting contexts. The split — ai-14all *declares* `requiresConfirmation`/`risk` (owns the policy), Samantha *enforces* in the human layer — is the S3 two-layer gate, unchanged.

**Result semantics.** Per S3, an `instruct-session` `okResult` is a **delivery ACK** (`{ routed: … }`), not the agent's eventual output — so the readback/reflection should say *"sent / delivered,"* not *"the agent finished."* Acting still rides the **frozen S3 router**: managed sessions route through the sanctioned `WhisperCommand` surface, unmanaged shells through `sendInput` at a safe input point only, and an unsafe target is **rejected, never queued**.

**Relationship to the north star:** this is the **attended** default. The future unattended overnight path bypasses it via an explicit "armed window" — deferred to the autonomy work, not in conflict here.

**Coverage (committed, not manual-only).** The dual-channel confirmation is new user-visible behavior, so per AGENTS.md ("new user-visible behavior for a phase is not done until the e2e suite covers it") it ships with committed automated coverage in the **ai-samantha** repo at the confirmation-gate layer — not manual Phase-4 checking alone. The deterministic two-process gate (§3.4) auto-approves to keep the *wire* path deterministic; this separate Samantha-side suite covers the *UX gate contract* directly: voice-approve resolves, card-approve resolves, first-to-resolve-wins (the losing channel dismisses, idempotent), cancel → safe-deny (no frame sent), and bounded-timeout → safe-deny (no frame sent). The TTS/render edges stay in the manual smoke; the gate state machine is deterministic and committed.

### 3.3 Contract drift-prevention — **all three guards**

ai-14all **owns the capability vocabulary and the command/result contract** (frame shape, error codes, capability metadata), so it is the canonical source; Samantha mirrors. Three layered guards:

1. **Forward-compatible parser (Samantha).** `parseCommandResult` must **never** return `null` for an otherwise well-formed `commandResult` whose only problem is an unrecognized error `code`. Instead, surface it as a generic error — preserve the raw code string in the message (e.g. `error: { code: "internal", message: "<original-code>: <message>" }`, or a dedicated `unknown` sentinel) — so a *new* ai-14all code can never again vanish into a timeout. This is the direct antidote to the bug found above and is **mandatory**.
2. **Runtime `contractVersion` handshake.** ai-14all advertises a `contractVersion` (an integer) in its `POST /connectors/register` payload (additive). Samantha checks compatibility on register; on mismatch she raises a **loud** signal (UI + log: "ai-14all speaks contract vN, I support vM — acting disabled for this connector") and **disables acting** for that connector while still accepting observe traffic. Converts silent drift into an immediate, visible failure at connect time.
3. **Build-time pin tests (both repos).** Each repo has a test pinning its frame shape + error-code set to the canonical list (committed copy). When ai-14all's contract changes, the pin test makes the Samantha-side update non-optional at review.

As part of (1)/(3), reconcile the immediate `5 → 9` error-code gap now (add `no-live-agent, session-busy, acting-disabled, unauthorized` to Samantha) so the codes also render with their proper names, not just survive.

### 3.4 The harness — **hybrid**

What must not bit-rot is the **cross-repo wire**; the LLM *deciding* to call a tool is Samantha's already-tested S2b behavior, not the integration's concern. Two layers:

**Gate (automated, deterministic, CI-able).** Two **real** node processes — Samantha's connector server (real `connector-registry` / command / result / tool-bridge, no Electron or TTS) and ai-14all's Samantha driver (real dispatcher / `ActGuard` / token verifier / version check) — talking over **real loopback HTTP+WS**. The **LLM is stubbed** to deterministically emit the tool-call; confirmation **auto-approves** in this wire gate (the confirmation *UX gate contract* itself — either-channel-resolves, cancel/timeout safe-deny — carries its own committed Samantha-side coverage, §3.2); ai-14all's effects are observable. Assertions:
- register **+ `contractVersion` handshake** accepted;
- observe: snapshot + event with the mapped signal;
- benign round-trip: `focus-worktree` / `session-report` → `okResult`;
- real act: `instruct-session` with a valid token → `ActGuard` authorizes → audit line written → effect observed;
- error forward-compat: ai-14all returns an acting error code (e.g. `acting-disabled` with `acting_enabled` **off**, `unauthorized` with an **invalid/missing token**, or `no-live-agent`) → Samantha **surfaces it**, not a timeout;
- **reconnect after a real process restart** (exercises S4).

**Smoke (manual, occasional, not gating).** The real thing — both Electron apps + real LLM (+ optional voice) — run by hand via the bring-up procedure (§4). Proves the real model + shipped artifacts.

**Why not real-Electron/real-LLM as the gate:** the real model is nondeterministic, needs an API key, burns tokens, and real-Electron launches already showed resource-exhaustion flake in the S4 suite. Good as a manual smoke; unfit as a pre-merge gate.

**Harness location (implementation note, trickiest cross-repo bit):** the gate needs both codebases' built code. Plan it to live in the **ai-14all** repo and spawn the real Samantha connector server as a child node process from her repo build (a thin node entry that boots her `startConnectorServer` without Electron), against the real ai-14all driver. The plan stage must resolve the exact spawn/build seam.

---

## 4. The bring-up procedure (manual smoke + acceptance)

- **Phase 0 — Harness.** Start Samantha (`npm run dev`; connector server `:7841`; skip TTS, drive her with **typed** input for determinism). Enable ai-14all `[plugins.samantha] enabled = true` (and `acting_enabled = true` for Phase 3); launch ai-14all → it auto-registers and opens the command WS. *Accept:* `GET :7841/connectors` lists `ai-14all` + its capabilities; ai-14all's plugins panel shows "connected".
- **Phase 1 — Observe.** Trigger a real ai-14all session-state change → assert Samantha receives register + snapshot + a `POST /events` with the mapped signal.
- **Phase 2 — Benign act (the dogfood).** Type "focus the auth worktree" / "status report" → her LLM fires the connector tool → ai-14all acts → `okResult` round-trips → she reflects.
- **Phase 3 — Real act.** With `acting_enabled` + the token present and a live agent, "tell session X …" → confirmation (voice or card) → `instruct-session` → `ActGuard` authorizes → input delivered → result round-trips and is reflected (not a timeout).
- **Phase 4 — Drift sweep + harden.** Verify capability `description`/`inputSchema` transit register into the tool's parameter schema; confirm the dual-channel confirmation behaves (either resolves, timeout safe-denies) — exercised by hand here, but **also locked by the committed Samantha-side confirmation coverage** (§3.2), not manual-only; test reconnect across a real Samantha restart; capture the whole flow in the automated gate.

---

## 5. Cross-repo work breakdown

| Area | ai-samantha | ai-14all | Harness |
| --- | --- | --- | --- |
| Token | add `token` to `CommandFrame` + stamp it; generate/persist `~/.ai-samantha/connector-token` (0600) on startup; in-memory rotation | read token **fresh** at verify time; tolerate late-appearing/rotated file | assert authorized + audited |
| Error codes | add the 4 missing codes; **forward-compat** `parseCommandResult` (never drop) | (canonical owner — no change) | assert a real error surfaces, not a timeout |
| Drift | check `contractVersion` on register → loud mismatch + disable acting; pin test | advertise `contractVersion` in register payload (additive); pin test | assert handshake accepted |
| Confirmation | **widen `SourceCapability` to carry `requiresConfirmation`/`risk`** + preserve on register; dual-channel (readback + card), single pending state, either-resolves, safe-deny on cancel/timeout; **committed e2e coverage of the gate** (either-channel-resolves, first-to-resolve-wins, cancel/timeout safe-deny) | (declares the flag — already done) | auto-approve wire path (UX gate has its own Samantha-side coverage) |
| Observe/benign | (already built) | (already built) | assert round-trips |
| Harness | thin headless boot entry for `startConnectorServer` | host the gate; spawn Samantha server child process | the gate itself |

**S3 freeze:** ai-14all's acting chain (token verifier, ActGuard, router, audit) stays untouched except for the additive `contractVersion` in the register payload and robust file re-read. No behavior change to the frozen path.

---

## 6. Security posture

Loopback-only, single-user. Layers: the **out-of-band token** (Model B) authenticates the supervisor vs. a `:7841` squatter; `acting_enabled` is the master opt-in / kill switch; the **dual-channel confirmation** is the human gate on risky acts; the **audit log** is the record; **dedup** stops single-frame replay; **default-deny** throughout. Known residual: same-uid malware can read a local secret — accepted at this stage, mitigated by the deferred keychain/socket hardening when the mobile/remote channel arrives.

---

## 7. Reconciliation with the roadmap

This is the cross-repo, two-process counterpart that the S4 spec deferred (high-level plan §8 "S4 amendment"), combined with the Samantha-side S2/S3 counterparts (token, command-result codes) and a new durable harness. Concretely, it realizes the Samantha-side items S3 explicitly parked for the plan — *honor `requiresConfirmation` (voice gate), token issuance/wire, send instruction args, speak typed results/refusals* — plus the per-cap `requiresConfirmation`/`risk` descriptor S2b forward-flagged. ai-14all's frozen S3 chain stays untouched but for the additive `contractVersion` in the register payload. It is the true completion of the **first dogfood milestone** (S1+S2 proven, voice-driven, two real processes), and it **precedes and does not alter S5 (Triage)**, which remains gated on real S1–S3 usage data.

---

## 8. Deferred / open questions

- **Hardened token (keychain / unix-socket peer-uid)** → revisit at the smart-remote-control mobile app (off-loopback threat model).
- **Unattended "armed window"** bypass of confirmation → the north-star autonomy work.
- **Through-LLM / real-Electron realism** → covered by the manual smoke only; not in the gate.
- **Voice/TTS in the smoke** → optional; typed input is acceptable for the bring-up.
- **`inputSchema` → tool-parameter fidelity** → verify in Phase 4; fix Samantha-side if a gap surfaces.
- **`contractVersion` value/format** and whether ai-14all also advertises its full code list → settle at plan stage (an integer version is the floor).

---

## 9. References

**ai-14all:** `services/plugins/samantha/command-types.ts` (9 codes, optional `token`); `services/plugins/samantha/samantha-driver.ts` (`CAPABILITIES` 81–128); the S3 acting chain (`act-guard.ts`, token verifier, `ActingAuditLogger`); `plugin-config` `acting_enabled`.
**ai-samantha:** `electron/main/connector-commands.ts` (5 codes, no `token`, `parseCommandResult`); `electron/main/connector-registry.ts` (`executeCommand` 123–143, `handleCommandResult` 145–153, `listCommandableCapabilities` 155–164); `electron/main/connector-server.ts` (routes + WS); `connector-tools.ts` + `assistant-service.ts` (S2b tool loop); `ConnectionsPanel.tsx:495`; `electron/main/index.ts:25–28,177` (port + bootstrap); `package.json` (`npm run dev`).
