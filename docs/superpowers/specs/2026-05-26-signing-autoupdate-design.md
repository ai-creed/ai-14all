# Code Signing, Notarization & Auto-Update — Design

Date: 2026-05-26
Status: Approved (pending implementation plan)
Scope: macOS (arm64) desktop app `ai-14all`

## Goal

Now that an Apple Developer account is available, ship a properly signed +
notarized macOS build and replace the current notify-only update flow with a
real auto-updater (electron-updater) that downloads in the background and
prompts the user to restart to install.

## Decisions

| Topic            | Decision                                                                 |
| ---------------- | ------------------------------------------------------------------------ |
| Update UX        | Full electron-updater; background download; **prompt to restart**        |
| Update feed      | `github` provider → `ai-creed/ai-14all` Releases (public repo, no token)  |
| Binary hosting   | GitHub Releases; updater reads GitHub's **native** zip-shaped manifest    |
| Website/notify   | ai-creed.dev dmg-manifest + website flow kept for humans (decoupled)      |
| Notarization     | App Store Connect **API key** (.p8 + Key ID + Issuer ID)                 |
| Signing identity | Developer ID Application cert (.p12)                                      |
| Signing scope    | **CI + local** (CI is the release path; local for testing signed builds) |
| Channel          | **Stable only** auto-updates; beta stays notify/manual                   |
| Platform/arch    | macOS arm64 only (unchanged)                                             |

## Current State (baseline)

- `electron-builder.yml`: builds DMG + ZIP (arm64), `--publish never`. No
  signing, no notarization, no hardened runtime.
- Updates are **notify-only**: `electron/main/services/update-notifier.ts`
  fetches `latest-mac.yml` from `ai-creed.dev`, compares versions via
  `shared/update/semver.ts`, and fires an `update:available` IPC event. No
  download/install.
- Release CI (`.github/workflows/release.yml`) already builds, validates and
  rewrites `latest-mac.yml` (sha512 present), publishes the manifest to
  `ai-creed.dev`, and creates a GitHub Release with the dmg + zip.
- `afterPack` (`scripts/electron-builder-after-pack.mjs`) chmods the node-pty
  `spawn-helper`; runs **before** code signing, so it stays compatible.

## 1. Signing + Notarization

### electron-builder.yml `mac` additions

```yaml
mac:
  hardenedRuntime: true
  gatekeeperAssess: false
  notarize: true # electron-builder v26 → notarytool
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
```

### New `build/entitlements.mac.plist`

Required for Electron + node-pty under hardened runtime:

- `com.apple.security.cs.allow-jit`
- `com.apple.security.cs.allow-unsigned-executable-memory`
- `com.apple.security.cs.allow-dyld-environment-variables`
- `com.apple.security.cs.disable-library-validation`
- `com.apple.security.inherit`

### Credentials (env vars consumed by electron-builder)

- Signing cert: `CSC_LINK` (base64 of Developer ID Application .p12),
  `CSC_KEY_PASSWORD`.
- Notarize (API key): `APPLE_API_KEY` (path to the .p8 file),
  `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`.

When these are present electron-builder auto-signs and notarizes; when absent
(plain `package:mac`) it builds unsigned for fast dev iteration.

### node-pty note

`afterPack` chmod of `spawn-helper` runs before signing → safe. electron-builder
signs the nested `spawn-helper` with the inherit entitlements. Keep the existing
afterPack hook unchanged. Terminal-still-works is the main hardened-runtime risk
and must be smoke-tested manually.

## 2. Auto-Updater (electron-updater)

- Add dependency `electron-updater`.
- Add `publish` to electron-builder.yml so `app-update.yml` is baked into the
  app with the GitHub feed:

```yaml
publish:
  provider: github
  owner: ai-creed
  repo: ai-14all
```

- The updater reads the **native** `latest-mac.yml` electron-builder emits
  (relative URLs, `path` = the ZIP) directly from the GitHub Release, and
  downloads the ZIP from the same release. Repo is public → no token at runtime.
- **No** `rewrite-manifest` in the update path. The existing
  `rewrite-manifest.ts` + ai-creed.dev publish flow stays **only** for the
  human-facing website/notify manifest (which points `path` at the DMG). The two
  consumers read separate manifests, so the dmg-vs-zip conflict disappears.

### Why not generic + ai-creed.dev (rejected)

The raw generated manifest is zip-shaped (`path` = ZIP, relative URLs,
top-level `sha512` = ZIP). The published ai-creed.dev manifest is deliberately
rewritten to point `path` at the **DMG** for human downloads. Serving one
manifest to both the website and electron-updater would require reworking
`rewrite-manifest` or maintaining a second manifest. Since the repo is public,
the github provider avoids all of that.

### Main process (rework `update-notifier.ts` → `update-service.ts`)

- Initialize the updater only when `isStableVersion(currentVersion)` is true
  (preserves the stable-only guard); skip entirely for beta builds.
- `autoUpdater.autoDownload = true`, `autoUpdater.autoInstallOnAppQuit = true`.
- Event → IPC mapping:
  - `update-available` → reuse existing `update:available` IPC (optional
    "downloading" indicator).
  - `update-downloaded` → new `update:downloaded` IPC → renderer shows
    **"Update ready — Restart now / Later"**.
  - `error` → `update:error` IPC; log and stay silent to the user.
- New renderer→main IPC `update:install` → `autoUpdater.quitAndInstall()`.
  "Later" is a no-op; install applies on next natural quit.
- Dev: updater disabled when `!isPackaged` (keep current behavior). Preserve the
  existing e2e env hooks by simulating an `update-downloaded` event so the
  restart UI is testable without real network/signing.

Reuse `shared/update/semver.ts` and the existing IPC/UI plumbing.

## 3. CI Changes (`.github/workflows/release.yml`)

New GitHub repo secrets:

- `MAC_CSC_LINK` — base64 of the Developer ID Application .p12
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_API_KEY_P8` — contents of the .p8 key
- `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`

In the "Package DMG + ZIP" step: write `APPLE_API_KEY_P8` to a temp `.p8` file,
export `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (path), `APPLE_API_KEY_ID`,
`APPLE_API_ISSUER`, `APPLE_TEAM_ID`. electron-builder then signs + notarizes.
Keep `--publish never`; `publish` config still bakes `app-update.yml` into the
app. The ai-creed.dev manifest steps (validate → rewrite → publish) stay
unchanged for the website.

**New CI requirement for github-provider:** the GitHub Release must also carry
the **native, un-rewritten** `release/latest-mac.yml` (zip-shaped) so
electron-updater can read it. Add `release/latest-mac.yml` to the
`gh release create` / `gh release upload` asset list (alongside the dmg + zip).
The rewritten `latest-mac.published.yml` is NOT uploaded to the release — it
only goes to ai-creed.dev.

Add a post-package verification gate: `codesign --verify --deep --strict` and
`spctl --assess` on the .app/.dmg; fail CI if not accepted. Notarization adds
several minutes → raise `timeout-minutes` from 30 to ~45.

## 4. Local Signing

- `.env.local` (gitignored) holds the same vars pointing at local `.p8` / `.p12`.
- New script `package:mac:signed` loads `.env.local`, then runs build +
  electron-builder with no `--publish`.
- Keep `package:mac` unsigned for fast dev iteration.
- Add a `docs/` signing runbook: how to create/export the cert and API key, and
  how to populate `.env.local`.

## 5. Testing

- **Unit (vitest):** keep `decideUpdateAction` / semver tests. Add tests for the
  new event→IPC mapping (mock `autoUpdater`): `update-downloaded` →
  `update:downloaded`, `error` → silent log, stable-guard skips init on beta.
- **E2E (playwright):** keep the env-forced path; simulate `update-downloaded`
  so the "Restart now / Later" UI renders and "Restart now" triggers
  `update:install`. No real network/signing in e2e.
- **CI gate:** `codesign --verify` + `spctl` assess = the real signing proof.
- **Manual end-to-end:** install vN, publish vN+1, confirm the app self-updates;
  verify the terminal (node-pty) works in the signed/notarized build.

## Edge Cases

- Manifest reachable but ZIP 404 / sha512 mismatch → `error` event, no crash,
  silent to user.
- Beta (non-stable) build → updater never initializes.
- Offline / feed timeout → silent; app behaves normally.
- User clicks "Later" → no mid-session install; installs on quit.
- Notarization fails in CI → gate blocks the release (no half-signed publish).
- node-pty terminal under hardened runtime → must work (manual smoke; main risk).

## Files Touched

- `electron-builder.yml`
- `build/entitlements.mac.plist` (new)
- `electron/main/services/update-notifier.ts` → `update-service.ts`
- renderer update UI + IPC contracts (`shared/contracts/commands.ts`)
- `.github/workflows/release.yml`
- `package.json` (add `electron-updater`, add `package:mac:signed`)
- `docs/` signing runbook (new)

> 3 files → the implementation plan will split this into discrete tasks.

## Sequencing Note

Gather the three Apple-side assets now (Developer ID Application .p12, App Store
Connect .p8 + Key ID + Issuer ID, Team ID). Inject GitHub secrets and populate
`.env.local` when the CI/local-signing task lands, so secret names match the
spec exactly.
