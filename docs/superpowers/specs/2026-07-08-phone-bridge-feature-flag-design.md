# Phone / Xavier (xbp) Integration — Production Feature Flag — Design

**Date:** 2026-07-08
**Status:** Approved design, pending implementation plan
**Scope:** Gate the phone-bridge / Xavier (xbp) pairing integration behind a single config flag so it is fully absent in production builds and enabled only on the developer's own machine.

## 1. Context

The phone-bridge (xbp) integration is currently wired to run **unconditionally**, in two layers:

- **Renderer** — a single "Phone Bridge" button in the session chip bar (`src/app/components/MainColumnChrome.tsx:169-176`, passed `onOpenPhoneBridge` from `src/app/App.tsx:2301`) opens `PhoneBridgeDialog` (`src/components/settings/PhoneBridgeDialog.tsx`, rendered unconditionally at `src/app/App.tsx:2477-2480`, controlled by the `phoneBridgeDialogOpen` state at `App.tsx:879`). This button is the **only** user-facing entry point — there is no menu item, keyboard shortcut, IPC-triggered open, or SettingsDialog entry.
- **Main** — `XbpHostService` is constructed and `start()`-ed unconditionally at app boot (`electron/main/index.ts:516-543`, `await xbpService.start()` at `:540`). `start()` opens a LAN WebSocket listener bound to `0.0.0.0` on an ephemeral port (`services/xbp/xbp-host-service.ts:100`, via `createLanWebSocketHost()`), which is the actual pairing host a phone connects to. IPC is registered at `:545-549`.

Both layers must be gated: hiding the button alone would still leave the LAN pairing host listening. The requirement is that in production **no one can see the pair-phone dialog and no one can pair**, while the developer can enable both on their own machine.

The app already persists user settings via a schema'd, main-process-owned store: `PersistedSettingsV1Schema` (`shared/models/persisted-settings.ts`), served by `SettingsService` (`services/settings/settings-service.ts`, `<userData>/settings.json`). The renderer reads settings synchronously at boot through the preload and subscribes to a `settings:changed` push (`src/app/hooks/use-settings.tsx`). This is the natural, in-convention home for the flag.

An `app.isPackaged` build gate already exists as a precedent for hiding an unreleased integration (`electron/main/index.ts:568`, the Samantha `hidden` gate), but a **config flag** was chosen over a build gate so the integration also works in a *packaged* build on the developer's machine and stays off for every other install regardless of build type.

## 2. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | One config flag, `phoneBridge.enabled` (default `false`), added to `PersistedSettingsV1Schema` | Matches the existing settings convention; a per-machine `settings.json` value is the literal "feature flag in the config" the user asked for, and works in both dev and packaged builds on their machine. |
| D2 | A single shared predicate `isPhoneBridgeEnabled(settings)` in `shared/models/persisted-settings.ts`, imported by **both** main and renderer | One source of truth for the gate so the visibility layer and the capability layer can never drift. Avoids duplicated `?.enabled ?? false` logic. |
| D3 | Nested object shape `phoneBridge: { enabled }` over a flat `phoneBridgeEnabled` scalar | Namespaces future phone-bridge sub-settings, reads cleanly in `settings.json`, and mirrors the existing nested `usageTelemetry` precedent (including its bare-optional patch schema). |
| D4 | The flag gates **both** the renderer UI (button + dialog) and the main-process host (`XbpHostService` construction + `start()`) | "See the dialog **and** do a pairing" requires suppressing the LAN listener, not just the button. Defense in depth. |
| D5 | The flag is read at **boot**; runtime edits take effect on app restart | Acceptable for a developer-only flag; avoids live host start/stop plumbing for the new gate. The pre-existing runtime `phoneBridge:setEnabled` IPC is unaffected but unreachable when the UI is hidden. |
| D6 | **No visible toggle** anywhere; enablement is by hand-editing the local `settings.json` | Keeps the flag undiscoverable in production so no other install can flip it on. The developer's machine is the only place the value is ever set. |
| D7 | Extract the boot gate into an injectable seam `createXbpHostIfEnabled` (`electron/main/xbp-boot.ts`) that is the **sole** `XbpHostService` construction site | The production safety property lives in app-bootstrap code that can't be unit-tested by booting Electron. Extracting a small injectable factory makes "disabled ⇒ no host, no LAN listener" a **mandatory, unit-tested regression guard** instead of a prose assertion an implementer could silently break. |

## 3. Components

### 3.1 Schema and predicate — `shared/models/persisted-settings.ts`

Add the flag to the main schema and a bare, all-optional patch schema (the `usageTelemetry` pattern that avoids zod re-injecting defaults on a sub-patch, per the existing comment at lines 42-63), plus the shared predicate:

```ts
export const PhoneBridgeSettingsSchema = z.object({
  enabled: z.boolean(),
});

// in PersistedSettingsV1Schema:
phoneBridge: PhoneBridgeSettingsSchema.default({ enabled: false }),

// bare patch mirror (like UsageTelemetryPatchSchema):
const PhoneBridgePatchSchema = z.object({
  enabled: z.boolean().optional(),
});

// in SettingsPatchSchema:
phoneBridge: PhoneBridgePatchSchema.optional(),

// single source of truth for the gate:
export function isPhoneBridgeEnabled(s: PersistedSettingsV1): boolean {
  return s.phoneBridge.enabled;
}
```

Because the main schema applies `.default({ enabled: false })`, `s.phoneBridge` is always present after a parse, so the predicate needs no optional chaining. `DEFAULT_PERSISTED_SETTINGS` (`= PersistedSettingsV1Schema.parse({ version: 1 })`) therefore carries `phoneBridge.enabled === false` automatically. The inner `enabled` field is a bare `z.boolean()` (no per-field `.default()`) — the whole-object `.default({ enabled: false })` supplies the default, which sidesteps the "sub-patch re-injects field defaults" gotcha the file documents for `usageTelemetry` (lines 42-63).

**Write-merge — `services/settings/settings-service.ts:122-134`.** `phoneBridge` is a nested object, so `writeState` must deep-merge it exactly as it already does for `usageTelemetry`, otherwise a partial patch would replace the whole sub-object (harmless today with a single field, but a latent clobber once `phoneBridge` gains a second key — and D3 explicitly anticipates that). Add the parallel branch:

```ts
...(patch.phoneBridge
  ? { phoneBridge: { ...this.current.phoneBridge, ...patch.phoneBridge } }
  : {}),
```

### 3.2 Main host gate — new `electron/main/xbp-boot.ts` + `electron/main/index.ts:512-543`

The gate protects the core production safety property (disabled ⇒ no pairable LAN host), so it must be a **mandatory, unit-tested regression guard**, not inline bootstrap code exercisable only by launching Electron. The decision-to-construct is therefore extracted into a small injectable seam, `createXbpHostIfEnabled`, in a new `electron/main/xbp-boot.ts`. This seam is the **sole `new XbpHostService(...)` construction site in the main process** — an architectural invariant: `index.ts` must not construct the service directly, it only supplies the constructor options. That invariant is what makes "disabled ⇒ no host, no LAN listener" *provable* in a unit test (unit-test the seam with the `XbpHostService` module mocked) rather than merely asserted in prose.

```ts
// electron/main/xbp-boot.ts
import { XbpHostService } from "../../services/xbp/xbp-host-service.js";

type XbpHostServiceOptions = ConstructorParameters<typeof XbpHostService>[0];

export async function createXbpHostIfEnabled(deps: {
  enabled: boolean;
  options: XbpHostServiceOptions; // constructor config; the service is built HERE, never in index.ts
  onStartError?: (err: unknown) => void;
}): Promise<XbpHostService | null> {
  if (!deps.enabled) return null; // no construction ⇒ start() never runs ⇒ no LAN WebSocket listener
  const service = new XbpHostService(deps.options);
  try {
    await service.start();
  } catch (err) {
    deps.onStartError?.(err); // preserve the existing log-and-continue boot behavior
  }
  return service;
}
```

`index.ts` reads the persisted settings synchronously (the `SettingsService` is already constructed earlier in boot and exposes a sync read) and **delegates** construction + start to the seam by handing it the options object — it performs no `new XbpHostService(...)` of its own and imports the class type-only:

```ts
const { settings } = settingsService.readStateSync(); // returns { settings, firstRun }
const xbpService = await createXbpHostIfEnabled({
  enabled: isPhoneBridgeEnabled(settings),
  options: { /* dir, secureStorage, getSessionReport, acting, subscribeChanges, onStatusChange */ },
  onStartError: (err) => {
    // existing log-and-continue behavior
  },
});
registerXbpIpc({ ipcMain, getService: () => xbpService, getWebContents });
```

When the flag is off, the seam returns before `new XbpHostService(...)`, so `xbpService` is `null` and **no LAN WebSocket listener is opened** — the listener only opens inside `XbpHostService.start()` (`services/xbp/xbp-host-service.ts:100`), which is unreachable without construction. `registerXbpIpc` is still called unconditionally so the renderer's IPC surface exists — and it needs **no change**: all four handlers already null-guard via optional chaining and return safe fallbacks for a `null` service (`electron/main/xbp-ipc.ts:18-25` `status` → all-false object; `:29,31` `setEnabled` → no-op/`undefined`; `:34-35` `startPairing` → `{ offer: null }`; `:37-40` `confirmSas` → `false`). A stray `phoneBridge:*` call can therefore never throw. (These handlers are unreachable in production anyway, because the UI entry point is hidden.)

### 3.3 Renderer gate — self-gating `PhoneBridgeEntryButton` + `PhoneBridgeDialogGate`

Both renderer surfaces are **self-gating**: each is a small component that reads `useSettings()` and applies `isPhoneBridgeEnabled` itself, rendering `null` when the flag is off. This puts the settings→UI derivation inside components that are unit-testable against a real `SettingsProvider` (seeded with `phoneBridge.enabled` false/true), and leaves `App.tsx` / `MainColumnChrome` with **no** flag logic to hard-code, invert, or forget.

```tsx
// src/app/components/PhoneBridgeEntryButton.tsx — the sole entry point
export function PhoneBridgeEntryButton(props: { onOpen: () => void }): React.ReactElement | null {
  const { settings } = useSettings();
  if (!isPhoneBridgeEnabled(settings)) return null;
  return (/* the existing "Phone Bridge" button markup, wired to props.onOpen */);
}

// src/app/components/PhoneBridgeDialogGate.tsx — the dialog wrapper
export function PhoneBridgeDialogGate(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement | null {
  const { settings } = useSettings();
  if (!isPhoneBridgeEnabled(settings)) return null;
  return <PhoneBridgeDialog open={props.open} onOpenChange={props.onOpenChange} />;
}
```

`MainColumnChrome` renders `<PhoneBridgeEntryButton onOpen={onOpenPhoneBridge} />` in place of the inline button (`MainColumnChrome.tsx:169-176`); its `onOpenPhoneBridge` prop is unchanged. `App.tsx` swaps its raw `<PhoneBridgeDialog …>` render for `<PhoneBridgeDialogGate open={phoneBridgeDialogOpen} onOpenChange={setPhoneBridgeDialogOpen} />` and keeps passing `onOpenPhoneBridge={openPhoneBridge}` — it derives no flag of its own. Because each component reads the flag from context, a disabled build shows neither the button nor the dialog.

## 4. Enablement (developer, this machine)

Edit the machine-local settings file and restart:

```jsonc
// <userData>/settings.json
{ "version": 1, "phoneBridge": { "enabled": true }, /* ...other settings... */ }
```

There is no UI to toggle the flag. Every clean install ships `phoneBridge.enabled === false` (schema default) → no host service, no LAN listener, no button. The value is only ever set on the developer's own machine.

## 5. Testing (TDD — tests written first)

- **Schema** (`tests/unit/.../persisted-settings*.test.ts` or equivalent): `PersistedSettingsV1Schema.parse({ version: 1 })` yields `phoneBridge.enabled === false`; a patch `{ phoneBridge: { enabled: true } }` round-trips through `SettingsPatchSchema` and `SettingsService.writeState`'s deep-merge without clobbering sibling settings; a legacy object missing `phoneBridge` parses to the `false` default.
- **Predicate**: `isPhoneBridgeEnabled` returns `true`/`false` for the corresponding flag values.
- **Renderer**: unit-test each self-gating component by rendering it inside a real `SettingsProvider` seeded (via `window.ai14all.settings.initial`) with `phoneBridge.enabled` false and true — `PhoneBridgeEntryButton` shows/hides the "Phone Bridge" button (and wires `onOpen`), and `PhoneBridgeDialogGate` mounts/omits `PhoneBridgeDialog` (mocked). Driving from settings, not a literal prop, is what proves the flag→UI contract.
- **Main-process host gate — REQUIRED (this is the production safety property, not optional).** A dedicated unit test of `createXbpHostIfEnabled` (`electron/main/xbp-boot.ts`) with the **`XbpHostService` module mocked** (`vi.mock`) so it runs without booting Electron and without a real service:
  - **disabled** (`enabled: false`) ⇒ the mocked `XbpHostService` constructor is **never called**, the result is `null`, and `start()` is therefore never invoked — i.e. no `XbpHostService` is constructed and **no LAN WebSocket listener is opened**. This test MUST fail if construction is not skipped; it is the exact regression that would otherwise let a forgotten gate ship a pairable host.
  - **enabled** (`enabled: true`) ⇒ the mocked constructor is called **exactly once with the passed `options`**, the returned service's `start()` is awaited, and the service is returned.
  - **enabled + `start()` rejects** ⇒ `onStartError` is invoked and the constructed service is still returned (preserves the existing log-and-continue boot behavior).

  Because `createXbpHostIfEnabled` is the **sole** `XbpHostService` construction site (§3.2 invariant), a passing disabled-case test guarantees a disabled build constructs no host and opens no listener — closing the gap that a predicate-only test would leave open.

## 6. Edge cases

- **Legacy `settings.json`** lacking `phoneBridge` → schema default `false` (safe; integration stays off).
- **Flag off, `phoneBridge:*` IPC invoked** → the existing optional-chaining guards in every handler return all-false / no-op; never throws (§3.2). No IPC-layer change needed.
- **Flag flipped at runtime** → applies on next app restart (§D5); documented, not a live toggle.
- **Corrupt / newer-version `settings.json`** → existing `SettingsService` read semantics (defaults on corrupt; serve-without-overwrite on unknown newer schema) apply unchanged; both resolve `phoneBridge.enabled` to `false`.

## 7. Non-goals

- No visible settings toggle or Settings UI row for the flag.
- No live (no-restart) host start/stop for the new gate.
- No change to the xbp pairing protocol, identity store, or the existing runtime `phoneBridge:setEnabled` behavior when the host is running.
- No hardening of, or change to, the separate Samantha `app.isPackaged` gate.

## 8. Files touched

| File | Change |
|------|--------|
| `shared/models/persisted-settings.ts` | Add `phoneBridge` to main + patch schemas; export `isPhoneBridgeEnabled`. |
| `services/settings/settings-service.ts` | Add the `phoneBridge` deep-merge branch to `writeState` (mirrors `usageTelemetry`). |
| `electron/main/xbp-boot.ts` *(new)* | `createXbpHostIfEnabled` seam — the sole `XbpHostService` construction site; gates construction + `start()` on the flag. |
| `electron/main/index.ts` | Read `settingsService.readStateSync().settings`; pass the constructor `options` to `createXbpHostIfEnabled` (no direct `new XbpHostService`; import the class type-only); keep `registerXbpIpc` unconditional. |
| `src/app/components/PhoneBridgeEntryButton.tsx` *(new)* | Self-gating entry button: reads `useSettings()`; renders the button or `null`. |
| `src/app/components/PhoneBridgeDialogGate.tsx` *(new)* | Self-gating dialog wrapper: reads `useSettings()`; renders `PhoneBridgeDialog` or `null`. |
| `src/app/components/MainColumnChrome.tsx` | Render `<PhoneBridgeEntryButton onOpen={onOpenPhoneBridge} />` in place of the inline button (`onOpenPhoneBridge` prop unchanged). |
| `src/app/App.tsx` | Swap the raw `PhoneBridgeDialog` render for `<PhoneBridgeDialogGate>`; no flag logic in App. |
| Tests | Schema, predicate, settings deep-merge, settings-seeded renderer gates (button + dialog), and the **required** `createXbpHostIfEnabled` main-gate test (disabled ⇒ no construction / no LAN listener). |
