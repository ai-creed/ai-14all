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
- A `forgetDevice()` method on `XbpHostService` that drops the paired device, clears its persisted record and push token, audits the action, and emits a status change — leaving the bridge enabled/listening so re-pair works immediately.
- A `phoneBridge:forget` IPC channel + preload binding.
- An **"Unpair phone"** button in `PhoneBridgePanel`, with confirmation.

### Non-goals
- **Auto-detecting a phone-side reset.** This provides the manual desktop-side clear that was missing; it does not observe the phone's identity changing. Recovery from the orphaned state is: reset on phone → **Unpair** on desktop → re-pair.
- **Multi-device management.** The bridge remains single-paired-phone; Unpair clears the one device.
- **Changing the pairing/SAS flow**, grants, or the enable/disable feature flag.
- **Remote (phone-initiated) unpair.** Unpair is a desktop-operator action. (The phone's own Disconnect, deferred in ai-xavier C1b, is a separate, phone-local sever.)

## 3. Architecture / surface

Five files, each with a single, testable responsibility.

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
2. `this.pairedDevice = null`.
3. `this.pairedStore.clear()` — delete `paired-device.enc` (method already exists).
4. `this.opts.pushTokenStore?.clear()` — a leftover push token must not outlive the pairing that authorized it (the same rule the boot path already applies for the no-device case).
5. `this.audit?.append({ cap: null, risk: null, outcome: "accepted", reason: "device-forgotten" })` — the administrative action is auditable (layered-audit principle; the sink's `outcome` enum is `"accepted" | "rejected"`).
6. `this.emitStatusChange()` — pushes a fresh `getStatus()` (now `paired: false`) to the renderer.

The service stays **enabled and listening** (LAN host, pairing host, and identity are untouched), so "Pair a phone" re-enables and a fresh pairing can start immediately. `getStatus().paired` already derives from `this.pairedDevice != null`, so it flips to `false` with no other change.

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

### 3.4 `electron/preload/index.ts` — bridge binding

- Add `const PHONE_BRIDGE_FORGET = "phoneBridge:forget";` alongside the sibling constants.
- Add to the `phoneBridge` api object: `forget: () => ipcRenderer.invoke(PHONE_BRIDGE_FORGET)`.
- Extend the `phoneBridge` TypeScript type on the exposed `ai14all` surface with `forget: () => Promise<BridgeStatus | undefined>`.

### 3.5 `src/components/settings/PhoneBridgePanel.tsx` — "Unpair phone"

In the paired block (rendered when `status?.paired`), add an **"Unpair phone"** button:
- Danger-styled, symmetric with "Pair a phone".
- **Confirmation required** (dropping the pairing is destructive and the phone will have to re-pair). Use the panel's existing confirmation convention if one exists; otherwise a minimal two-step confirm ("Unpair phone" → "Confirm unpair?") in the panel's own style.
- On confirm → `await window.ai14all.phoneBridge.forget()`. No new state wiring: the existing `onStatusChanged` subscription delivers `paired: false`, which re-enables "Pair a phone" and hides the paired block.

## 4. Behaviour & edge cases

- **Live phone connected at unpair:** `detach()` stops its peer → the phone observes the drop and transitions to `lost` / unpaired. Correct: a desktop-initiated sever.
- **Not paired / mid-SAS (no confirmed device):** `pairedDevice` is already `null`; `pairedStore.clear()` is a no-op (the file may not exist), the push token is cleared defensively, and a status change still emits. Safe idempotent no-op.
- **Bridge disabled:** the button lives in the paired block, which only renders when paired (which requires enabled); the IPC handler additionally no-ops on a null service.
- **Re-pair immediately after unpair:** transport, pairing host, and identity are untouched, so `startPairing()` works with no restart.

## 5. Testing

Node/vitest, mirroring the existing xbp service tests:
- **`forgetDevice`**: after a paired setup, it detaches the peer, nulls `pairedDevice`, calls `pairedStore.clear()` and `pushTokenStore.clear()`, appends an `accepted` audit entry with `reason: "device-forgotten"`, emits a status change, and leaves the service enabled (`getStatus().paired === false`, `enabled === true`). Idempotent when not paired.
- **`XbpPeerSession.detach`**: stops the active peer and nulls it; a subsequent `attach()` re-authorizes and serves normally; `detach()` is safe when no peer is attached; `detach()` does not cancel the coalescer (a later `notifyChanged()` after re-`attach` still fires).
- **IPC handler**: `phoneBridge:forget` invokes `forgetDevice()` and returns the post-forget status; null-service path returns `undefined` without throwing; `dispose()` removes the handler.
- **Panel**: thin presenter — the button renders in the paired state, requires confirmation, and calls `forget()`. Kept minimal (no branching logic beyond the confirm gate).

## 6. Acceptance criteria

- **A — Unpair clears state:** with a phone paired, tapping "Unpair phone" (confirmed) removes `paired-device.enc`, clears the push token, and `status.paired` becomes `false`.
- **B — Re-pair works after unpair:** "Pair a phone" re-enables immediately and a fresh pairing completes end-to-end, with no app restart and no hand-editing of files.
- **C — Live phone severed:** a connected phone loses its session on unpair.
- **D — Audited:** the forget appends one `accepted` audit entry.
- **E — Green:** typecheck, lint, and the xbp unit suite pass on `dev-integration`.

## 7. Risks / notes

- **Verification/build target is `dev-integration`**, not `master` — XBP work lands there first and runs many commits ahead. Build and run the suite in `/Users/vuphan/Dev/ai-14all/.worktrees/dev-integration` (the SDD workflow branches from there).
- **`detach()` vs `stop()` confusion:** the refactor must keep `stop()`'s full-teardown semantics (coalescer cancel + peer stop) and introduce `detach()` as the narrower de-authorize. The `attach()` call-site change is behaviour-preserving and covered by the existing attach/re-pair tests plus the new detach test.
- **Blast radius:** 5 files; per the "≤3 files per task" guidance the implementation plan decomposes into tasks (peer-session seam → host-service method → IPC → preload → panel), each with its own verification.
- **Merge point with ai-xavier:** once this lands, a small ai-xavier phone follow-up surfaces the dormant `useApp.panic` teardown as `disconnect()` in phone Settings; the reconnect story then works via a fresh pair.
