# ai-14all — Phone Bridge: Unpair / Forget Device

**Status:** design approved (brainstorm 2026-07-09). **Owner:** Vu Phan. **Repo:** ai-14all. **Branch:** `dev-integration` (where all XBP / phone-bridge work lives; runs ahead of `master`).

## 1. Context & goal

The XBP phone bridge can pair a phone (`startPairing` → QR → `confirmSas`) and persists the paired device (`paired-device.enc`) so it survives a restart. But there is **no way to un-pair from the desktop**: `PhoneBridgePanel` disables "Pair a phone" whenever `status.paired` is true, and `electron/main/xbp-ipc.ts` exposes only `status` / `setEnabled` / `startPairing` / `confirmSas` — no forget/unpair channel. The host service itself documents the gap: `xbp-host-service.ts` (`// Device-forget path: today forgetting = removing paired-device.enc … no in-app unpair until Arc C`).

Consequences:
- **Re-pairing is a dead-end.** Once a device is stored, the only way to pair a different/reset phone is to quit the app, hand-delete `paired-device.enc`, and relaunch.
- **Reset-orphaning is unrecoverable in-app.** When the phone runs "Reset this device" (regenerates its identity), the desktop still holds the old `paired-device.enc`; there is no in-app way to clear it, so the phone can never re-pair.

This slice adds the missing **unpair/forget** path. It is the Arc C prerequisite that unblocks the phone's deferred **Disconnect** action and makes phone re-pairing work end-to-end. It is tracked independently of, and runs in parallel with, the ai-xavier **C1b** phone slice (one ai-whisper workflow per repo — a single mount cannot deliver cross-repo commits).

## 2. Scope

### In scope
- A `detach()` seam on `XbpPeerSession` that de-authorizes the live phone without tearing down the LAN transport.
- A `forgetDevice()` method on `XbpHostService` that drops the paired device, cancels any in-flight (pending-SAS) pairing, clears its persisted record and push token, audits the action, and emits a status change — leaving the bridge enabled/listening so re-pair works immediately.
- A `phoneBridge:forget` IPC channel + preload binding, typed through the canonical `Ai14AllDesktopApi` contract (`shared/contracts/commands.ts`).
- An **"Unpair phone"** button in `PhoneBridgePanel`, with confirmation.

### Non-goals
- **Auto-detecting a phone-side reset.** This provides the manual desktop-side clear that was missing; it does not observe the phone's identity changing. Recovery from the orphaned state is: reset on phone → **Unpair** on desktop → re-pair.
- **Multi-device management.** The bridge remains single-paired-phone; Unpair clears the one device.
- **Changing the pairing/SAS flow**, grants, or the enable/disable feature flag.
- **Remote (phone-initiated) unpair.** Unpair is a desktop-operator action. (The phone's own Disconnect, deferred in ai-xavier C1b, is a separate, phone-local sever.)

## 3. Architecture / surface

Six files, each with a single, testable responsibility.

### 3.1 `services/xbp/xbp-peer-session.ts` — `detach()`

`attach()` already begins by tearing down any prior peer so a re-pair drops the old phone:

```ts
this.peer?.stop();
this.peer = null;
this.phoneNode = null;
```

Extract that into a `detach(): void` method and have `attach()` call it first (behaviour-preserving refactor). `detach()` de-authorizes the currently-attached phone — its `Peer` stops, so it is no longer subscribed/authorized on the transport — while leaving the shared transport and the change coalescer intact, so a subsequent `attach()` (a fresh pairing) works normally. `detach()` must be idempotent (safe when no peer is attached).

Note: this is distinct from the existing `stop()`, which also cancels the coalescer and is the full service-teardown path. `detach()` is the lighter "de-authorize the phone, keep serving" seam.

### 3.2 `services/xbp/xbp-host-service.ts` — `forgetDevice()`

```ts
async forgetDevice(): Promise<void>
```

Steps, in order:
1. `this.peerSession?.detach()` — drop the live phone's authorization; its session closes.
2. **Reset the pairing host** — cancel any in-flight pairing so no stale Confirm can complete after the forget:
   ```ts
   if (this.pairingHost) {
   	this.pairingHost = new XbpPairingHost({
   		backend: this.backend!,
   		identity: this.identity!,
   		audit: this.audit!,
   		now: this.opts.now,
   	});
   }
   ```
   Why a fresh instance rather than `confirmPairing(false)`: `ReferenceHost` keeps `pendingPeer`/`pendingToken` private, `confirmPairing(false)` does **not** clear `lastSas` or the pending offer token, and calling it when nothing is pending appends a spurious `rejected`/`no-pending-pairing` audit entry (`node_modules/@xavier/xbp/src/reference/host.ts:153-166`). Recreating `XbpPairingHost` drops the pending peer, the pending offer token (a stale QR dies too), and `lastSas` in one move with zero audit noise. The swap is seamless: the LAN frame handler reads `this.pairingHost!` per frame (`xbp-host-service.ts:118-122`), and whenever `pairingHost` is non-null, `backend`/`identity`/`audit` are too (all created together in `start()`). A stale Confirm arriving after the reset hits the fresh host's `confirmPairing` → `no-pending-pairing` protocol rejection, attaches nothing, persists nothing — fail-closed.
3. `this.pairedDevice = null`.
4. `this.pairedStore.clear()` — delete `paired-device.enc` (method already exists).
5. `this.opts.pushTokenStore?.clear()` — a leftover push token must not outlive the pairing that authorized it (the same rule the boot path already applies for the no-device case).
6. `this.audit?.append({ cap: null, risk: null, outcome: "accepted", reason: "device-forgotten" })` — the administrative action is auditable (layered-audit principle; the sink's `outcome` enum is `"accepted" | "rejected"`).
7. `this.emitStatusChange()` — pushes a fresh `getStatus()` (now `paired: false`, `sas: null`) to the renderer.

The service stays **enabled and listening** (LAN host and identity are untouched; the pairing host is a fresh instance ready to mint a new offer), so "Pair a phone" re-enables and a fresh pairing can start immediately. `getStatus().paired` already derives from `this.pairedDevice != null`, so it flips to `false` with no other change.

### 3.3 `electron/main/xbp-ipc.ts` — `phoneBridge:forget`

- Add `export const PHONE_BRIDGE_FORGET = "phoneBridge:forget";`.
- Register a handler mirroring `setEnabled`'s shape:
  ```ts
  ipcMain.handle(PHONE_BRIDGE_FORGET, async () => {
    await deps.getService()?.forgetDevice();
    return deps.getService()?.getStatus();
  });
  ```
  A null service (bridge off) is a graceful no-op returning `undefined`, consistent with the other handlers.
- Add `ipcMain.removeHandler(PHONE_BRIDGE_FORGET)` to `dispose()`.

### 3.4 `shared/contracts/commands.ts` — typed contract

The canonical renderer-facing API type is `Ai14AllDesktopApi` in `shared/contracts/commands.ts` (the `phoneBridge` member is at `:729-764`); `electron/preload/index.ts` imports it (`:1-5`) and implements it. Extend `Ai14AllDesktopApi["phoneBridge"]` with:

```ts
forget(): Promise<
	| {
			enabled: boolean;
			listening: boolean;
			addr: string | null;
			port: number | null;
			paired: boolean;
			sas: string | null;
	  }
	| undefined
>;
```

(same status shape as `setEnabled`; `undefined` is the null-service no-op). Note: `src/lib/desktop-client.ts` does **not** pass `phoneBridge` through — `PhoneBridgePanel` reads `window.ai14all.phoneBridge` directly — so the required member ripples only into the preload implementation, nowhere else.

### 3.5 `electron/preload/index.ts` — bridge binding

- Add `const PHONE_BRIDGE_FORGET = "phoneBridge:forget";` alongside the sibling constants (they are duplicated in preload to keep Zod out of the sandboxed context).
- Add to the `phoneBridge` api object: `forget: () => ipcRenderer.invoke(PHONE_BRIDGE_FORGET)`. The object is typed by the `Ai14AllDesktopApi` contract extended in §3.4, so a missing implementation fails typecheck.

### 3.6 `src/components/settings/PhoneBridgePanel.tsx` — "Unpair phone"

In the paired block (rendered when `status?.paired`), add an **"Unpair phone"** button:
- Danger-styled, symmetric with "Pair a phone".
- **Confirmation required** (dropping the pairing is destructive and the phone will have to re-pair). Use the panel's existing confirmation convention if one exists; otherwise a minimal two-step confirm ("Unpair phone" → "Confirm unpair?") in the panel's own style.
- On confirm → `await window.ai14all.phoneBridge.forget()`. No new state wiring: the existing `onStatusChanged` subscription delivers `paired: false`, which re-enables "Pair a phone" and hides the paired block.

## 4. Behaviour & edge cases

- **Live phone connected at unpair:** `detach()` stops its peer → the phone observes the drop and transitions to `lost` / unpaired. Correct: a desktop-initiated sever.
- **Not paired (no confirmed device, nothing pending):** `pairedDevice` is already `null`; `pairedStore.clear()` is a no-op (the file may not exist), the push token is cleared defensively, and a status change still emits. Safe idempotent no-op.
- **Mid-SAS (pairing pending, not yet confirmed):** forget **cancels the pending pairing** via the pairing-host reset (§3.2 step 2). A stale Confirm arriving after the forget returns `false` (`no-pending-pairing` protocol rejection) and attaches/persists nothing; the pre-forget QR offer token is dead; `getStatus().sas` reverts to `null`. Without this, `ReferenceHost` would keep `pendingPeer` until confirm/reject and a stale Confirm could still complete the pairing after the operator unpaired.
- **Bridge disabled:** the button lives in the paired block, which only renders when paired (which requires enabled); the IPC handler additionally no-ops on a null service.
- **Re-pair immediately after unpair:** transport and identity are untouched and the reset pairing host mints fresh offers, so `startPairing()` works with no restart.

## 5. Testing

Node/vitest, mirroring the existing xbp service tests:
- **`forgetDevice`**: after a paired setup, it detaches the peer, nulls `pairedDevice`, calls `pairedStore.clear()` and `pushTokenStore.clear()`, appends an `accepted` audit entry with `reason: "device-forgotten"` (and no other entries — the pairing-host reset must not add `rejected` noise), emits a status change, and leaves the service enabled (`getStatus().paired === false`, `enabled === true`). Idempotent when not paired. **Re-pair after forget:** a full fresh pairing (`startPairing` → pair-request → `confirmPairing(true)`) completes against the same service instance with no restart.
- **Mid-SAS regression (required):** drive a real pending pairing (`startPairing()`, then a `pair-request` frame so `ReferenceHost` holds `pendingPeer` and `getStatus().sas` is non-null) → `forgetDevice()` → assert `getStatus().sas === null`; a subsequent `confirmPairing(true)` returns `false`, attaches no peer, and persists nothing (`pairedStore` stays empty, `getStatus().paired === false`); replaying the pre-forget offer token in a new `pair-request` is rejected. This test must fail against an implementation whose `forgetDevice()` skips the pairing-host reset.
- **`XbpPeerSession.detach`**: stops the active peer and nulls it; a subsequent `attach()` re-authorizes and serves normally; `detach()` is safe when no peer is attached; `detach()` does not cancel the coalescer (a later `notifyChanged()` after re-`attach` still fires).
- **IPC handler**: `phoneBridge:forget` invokes `forgetDevice()` and returns the post-forget status; null-service path returns `undefined` without throwing; `dispose()` removes the handler.
- **Panel**: thin presenter — the button renders in the paired state, requires confirmation, and calls `forget()`. Kept minimal (no branching logic beyond the confirm gate).
- **Typed contract**: `forget` is a **required** member of `Ai14AllDesktopApi["phoneBridge"]` (§3.4), so `pnpm typecheck` enforces the preload implementation and the panel call site — this is part of acceptance E, no separate runtime test needed.

## 6. Acceptance criteria

- **A — Unpair clears state:** with a phone paired, tapping "Unpair phone" (confirmed) removes `paired-device.enc`, clears the push token, and `status.paired` becomes `false`.
- **B — Re-pair works after unpair:** "Pair a phone" re-enables immediately and a fresh pairing completes end-to-end, with no app restart and no hand-editing of files.
- **C — Live phone severed:** a connected phone loses its session on unpair.
- **D — Audited:** the forget appends one `accepted` audit entry.
- **E — Green:** typecheck, lint, and the xbp unit suite pass on `dev-integration` — including the `shared/contracts/commands.ts` `forget` contract member, whose absence anywhere in preload or the panel fails typecheck.
- **F — Mid-SAS forget cancels the pending pairing:** with a pairing pending (SAS displayed, unconfirmed), forget clears it — a stale Confirm afterwards pairs nothing and `status.sas` is `null`.

## 7. Risks / notes

- **Verification/build target is `dev-integration`**, not `master` — XBP work lands there first and runs many commits ahead. Build and run the suite in `/Users/vuphan/Dev/ai-14all/.worktrees/dev-integration` (the SDD workflow branches from there).
- **`detach()` vs `stop()` confusion:** the refactor must keep `stop()`'s full-teardown semantics (coalescer cancel + peer stop) and introduce `detach()` as the narrower de-authorize. The `attach()` call-site change is behaviour-preserving and covered by the existing attach/re-pair tests plus the new detach test.
- **Blast radius:** 6 files; per the "≤3 files per task" guidance the implementation plan decomposes into tasks (peer-session seam → host-service method → IPC → shared contract + preload → panel), each with its own verification. `src/lib/desktop-client.ts` is intentionally NOT in the radius — it has no `phoneBridge` pass-through (verified; the panel uses `window.ai14all.phoneBridge` directly), so the required contract member does not ripple there.
- **Merge point with ai-xavier:** once this lands, a small ai-xavier phone follow-up surfaces the dormant `useApp.panic` teardown as `disconnect()` in phone Settings; the reconnect story then works via a fresh pair.
