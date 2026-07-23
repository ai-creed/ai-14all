# XBP Off-LAN Connection (V2) — ai-14all Child Design (host advertisement + relay registration)

**Date:** 2026-07-23 · **Status:** approved design, pre-implementation
**Parent:** `2026-07-23-v2-off-lan-relay-umbrella-design.md` (synced into this repo) — decisions, relay behavior, security posture, and edge semantics live there; this child carries the ai-14all implementation detail.
**Runs as:** SDD in ai-14all, worktree `xavier-connection-remote-host`.
**Depends on:** the published/vendored `@xavier/xbp` breaking bump from the ai-xavier child (offer `connect.urls`, `protocol/relay.ts` schemas, `deriveHostId`, close-code constants). Do not start implementation before that bump is consumable.

---

## 1. Scope

**In:** consuming the contract bump; a relay base-URL setting; multi-URL pairing-offer advertisement; the relay-registration client (persistent control channel, challenge-response, backoff); accept-dial handling that feeds relay sessions into the existing peer-session path; audit entries; minimal settings UI.

**Out:** the relay server itself and the phone (ai-xavier child); any change to the sealed protocol, capabilities, grants, or the kill switch's meaning.

## 2. Current state (grounded)

- `services/xbp/xbp-host-service.ts:212-216` — `startPairing()` builds the offer URL as `ws://${primaryLanIPv4() ?? "127.0.0.1"}:${this.lan.port}` and calls `this.pairingHost.createOffer({ url })`. Single URL, LAN only.
- `services/xbp/xbp-pairing-host.ts:36` — `createOffer(connect: { url: string })` passes through to `ReferenceHost.createPairingOffer`.
- `services/xbp/lan-websocket-transport.ts` — the inbound LAN listener; each accepted socket is wrapped and handed to the frame-handling / peer-session path. Relay sessions must enter through the same seam so the peer session cannot tell the transports apart.
- `services/xbp/xbp-identity-store.ts` — the host identity (sign keypair) the registration challenge signs with.
- `services/xbp/xbp-audit-sink.ts` — the layered audit log new events land in.
- `services/xbp/xbp-conformance-harness.ts:100,107` — calls `createPairingOffer()` with no argument; the contract's widened default keeps it compiling.

## 3. Settings

New optional setting `phoneBridge.relayBaseUrl` (string, e.g. `wss://relay.example.com`; empty/unset = LAN-only, exactly today's behavior). Persisted with the existing settings service; exposed in the phone-bridge settings surface as a single text field plus a read-only registration status line (registered / retrying / off). No other UI.

## 4. Offer advertisement

`startPairing()` builds the ordered candidate list:

```ts
const urls = [lanUrl];                                   // ws://<lanIPv4>:<port> — always first
if (relayBaseUrl) urls.push(`${relayBaseUrl}/connect/${hostId}`);
const offer = this.pairingHost.createOffer({ urls });
```

`hostId = deriveHostId(backend, identity.sign.publicKey)` from the contract. `XbpPairingHost.createOffer` widens its parameter type to match the bumped contract. The QR payload grows by one URL; no other pairing change.

## 5. Relay-registration client (`services/xbp/relay-registration.ts`, new)

A small state machine, pure core with injected socket factory and timers (mirrors the house pure-core style, fake-testable):

- **States:** `off` (no relayBaseUrl or bridge disabled) → `connecting` → `authenticating` → `registered` → `backoff` → `connecting` …
- **Connect + auth:** dial `wss://<relayBaseUrl>/host`; send `register { signPubHex }`; on `challenge { nonceHex }` sign the nonce bytes with the identity sign key (detached) and send `challenge-response { sigHex }`; `registered { hostId }` completes. The relay signals failure only by closing the socket with a code (`4400` protocol violation, `4401` bad auth — constants from the contract); there is no error frame. Any close, or a malformed relay frame received, sends the client to backoff.
- **Keepalive:** answer relay pings (ws library default pong); treat socket close/error as loss → backoff.
- **Backoff:** jittered exponential, 1 s → 60 s cap, reset on successful registration.
- **Incoming session:** on `incoming-session { token }`, dial `wss://<relayBaseUrl>/accept/${token}` and hand the opened socket to the exact wrapper + frame-handler path `lan-websocket-transport.ts` uses for an inbound LAN socket. One dial per token; failures are logged and dropped (the relay expires the token; the phone retries by candidate machinery).
- **Lifecycle:** active while the phone bridge is enabled and `relayBaseUrl` is set; stops (closes control channel) on bridge disable or setting cleared; restarts on change. The kill switch does NOT stop registration — it halts capability execution, so a killed host stays reachable and refuses over the relay exactly as over LAN.

## 6. Audit

Info-level entries in the existing layered audit log: `relay-registered` (hostId, relay URL), `relay-registration-lost` (reason), `relay-session-accepted`. Refusals and capability handling are unchanged and already audited.

## 7. Testing (TDD throughout)

- **Registration state machine:** unit tests with a scripted fake relay connection speaking the contract schemas — happy path, bad challenge signature path (relay closes), error message, loss → backoff → re-register, token accept-dial dispatch, disable/clear teardown, kill-switch non-interference.
- **Offer:** `startPairing` with and without `relayBaseUrl` — URL order, hostId derivation, LAN-only unchanged.
- **Wiring:** an accepted relay socket reaches the same peer-session attach path as a LAN socket (integration-style test with the fake relay).
- Cross-repo integration against the real `apps/relay` happens at joint acceptance (umbrella §12), not in this repo's suite.

## 8. Acceptance (repo-local; joint acceptance in umbrella §12)

- With `relayBaseUrl` unset: behavior byte-identical to today (offer carries one LAN URL; no relay traffic).
- With it set: offer carries both URLs; the host registers against a fake relay in tests; registration survives simulated loss with backoff; audit entries present.
- Settings UI: field + status line render and persist; no other phone-bridge UI change.
