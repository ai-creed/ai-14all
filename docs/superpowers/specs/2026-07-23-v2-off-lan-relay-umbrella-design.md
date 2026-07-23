# XBP Off-LAN Connection (V2) — Umbrella Design (ai-xavier + ai-14all)

**Date:** 2026-07-23 · **Status:** approved design, pre-implementation
**Owner:** Vu Phan · **Scope:** cross-repo — protocol contract, blind relay server, phone connection failover, host address advertisement + relay registration
**Roadmap:** v1.0 workstream V2 (off-LAN connection), revised per §2.
**Children:**
- `2026-07-23-v2-off-lan-relay-xavier-design.md` — contract + relay server + phone (runs as SDD in ai-xavier)
- `2026-07-23-v2-off-lan-relay-14all-design.md` — host advertisement + relay registration (runs as SDD in ai-14all, worktree `xavier-connection-remote-host`)

---

## 1. Goal

From anywhere — cellular, hotel WiFi, another LAN — the phone reaches its paired desktop host with the same sealed XBP session it uses at home. This is a reachability change only: the envelope, pairing ceremony, capabilities, and permission model are untouched.

Two pieces deliver it:

1. **Candidate-URL foundation.** The pairing offer carries an *ordered list* of connect URLs instead of a single one, and the phone tries them in order with failover. LAN stays first: fastest at home, works with zero infrastructure, unaffected by anything relay-related.
2. **Self-hosted blind relay.** A small rendezvous server on the operator's own VPS gives the host a publicly reachable URL. The host dials *out* and registers; the phone dials *in* with the host's id; the relay splices the two sockets and from then on forwards sealed bytes it cannot read.

## 2. Decision — relay now; Tailscale dropped as a requirement

The 2026-07-22 roadmap defined V2 as a Tailscale "from anywhere" mesh, with the public blind relay deferred to Phase 5. Ratified 2026-07-23 in brainstorm, this spec revises that decision: **V2 builds the blind relay now and drops Tailscale as a requirement.**

Rationale:

- The end-state product serves public users, who cannot reasonably be asked to install Tailscale. The owner will not run Tailscale on their own phone either — a Tailscale-first V2 would ship capability with zero actual users.
- The expensive part of V2 is the shared foundation (contract widening, phone failover, address-aware reconnect), which is identical for every reach mechanism. The relay is the only mechanism anyone will actually use.
- The host's reverse-connection machinery is required for the public product eventually regardless; building it now is not throwaway work.
- The candidate-URL contract keeps bring-your-own-mesh as a freebie: any reachable URL (a Tailscale `100.x` address included) can ride the list later with zero further phone or contract work.

What stays in Phase 5: relay *productization* — operator accounts, hosted multi-operator service, tiering, offline queueing. The v1 relay is single-operator and self-hosted, but multi-tenant by construction (state is keyed by hostId).

## 3. Non-goals & guardrails

- No change to the sealed + signed + anti-replay envelope, the SAS pairing ceremony, capabilities, grants, or permissions. The relay never sees plaintext.
- No relay-side accounts or persistence. In-memory state only; a relay restart is an availability blip, not data loss.
- No parallel / racing connection attempts ("happy eyeballs") and no remember-last-good reordering. Sequential candidate order is the v1 behavior; the away-from-home cost is one LAN connect timeout before the relay dial.
- No "connected via relay" UI treatment on the phone. Deferred polish; V5 may pick it up.
- No automatic upgrade of an existing pairing to relay reachability. Re-pair (an already-supported flow) is the upgrade path; the stored record's *shape* migrates so the app update does not orphan the pairing (§7).
- Relay availability is best-effort: relay down while the phone is away means no connection; the LAN path is unaffected. Accepted for v1.

## 4. Prior decisions honored

- **ai-xavier owns the protocol** (mem-2026-06-27): the offer shape and the relay control protocol are defined in `@xavier/xbp`, and the relay server lives in this repo as protocol infrastructure.
- **Envelope/E2E posture** (Phase 0a): unchanged. Transport pluggability behind `connectWebSocketClient(url)` / `connectRnWebSocket(url)` is exactly the seam this feature exercises.
- **Push is hint, pull is authoritative** (Arc B): untouched. V3's push-wake reconnect inherits candidate failover for free at the `driveWake` → `performReconnect` seam — the V2/V3 coordination point named in the roadmap. A relay URL also removes any VPN-must-be-up concern from background wake.
- **One whisper workflow per repo** (mem-2026-07-02): the child specs run as parallel SDDs; the contract bump publishes before the ai-14all workflow consumes it.

## 5. Architecture overview

```
ai-14all host                        relay (apps/relay, on VPS)               phone (ai-xavier)
┌───────────────────────┐            ┌───────────────────────────┐            ┌──────────────────────┐
│ LAN listener (as-is) ◀┼━━ LAN ws ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┼━ candidate #1 (home) │
│                       │            │                           │            │                      │
│ relay registration    │─── wss ───▶│ /host — challenge-        │            │                      │
│ client (persistent)   │            │ response auth, hostId map │            │                      │
│                       │            │                           │            │                      │
│ on incoming-session:  │─── wss ───▶│ /accept/<token> ──┐       │            │                      │
│ dial accept URL       │            │                   ├ splice◀─── wss ────┼─ candidate #2 (away) │
│                       │            │ /connect/<hostId>─┘       │            │  /connect/<hostId>   │
└───────────────────────┘            └───────────────────────────┘            └──────────────────────┘
                        after splice: blind byte pipe — sealed frames only
```

Rendezvous flow:

1. Host dials `wss://relay/host`, authenticates via challenge-response with its existing identity sign key, stays registered on a persistent control channel.
2. Phone (away from home) fails the LAN candidate, dials `wss://relay/connect/<hostId>`.
3. Relay mints a one-time session token, sends `incoming-session` to the host over the control channel, and holds the phone socket.
4. Host dials `wss://relay/accept/<token>`; relay validates the token and splices the two sockets into a blind byte pipe.
5. The normal XBP session (sealed hello onward) runs over the pipe exactly as it would over a LAN socket.

## 6. Contract changes (`@xavier/xbp`) — breaking bump

1. **Offer shape.** `PairingOffer.connect` becomes `{ urls: [string, ...string[]] }` (zod non-empty array), ordered by preference: LAN first, relay second. `parsePairingOffer` rejects the legacy single-`url` shape — clean break, no dual parsing.
2. **`ReferenceHost.createPairingOffer(connect)`** widens to the same shape (default `{ urls: ["memory://local"] }` so no-arg conformance/test callers keep working).
3. **`protocol/relay.ts` (new):** zod schemas for the host↔relay control channel. These are JSON text frames and carry no secrets; the sealed session never rides the control channel.
   - `{ t: "register", signPubHex }` (host → relay)
   - `{ t: "challenge", nonceHex }` (relay → host)
   - `{ t: "challenge-response", sigHex }` (host → relay) — detached signature over the nonce bytes with the host's identity sign key
   - `{ t: "registered", hostId }` (relay → host)
   - `{ t: "incoming-session", token }` (relay → host)

   There is no error frame anywhere in the protocol: every failure — bad signature, malformed or out-of-order message, unknown host — is answered by closing the socket with a code (§6.5) and nothing else, upholding §10's no-probeable-error-bodies rule on the control channel too.
4. **hostId** = hex of `backend.hash(signPubBytes, 32)` (BLAKE2b-256 via the existing crypto backend), exported as a `deriveHostId` helper. Deterministic, no relay-side account state; the relay computes it from the pubkey presented at registration, so an id cannot be claimed without holding the matching key.
5. **WebSocket close codes** (normative; the only failure signal the relay emits): `4400` protocol-violation (malformed or out-of-order control message), `4401` registration-auth-failed, `4404` host-not-registered, `4408` accept-timeout. The phone treats any close or error before the session establishes as a candidate failure and moves on.

## 7. Phone requirements (summary — detail in the xavier child)

- `PairedHost` stores `connectUrls: string[]`. Loading a legacy record (`connectUrl` string) migrates the shape to a one-element list so the pairing survives the app update; gaining the relay candidate requires a re-pair, because the offer is the only source of new URLs.
- Sequential candidate failover with per-candidate budgets (a transport-open timeout, plus an establishment backstop set above the session layer's own request timeout so slow-but-valid hosts are never regressed), inserted at the two connect seams: initial pairing connect and the injected `connect(host)` inside `performReconnect`. Each candidate attempt spans session *establishment*, not just socket open — a socket that opens and then closes (e.g. relay `4404`/`4408`) before the session establishes fails that candidate and iteration advances. All candidates failing lands in the existing fail-closed `reconnectFailed` state. `driveWake` inherits address-awareness with no further change.

## 8. Relay server requirements (summary — detail in the xavier child)

`apps/relay` workspace app: Node + `ws`, pure-logic core with a thin socket shell (house style), in-memory hostId registry, challenge-response registration, one-time accept tokens with a short TTL, blind splice, heartbeats with dead-connection reaping, re-registration replaces the previous control connection, basic per-IP rate limiting, generous max payload on spliced endpoints. Ships with Dockerfile + compose + Caddy TLS runbook. Multi-tenant by construction.

## 9. Host requirements (ai-14all, summary — detail in the 14all child)

- Settings gain an optional relay base URL; unset means LAN-only — exactly today's behavior.
- `startPairing` advertises `[ws://<lanIPv4>:<port>, <relayBaseUrl>/connect/<hostId>]` when the relay is configured.
- A new relay-registration client maintains the persistent `/host` control channel: challenge-response with the existing identity sign key, keepalive, reconnect with jittered backoff. On `incoming-session` it dials `/accept/<token>` and hands the socket to the same frame-handling path an inbound LAN socket uses — the peer session cannot tell the difference.
- Registration lifecycle and accepted relay sessions land in the layered audit log at info level.
- The kill switch keeps its existing meaning (halts capability execution, not connectivity): registration stays up; a killed host still refuses over the relay exactly as it does over LAN.

## 10. Security posture (V6 inputs)

- **E2E:** the relay forwards ciphertext. A malicious or compromised relay can drop or delay traffic (availability) but cannot read or forge (envelope + anti-replay unchanged).
- **Registration:** the signature challenge kills hostId squatting — a denial-of-service that unauthenticated registration would allow.
- **Metadata at the relay:** peer IPs, connection timing, session duration are visible to the relay operator. In v1 the operator is the user; documented residual for Phase 5.
- **Transport:** phone↔relay and host↔relay ride wss (TLS terminated by Caddy). The LAN path stays ws, matching the existing posture.
- **Nuisance controls:** accept-token TTL, per-IP rate limits on `/connect` and `/host`, failures answered with close codes only (no error bodies to probe).
- V6 must explicitly review: the relay implementation, the deployment runbook, close-code behavior, and the phone's treat-close-as-failure handling.

## 11. Edge semantics (normative)

| Situation | Behavior |
|---|---|
| Phone at home, relay down or unconfigured | LAN candidate wins; relay never tried |
| Phone away, relay down | Relay candidate fails (timeout/refused) → all candidates fail → existing fail-closed `reconnectFailed` state |
| Phone away, host offline / not registered | `/connect` closes `4404` → candidate failure → next candidate or fail-closed |
| Host restarts | Registration client re-dials and re-authenticates; relay replaces the old control connection (only the true key holder can) |
| Relay restarts | Host re-registers on backoff; live spliced sessions die → phone reconnect runs failover again |
| Host never accept-dials (crashed mid-rendezvous) | Token TTL expires; relay closes the phone socket `4408` → candidate failure |
| Legacy stored pairing after app update | Shape migrates to `[lanUrl]`; away-connect impossible until re-pair (documented behavior) |
| V3 push-wake while away | `driveWake` → `performReconnect` → failover reaches the relay; no VPN dependency in the wake path |

## 12. Testing & acceptance

- **Contract** (ai-xavier): schema tests — non-empty enforcement, legacy-shape rejection, relay control-message round-trips, `deriveHostId` vectors.
- **Relay** (ai-xavier): in-process integration — a real `ReferenceHost` and reference client from the xbp package establish a genuine sealed session through a spliced pipe; auth failure, token expiry and reuse, host-restart replacement, dead-connection reaping.
- **Phone** (ai-xavier): pure unit tests — failover ordering/timeout/fail-closed, store shape migration, offer mapping.
- **Host** (ai-14all): registration state-machine tests against a scripted fake relay speaking the contract schemas; offer-shape tests for `startPairing`.
- **Joint acceptance** (house tradition): real iPhone on cellular ↔ relay on a real VPS ↔ real host — pair, away-connect, lifecycle capability, PTY watch; home-LAN regression (LAN wins, relay untouched); re-pair upgrade path from a legacy pairing. `docs/shared/XBP-PROTOCOL.md` gains the offer-shape and relay sections at acceptance, not before.

## 13. Delivery plan

1. **ai-xavier SDD** — contract bump + `apps/relay` + phone failover (this repo, branch `not-on-lan-connection`).
2. **Publish/vendor the `@xavier/xbp` bump** for 14all consumption (same flow as prior cross-repo slices).
3. **ai-14all SDD** (worktree `xavier-connection-remote-host`) — advertisement + registration client + audit.
4. **Deploy the relay** (operator VPS + DNS name + Caddy, per the runbook from step 1) → joint acceptance → protocol doc update, roadmap update (V2 redefinition; relay pulled forward from Phase 5), memory capture.

Operator prerequisites (user-provided): a VPS with Docker and a DNS name pointed at it.

One whisper workflow per repo; this umbrella is synced into both repos so each workflow reads the same truth.
