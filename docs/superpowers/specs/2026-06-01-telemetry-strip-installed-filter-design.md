# Telemetry strip — show only installed providers

**Date:** 2026-06-01
**Branch:** UI-overhaul
**Status:** Design — awaiting review

## Goal

In the app-bar token-telemetry strip (`UsageStrip`), show a provider's row
(claude / codex) **only when that agent's CLI is installed**. Declutters the
strip for users who only run one agent. Scope: **strip only** — the dropdown
(`UsagePopover`) stays the full details view, unchanged.

## Data source

`App.tsx` already instantiates `agentInstallStatus = useAgentInstallStatus()`
(`App.tsx:358`). Its `providers: Provider[]` each carry
`{ id: "claude-code" | "codex", installed: boolean, ... }`. The backend
`agentInstall.listProviders()` always returns both providers (with their
`installed` flags) once it resolves; before that, `providers` is `[]`.

Telemetry providers (`UsageProvider = "claude" | "codex"`, in
`shared/models/usage.ts`) map to install ids: `claude` ↔ `claude-code`,
`codex` ↔ `codex`.

## Design

### Derive in App.tsx
```ts
const installedProviders: UsageProvider[] | null =
  agentInstallStatus.providers.length === 0
    ? null // not loaded yet → show all (avoids a blank flash)
    : agentInstallStatus.providers
        .filter((p) => p.installed)
        .map((p) => (p.id === "claude-code" ? "claude" : "codex"));
```
`null` is the explicit "unknown / not yet loaded" sentinel (distinct from `[]`
= "loaded, none installed").

### Thread through AppBar → UsageStrip
- `AppBar` gains an optional prop `installedProviders?: UsageProvider[] | null`
  and passes it straight into the `<UsageStrip … />` it renders.
- `App.tsx` passes the derived value to `<AppBar installedProviders={…} />`.

### Filter in UsageStrip
New optional prop `installedProviders?: UsageProvider[] | null`. Replace the
unconditional `ORDER.map(...)` with:
```ts
const visible =
  installedProviders == null
    ? ORDER
    : ORDER.filter((p) => installedProviders.includes(p));
```
Render `visible.map(...)`. A provider's row (name · ↑/↓ tokens · 5h · wk
gauges) renders only when visible.

## Behavior

- **Before load** (`installedProviders == null`): show both providers
  (current behavior) — no blank flash; rows then settle once status resolves.
- **One installed**: only that provider's row shows.
- **Neither installed** (`[]`): no provider rows; the `▾` caret still renders
  so the full dropdown remains reachable. (Rare; acceptable.)
- The center-positioned `usage` and the dropdown are otherwise unchanged.

## Testing

There is no existing `UsageStrip` unit test (only `usage-popover.test.tsx`),
so **create** `tests/unit/usage/usage-strip.test.tsx` (modeled on
`usage-popover.test.tsx` — render `<UsageStrip>` with a minimal `UsageSnapshot`
fixture). Assert:
- `installedProviders={["codex"]}` → the codex provider row renders, the claude
  row does not.
- prop omitted / `null` → both provider rows render (pre-load / back-compat).
The whole suite (incl. `usage-popover.test.tsx`) must stay green.

## Files

- `src/features/telemetry/UsageStrip.tsx` — add prop + filter.
- `src/app/components/AppBar.tsx` — pass-through prop.
- `src/app/App.tsx` — derive `installedProviders`, pass to `<AppBar>`.
- `tests/unit/usage/usage-strip.test.tsx` — **new** test for the filter cases.

## Out of scope

- The dropdown (`UsagePopover`) / `LimitCard` / breakdown rows — unchanged.
- Any change to install detection, the `useAgentInstallStatus` hook, or the
  `agentInstall` IPC.
- Re-fetching install status (reuse App's existing instance; do not call the
  hook again inside the strip).
