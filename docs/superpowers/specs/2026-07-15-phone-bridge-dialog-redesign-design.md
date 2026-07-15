# ai-14all — Phone Bridge Dialog Redesign (UI + flow)

**Status:** design approved (brainstorm 2026-07-15, mockup validated in visual companion). **Owner:** Vu Phan. **Repo:** ai-14all. **Branch:** `master`.

## 1. Context & goal

The Phone Bridge dialog (`PhoneBridgeDialog` → `PhoneBridgePanel`) is functional but raw: the panel's BEM classes have **no CSS anywhere**, every pairing state renders stacked at once, and several flow bugs make it fragile. This slice redesigns the dialog as a **single-view state machine driven by main-process truth**, with a full TUI-conformant visual treatment.

The validated interactive mockup lives at `.superpowers/brainstorm/3956-1784086061/content/phone-bridge-dialog-v2.html` (session-local, not committed); its layout and styling decisions are normative for §5.

## 2. Problems in the current implementation

1. **No CSS** for any `phone-bridge-panel__*` class — the dialog renders as unstyled text (`src/components/settings/PhoneBridgePanel.tsx` classes; nothing in `src/app/shell.css` or `src/styles/`).
2. **All states stacked**: status row, pair button, SAS block, and paired block are all mounted simultaneously; no flow.
3. **Duplicate title**: `Dialog.Title` "Phone Bridge" plus the panel's own `h2` "Phone Bridge".
4. **Stale QR**: `offerQr` local state is never cleared — the QR persists after pairing completes, is rejected, or the bridge is toggled off.
5. **Stuck SAS after Reject**: the vendor `ReferenceHost.confirmPairing(false)` does not clear `lastSas` (see unpair spec §3.2), so `status.sas` stays non-null and the SAS block never leaves the screen.
6. **Errors swallowed**: `confirmSas`/`forget` failures are `catch {}`-ignored; `startPairing` failures reject unhandled. The user sees nothing.
7. **No cancel** for a pending pairing: a stale QR offer stays live on the host; a phone scanning it later pops a surprise SAS prompt.
8. **Renderer guesses state** from local `offerQr` + `status.sas` instead of main-process truth; reopening the dialog mid-pairing loses the QR step.

## 3. Design — main process (authoritative pairing state)

### 3.1 Status contract extension

`XbpStatus` (`services/xbp/xbp-host-service.ts:27`) and its renderer mirror `PhoneBridgeStatus` (`shared/contracts/commands.ts:393`) both become:

```ts
{
	enabled: boolean;                // unchanged
	listening: boolean;              // unchanged
	addr: string | null;             // unchanged
	port: number | null;             // unchanged
	paired: boolean;                 // unchanged
	sas: string | null;              // unchanged
	pairing: "idle" | "awaiting-scan" | "awaiting-sas";
	offer: string | null;            // pending QR payload; renderer renders QR from status
	offerExpiresAt: number | null;   // epoch ms; renderer shows countdown
	pairedAt: number | null;         // from PairedDevice (already persisted)
	grantedPermissions: string[] | null; // from PairedDevice (already persisted)
	lastError: string | null;
}
```

### 3.2 Host service (`services/xbp/xbp-host-service.ts`)

- **Pending-offer tracking.** New private field `pendingOffer: { payload: string; expiresAt: number } | null`. Set by `startPairing()` (which now also calls `emitStatusChange()`); cleared on pairing confirmed, reject, cancel, forget, and stop. `getStatus()` treats an expired offer (`expiresAt <= now`) as absent (lazy expiry); a single `setTimeout` scheduled at offer creation emits a status change at expiry so the UI flips back without polling. The timer uses the injectable `opts.now` for testability and is cleared on any early transition and in `stop()`.
- **`pairing` derivation** in `getStatus()`: `sas != null` → `"awaiting-sas"`; live `pendingOffer` → `"awaiting-scan"`; else `"idle"`.
- **`cancelPairing(): Promise<void>`.** Swaps in a fresh `XbpPairingHost` (the exact move `forgetDevice()` already performs, per unpair spec §3.2 — drops the pending peer, pending offer token, and `lastSas` with zero audit noise), clears `pendingOffer`, appends one audit entry `{ cap: null, risk: null, outcome: "accepted", reason: "pairing-cancelled" }`, and emits a status change. A stale Confirm arriving afterwards hits `no-pending-pairing` — fail-closed, same as forget.
- **Reject fix.** `confirmPairing(false)` additionally performs the fresh-pairing-host swap and clears `pendingOffer` after the vendor host records its own `rejected` audit entry. This clears the stuck `lastSas` (§2 problem 5) and kills the dead offer token. No extra audit entries beyond the vendor's own.
- **`lastError`.** New private field. Every public operation (`start`, `stop`, `startPairing`, `confirmPairing`, `cancelPairing`, `forgetDevice`, `setEnabled`) sets `lastError` to the thrown error's message (then re-throws where it throws today) and emits a status change; a successfully completed public operation clears it. Not persisted.

### 3.3 IPC / contract / preload

- `electron/main/xbp-ipc.ts`: new `phoneBridge:cancelPairing` channel mirroring `forget`'s shape — `await deps.getService()?.cancelPairing(); return deps.getService()?.getStatus();` — null-service no-op returns `undefined`; `dispose()` removes the handler.
- `shared/contracts/commands.ts`: `cancelPairing(): Promise<PhoneBridgeStatus | undefined>` added to `Ai14AllDesktopApi["phoneBridge"]`; `PhoneBridgeStatus` extended per §3.1. Required members, so typecheck enforces the preload ripple.
- `electron/preload/index.ts`: duplicated channel constant + `cancelPairing: () => ipcRenderer.invoke(...)` binding, matching siblings.
- `startPairing`'s return value is kept for back-compat, but the renderer stops reading it — the QR payload arrives via status (`offer`).

## 4. Design — renderer state machine

`src/components/settings/PhoneBridgePanel.tsx` is rewritten. The `offerQr` state and all state guessing are deleted; the view is a pure derivation of `status`:

```
!status                   → loading   (single muted line)
!enabled                  → off       (explainer; the header toggle does the work)
enabled && !listening     → fault     (warning box + lastError detail)
paired                    → paired    (device card)
pairing === "awaiting-sas"→ sas       (verify step)
pairing === "awaiting-scan"→ scan     (QR step)
else                      → idle      (pair CTA)
```

- QR is rendered with `qrcode.toDataURL(status.offer)` inside an effect keyed on `status.offer`.
- Reopening the dialog mid-pairing recovers the exact step because the pairing state lives in main.
- The countdown ("Expires in m:ss") derives from `offerExpiresAt` with a 1 s interval while in `scan`; it turns `--warning`-colored at ≤30 s. Expiry itself is main-driven (status flips `pairing` back to `"idle"`); the renderer never decides expiry.
- Each async action (`setEnabled`, `startPairing`, `confirmSas`, `cancelPairing`, `forget`) disables its own button while in flight; the existing `unpairInFlight` ref-latch pattern is kept for unpair.

## 5. Design — layout & visuals (validated by mockup v2)

Dialog stays 560 px, reusing the existing `plugins-panel` chrome. The panel's duplicate `h2` is removed (dialog title remains the only title).

```
Phone Bridge
Connect a phone to monitor live agent sessions over your local network.
──────────────────────────────────────────────────  ← solid separator
● Listening on 192.168.1.52:61103        [██ on]     ← persistent status strip
──────────────────────────────────────────────────
   one state view below:

 off:     hint text: bridge off, enable to pair.

 idle:    PAIRING                                    ← 11px uppercase section label
          No phone paired.
          [ Pair a phone ]                           ← primary-bordered button

 scan:    PAIRING
          ┌─QR 168px─┐   Scan with your phone
          │ white bg │   Open ai-xavier on the same Wi-Fi network.
          └──────────┘   Expires in 2:41             ← --warning color at ≤30s
                         [ Cancel ]

 sas:     VERIFY
          Confirm this code matches your phone:
          500 563                                    ← 32px, 600, letter-spacing 0.35em, --primary
          The same six digits must be showing on the phone.
          [ Confirm ]   [ Reject ]                   ← primary / danger

 paired:  PAIRED DEVICE
          ┌──────────────────────────────────────┐
          │ [phone]  Phone paired      [ Unpair ] │   ← action INSIDE the card, top-right
          │ glyph    Paired 3 days ago            │
          │          Permissions: session reports │
          │          (read-only)                  │
          ├──────────────────────────────────────┤   ← confirm row expands within the card
          │ The phone will have to re-pair.       │
          │        [ Confirm unpair ]  [ Cancel ] │
          └──────────────────────────────────────┘

 fault:   ⚠ warning-bordered box: "Bridge is enabled but not listening."
          + lastError detail + "Toggle the bridge off and on to retry."
──────────────────────────────────────────────────
 ✕ lastError text                                    ← danger line, only when set
 [ Close ]
```

Visual rules (per the TUI constraint and the settings-dialog precedent in `shell.css`):

- Radius 0 everywhere; only the status dot is round (`border-radius: 50%`).
- Flat surfaces — no box-shadow on any new element.
- Solid `var(--border)` separators at `var(--shell-border-width)`.
- `var(--font-ui)` monospace throughout; section labels 11 px / 600 / uppercase / 0.04 em letter-spacing (`settings-dialog__section-title` convention).
- Buttons: transparent background, `var(--shell-border-width)` solid border, `4px var(--space-3)` padding, 0.75 rem — `.settings-dialog__close` convention. Primary variant: `--primary` border/text, filled on hover. Danger variant: `--destructive` border/text, filled on hover.
- Status dot colors: `--success` (listening), muted (off), `--warning` (fault). Error text: `--destructive`.
- Device glyph: monochrome (CSS-drawn or Nerd Font glyph) — no emoji.
- Paired-at shown as humanized relative time ("Paired 3 days ago") — reuse an existing relative-time helper if the repo has one, else a small local formatter.
- **Unpair containment (user decision 2026-07-15):** the Unpair action and its two-step confirmation live entirely inside the paired-device card — button top-right in the card's main row; confirm row expands below it inside the same card, separated by a solid border.
- New CSS lands as a `phone-bridge` block in `src/app/shell.css` beside the settings-dialog styles.

## 6. Design — error handling (two layers)

- **Inline (renderer-local):** every action handler catches failures into a local `actionError` rendered at the acting control; cleared on the next action or state change. No more silent `catch {}`.
- **Contract (`lastError`):** main-process failures ride status and render as the danger line above the footer; the `fault` view features the detail prominently.

## 7. Behaviour & edge cases

- **Toggle off mid-pairing:** `stop()` clears `pendingOffer` and the expiry timer; status flips to `off`; QR and SAS vanish. Re-enabling starts clean.
- **Offer expiry:** main emits at `offerExpiresAt`; renderer falls back to `idle`. A phone scanning the expired QR is rejected by the vendor TTL check (`pairingTokenTtlMs`, 180 s default — `offerExpiresAt` mirrors the same TTL).
- **Cancel then stale Confirm:** fresh pairing host → `no-pending-pairing` protocol rejection; nothing attaches or persists (same fail-closed argument as unpair spec §3.2).
- **Reject:** vendor `rejected` audit entry + host swap; `sas` and `offer` both null afterwards; UI returns to `idle`.
- **Dialog reopen mid-pairing:** status still carries `pairing`/`offer`/`sas` — the exact step is restored.
- **Unpair:** unchanged semantics from the unpair spec (`forgetDevice()`); only its presentation moves inside the device card.
- **Not-listening fault:** `enabled && !listening` renders the fault view with `lastError`; recovery is toggle off/on.

## 8. Testing

TDD per slice, mirroring existing xbp test structure:

- **Host service (vitest):** pending-offer lifecycle (set on `startPairing`, cleared on confirm/reject/cancel/forget/stop); lazy expiry + timer-driven status emit (fake timers + injected `now`); `pairing` derivation for all three phases; **reject-clears-sas regression** (fails against today's code); `cancelPairing` → stale Confirm fail-closed + single `pairing-cancelled` audit entry; `lastError` set on throw and cleared on next success.
- **IPC:** `phoneBridge:cancelPairing` invokes the service and returns post-cancel status; null-service returns `undefined`; `dispose()` removes the handler.
- **Panel (RTL):** one render test per state view (loading / off / fault / idle / scan / sas / paired); QR renders from `status.offer`; reopen-mid-pairing recovery (mount with `pairing: "awaiting-scan"` in status); action error surfaces inline; `lastError` renders the danger line; unpair confirm row expands inside the card. Existing `PhoneBridgeDialogGate.test.tsx` and panel tests updated for the new status shape.
- **Typecheck** enforces the contract ripple (preload + panel), as in the unpair slice.

## 9. Task decomposition (each independently green)

1. **Host service:** pending-offer tracking + status fields (`pairing`, `offer`, `offerExpiresAt`, `pairedAt`, `grantedPermissions`, `lastError`) + reject fix + `cancelPairing()` (+tests).
2. **IPC + contract + preload:** new channel + `PhoneBridgeStatus` extension (+tests).
3. **Panel rewrite:** state machine + views (+tests).
4. **CSS:** `phone-bridge` block in `src/app/shell.css`, checked against tokens in all four themes.

## 10. Non-goals

- **Device name** — the XBP protocol carries none; adding one is a cross-repo ai-xavier protocol change.
- **Multi-device management** — the bridge stays single-paired-phone.
- **Live "phone connected" indicator** — deferred; would need transport→service connection wiring.
- **Pairing/SAS crypto semantics** — unchanged; this is presentation + state plumbing only.

## 11. Risks / notes

- The pairing-host swap in `cancelPairing()`/reject reuses the pattern `forgetDevice()` shipped with; its fail-closed behaviour is already covered by the unpair suite — new tests only cover the new call sites.
- `PhoneBridgeStatus` is consumed only by `PhoneBridgePanel` (verified: `src/lib/desktop-client.ts` has no `phoneBridge` pass-through), so the contract extension ripples to preload + panel only.
- The expiry timer must not keep the process alive on shutdown — clear it in `stop()` (and it is naturally cleared on every pairing transition).
- Blast radius ~8 files across 4 tasks; each task stays ≤3 implementation files.
