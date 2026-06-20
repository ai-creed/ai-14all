# Windows Distribution — Phase 2 Design (unsigned NSIS + auto-update)

- **Date:** 2026-06-20
- **Project:** ai-14all (Electron, v0.9.3)
- **Branch:** `feat/windows-build-phase1`
- **Status:** Design approved (decisions captured below); pending implementation plan
- **Author:** Vu Phan (with Claude)
- **Predecessor:** `2026-06-19-windows-build-phase1-design.md` (got a working win-arm64/x64 build + runtime fixes). This phase turns that build into a distributable channel.

## 1. Background & Goal

Phase 1 produced working, unsigned Windows builds (x64 + arm64 zips via the `build-windows` CI matrix) and fixed the Windows-specific runtime bugs. What's missing is a **distribution channel**: an installer users can run, an update path so they stay current, and a place to download it.

**Goal:** ship ai-14all to Windows users as an **unsigned NSIS installer** distributed via **GitHub Releases**, with **silent auto-update** through the app's existing `electron-updater`. Code signing is deliberately deferred ("ship unsigned now, sign later"). This is a soft-launch channel aimed at early/technical adopters.

## 2. Key Decisions (made 2026-06-20)

- **Format:** NSIS installer (per-user, one-click, no admin) **+** keep the portable zip as a no-install fallback.
- **Channel:** GitHub Releases is the source of truth. A download page on ai-creed.dev links to it with a SmartScreen "More info → Run anyway" note. **winget deferred** (prefers signed installers). **Microsoft Store / MSIX skipped** — its sandbox is hostile to a tool that spawns PTYs and shells out to `git`/agent CLIs.
- **Auto-update:** reuse the app's existing `electron-updater`. **It works unsigned on Windows** (verifies the download via the `sha512` in `latest.yml`, not an Authenticode signature — unlike mac, where auto-update requires signing). The updater (`electron/main/index.ts` → `startUpdateService`) is already platform-agnostic, stable-channel only, and disabled in dev, so **Windows auto-update needs zero app-code change**.
- **Signing:** **deferred.** Users click through SmartScreen initially. When added, prefer **Azure Trusted Signing** (~$10/mo, CI-native, no hardware token, builds SmartScreen reputation) over a traditional EV/OV cert; it is additive to this pipeline, so nothing built here is throwaway.
- **Pipeline structure:** a **separate** `release-windows.yml`, NOT changes to `release.yml`. The mac `release.yml` is the authoritative signed/notarized pipeline and must not break; a separate workflow uploading to the same GitHub Release keeps the blast radius minimal.
- **Arch:** **x64 is the auto-update channel** (typical PCs). arm64 ships as a manual download in the same Release; arm64 silent auto-update is a future item (see §7).
- **ai-whisper on Windows:** stays gated off (Phase-1 commit `5e9a453`); out of scope here.

## 3. Grounding Facts (verified against the repo, 2026-06-20)

These shape the design and were checked rather than assumed:

- The app's `electron-builder.yml` sets `publish: { provider: github, owner: ai-creed, repo: ai-14all }`. electron-updater therefore reads the update feed **directly from the GitHub Release** — `latest.yml` plus the installer assets. The **essential** Windows deliverable is uploading `latest.yml` + `*-Setup.exe` + `*.exe.blockmap` to the Release.
- electron-builder emits the Windows update manifest as **`latest.yml`** (mac is `latest-mac.yml`, linux `latest-linux.yml`). **No filename collision** when both land in the same Release.
- `scripts/rewrite-manifest.ts` / `shared/update/rewrite-manifest.ts` is **mac-specific**: it hardcodes a `.dmg` lookup and throws "no .dmg file entry" otherwise. Windows **does not reuse it** and does not need it — the GitHub provider resolves asset URLs from the Release. (The mac site-publish/rewrite is a mac-only extra for the website download page, not an auto-update requirement.)
- `release.yml` is tag-triggered (`v*.*.*`), runs on `macos-14`, creates-or-updates the GitHub Release, then publishes the rewritten `latest-mac.yml` to the ai-creed site. `release-windows.yml` will attach to the **same** Release the mac job creates.
- The `build-windows` matrix already proves both arches compile + package (native modules from source) and pass the afterPack guards on Windows runners (`windows-latest` x64, `windows-11-arm` arm64).

## 4. Scope

**In scope (Phase 2):**
- NSIS installer target in `electron-builder.yml` (per-user, one-click), keeping the zip.
- A separate tag-triggered `release-windows.yml` that builds and uploads the Windows assets (x64 NSIS `*-Setup.exe` + `.blockmap` + `latest.yml`; x64 + arm64 zips) to the GitHub Release.
- Documentation of the channel + the SmartScreen note for the download page.

**Out of scope (deferred):**
- Code signing (Azure Trusted Signing or EV/OV cert) — future phase.
- winget manifest submission.
- Microsoft Store / MSIX.
- arm64 silent auto-update (arm64 is manual download in Phase 2).
- Automating the ai-creed download-page/manifest publish (the page edit is site-repo work; can be added later mirroring the mac step, but is not required for auto-update).
- ai-whisper Windows support.

## 5. Acceptance Criteria

- `electron-builder --win nsis zip --x64` produces `ai-14all-<ver>-x64-Setup.exe`, `ai-14all-<ver>-x64-Setup.exe.blockmap`, `latest.yml`, and the zip; afterPack guards pass.
- On a tag push, `release-windows.yml` uploads those x64 assets (+ the arm64 zip) to the **same** GitHub Release as the mac artifacts, without disturbing the mac assets or `latest-mac.yml`.
- A user can download and run the NSIS installer on a clean Windows x64 machine (clicking through SmartScreen), and the app launches.
- **Auto-update round-trip (the core acceptance):** an installed older stable build, pointed at a Release containing a newer `latest.yml`, silently downloads and prompts to restart into the new version — unsigned. (Verify with two stable test tags, or the existing `AI14ALL_E2E_UPDATE_DOWNLOADED` harness for the UI path.)
- **macOS regression gate stays green** and the mac `release.yml` is unchanged: `pnpm lint && pnpm format && pnpm typecheck && pnpm test`.

## 6. Design

### 6.1 `electron-builder.yml` — NSIS target (additive)

Add `nsis` alongside the existing `zip` in the `win:` target; do not pin arch (CI passes `--x64` / `--arm64`). NSIS config: `oneClick: true`, `perMachine: false` (per-user, no admin prompt). The `mac:` block is untouched.

```yaml
win:
  target:
    - target: nsis
    - target: zip
nsis:
  oneClick: true
  perMachine: false
  # artifactName left at electron-builder default so latest.yml + .blockmap
  # naming stays consistent with what electron-updater expects.
```

### 6.2 `.github/workflows/release-windows.yml` (new, separate)

- Trigger: `push: tags: ['v*.*.*']` (+ `workflow_dispatch` with a version input for smoke runs), matching `release.yml`'s tag shape.
- Matrix: `windows-latest` (x64), `windows-11-arm` (arm64) — same runners as `build-windows.yml`.
- Steps mirror `build-windows.yml` (Node 24, corepack, Python, `pnpm install --frozen-lockfile`, `electron-rebuild` better-sqlite3 for the arch), then:
  - x64 job: `pnpm build` → `electron-builder --win nsis zip --x64 --publish never` → uploads `*-Setup.exe`, `*.exe.blockmap`, `latest.yml`, `*.zip`.
  - arm64 job: `electron-builder --win zip --arm64 --publish never` → uploads the arm64 `*.zip` only (no auto-update manifest in Phase 2).
- Upload to the Release with `gh release upload "v<ver>" <files> --clobber`. Idempotent and additive — touches only the named Windows files, never the mac assets or `latest-mac.yml`.
- **Coordination with the mac job:** the mac `release.yml` runs `gh release create` (or upload `--clobber` if it exists). To avoid a race where Windows uploads before the Release exists, the Windows job will `gh release create "$tag" --notes ... || true` first (idempotent no-op if the mac job already created it), then upload. Both pipelines converge on one Release.

### 6.3 Auto-update — no app change

electron-updater (`provider: github`) on the installed app polls the latest GitHub Release for `latest.yml`, compares versions, and (stable-only, per `startUpdateService`) background-downloads + prompts to restart. Because the x64 `latest.yml` + `*-Setup.exe` + `.blockmap` are in the Release, this works with **no code change** and **without signing**. arm64 users update by re-downloading the zip until §7 lands.

### 6.4 Download page (ai-creed.dev) — documented, automation deferred

The download page gets Windows links (the NSIS `*-Setup.exe` for x64, zips for both arches) and a short note: "Windows may show a SmartScreen warning because the build isn't code-signed yet — click **More info → Run anyway**." Editing the ai-creed site repo is separate work (mirrors the mac `release.yml` site step); Phase 2 documents the copy and links, and leaves automation as a follow-up.

## 7. Risks & Open Items

- **Multi-arch `latest.yml`.** x64 and arm64 build on separate runners, each emitting its own `latest.yml`; a single GitHub Release can hold only one `latest.yml` for the `github` provider. **Resolution:** x64 owns `latest.yml` (auto-update channel); arm64 is manual download. A future merged-manifest or per-arch channel enables arm64 auto-update — flagged, not built.
- **NSIS artifact naming vs electron-updater.** Keep electron-builder's default `artifactName` so `latest.yml`'s referenced installer + `.blockmap` names match what the client resolves; verify the emitted `latest.yml` against the uploaded asset names before relying on a tag.
- **Unsigned SmartScreen friction.** Expected and accepted for the soft launch; the download-page note mitigates. Azure Trusted Signing removes it later.
- **Release-job race.** Mitigated by the idempotent `gh release create || true` then `--clobber` upload (§6.2).
- **Cross-check before first real tag.** Per project rule, dry-run `release-windows.yml` via `workflow_dispatch` against a test version and confirm the emitted/ uploaded asset set + `latest.yml` contents before cutting a real release tag.

## 8. Task Breakdown (phased; >3 files so decomposed)

1. **NSIS target** — add `nsis` + `nsis:` config to `electron-builder.yml` (keep zip; mac untouched). Verify locally/CI that a win build emits the installer + `latest.yml` + `.blockmap`.
2. **Release workflow** — add `release-windows.yml` (tag-triggered matrix; x64 NSIS+zip+manifest, arm64 zip; idempotent upload to the shared Release). Dry-run via `workflow_dispatch`.
3. **Docs** — record the strategy + SmartScreen download-page copy (here and/or `docs/windows-distribution.md`); note the deferred site-automation + signing follow-ups.
4. **Verification** — macOS regression gate green; auto-update round-trip validated (two test tags or the E2E hook); confirm `release.yml`/mac assets untouched.

## 9. Future Phases (not now)

- **Code signing:** Azure Trusted Signing in `release-windows.yml` (additive env + electron-builder config); removes SmartScreen and unlocks winget.
- **winget:** submit a manifest to `winget-pkgs` once signed.
- **arm64 auto-update:** merged manifest or a per-arch channel.
- **Download-page automation:** mirror the mac site-publish step for Windows links.
