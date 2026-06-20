# Windows Distribution

ai-14all ships to Windows as an **unsigned** NSIS installer plus a portable
zip, distributed through **GitHub Releases**, with silent auto-update for x64.
This is a soft-launch channel for early/technical adopters. Code signing,
winget, the Microsoft Store, and arm64 auto-update are deferred (see "Deferred").

## What ships, per arch

| Arch  | Assets in the Release                                            | Auto-update            |
| ----- | --------------------------------------------------------------- | ---------------------- |
| x64   | `ai-14all-<ver>-x64-Setup.exe` (+ `.blockmap`), `latest.yml`, zip | Silent (electron-updater) |
| arm64 | zip only                                                        | Manual re-download     |

x64 owns the single Windows `latest.yml` channel. The app's updater is gated
off on Windows arm64 (`startUpdateService`), so arm64 builds never try to
install the x64 package; arm64 users update by downloading the newer zip.

## Installing (end users)

Download the `*-Setup.exe` (x64) or the zip from the latest GitHub Release.
Because the build is not yet code-signed, Windows SmartScreen may warn on first
run:

> **Windows protected your PC.** Click **More info → Run anyway**.

This is expected for an unsigned build and goes away once signing is added.

## Auto-update (x64)

A stable, installed x64 build polls the latest GitHub Release, compares its
version against `latest.yml`, downloads in the background (verified by the
`sha512` in `latest.yml` — no Authenticode signature required on Windows), and
prompts to restart into the new version.

## Cutting a release

Push a stable tag `vX.Y.Z` (no prerelease suffix). Two workflows fire on the
same tag shape (`v*.*.*`, excluding `!v*-*`) and converge on one GitHub Release:

- `release.yml` (macOS) — signs/notarizes, creates the Release, publishes
  `latest-mac.yml` to the ai-creed site.
- `release-windows.yml` — builds x64 + arm64 on native runners and uploads the
  Windows assets additively (`gh release upload --clobber`), never touching the
  mac assets or `latest-mac.yml`.

`release-windows.yml` self-verifies on every run: on the Windows x64 runner it
asserts the installer + `.blockmap` + `latest.yml` (referencing the installer) +
zip, then silently installs the build and confirms the app launches. Dry-run it
any time via **workflow_dispatch** (`version: vX.Y.Z`) — a green run is the gate;
the upload step is skipped unless the trigger is a tag push.

> The only acceptance step CI cannot reproduce is the **SmartScreen
> click-through**: that prompt is a Mark-of-the-Web reputation gate shown only to
> end users who download the unsigned file from the internet, so locally built
> CI artifacts never trigger it. It disappears once the build is signed.

## Deferred

- **Code signing** — Azure Trusted Signing later (removes SmartScreen, unlocks
  winget); additive to `release-windows.yml`.
- **winget** — submit a manifest once signed.
- **Microsoft Store / MSIX** — skipped (sandbox is hostile to spawning PTYs and
  shelling out to `git`/agent CLIs).
- **arm64 auto-update** — needs a merged manifest or per-arch channel.
- **ai-creed download-page automation** — mirror the mac site-publish step for
  Windows links (currently manual).
- **ai-whisper on Windows** — stays gated off.
