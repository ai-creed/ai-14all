# Mac Intel Support — Universal + arm64 Build

**Date:** 2026-06-29
**Status:** Design approved (brainstorm), pending implementation plan
**Author:** Vu + Claude (brainstorm session)
**Resolves:** [ai-creed/ai-14all#9](https://github.com/ai-creed/ai-14all/issues/9) — "Apple Silicon (arm64) only — no Intel build"

---

## 1. Problem

The app ships an **arm64-only** macOS build (`electron-builder.yml` `mac.target` is `arm64` for both `zip` and `dmg`). Intel (x86_64) Macs cannot run it. Issue #9 was closed as "not supported" and reopened to gauge demand; users have asked for it, so we are adding Intel support.

## 2. Goal

Ship a macOS release that runs on **both** Intel and Apple Silicon, **without** regressing the existing arm64 build, signing/notarization, auto-update, or the manifest-publish pipeline.

## 3. Decisions (from brainstorm)

1. **Ship a universal binary AND keep a native arm64 build** — let users choose. The universal artifact runs on both chips (its arm64 slice runs natively on Apple Silicon, no Rosetta); the separate `-arm64` artifact stays so Apple Silicon users can take a slim, native download.
2. **Verification bar = static slice assertion.** CI asserts the universal app binary and its bundled native modules contain both `x86_64` and `arm64` slices via `lipo -archs`. No Intel-runtime execution (we have no Intel hardware; CI runs on Apple Silicon). This proves the x64 slice is *present and ABI-correct*, not that it *boots* on real Intel silicon — see §9 Risks.
3. **Single `electron-builder` run, single `latest-mac.yml`.** Both arches are built in one packaging invocation so both zips land in one auto-update manifest (required for the arch-aware updater — see §6).

## 4. Architecture overview

```
electron-builder.yml  mac.target arch: [arm64, universal]
        │
        ▼
release.yml (macos-14 / Apple Silicon runner)
  1. rebuild native deps (better-sqlite3, node-pty) for BOTH arches @ Electron ABI
  2. electron-builder --mac  → emits:
        ai-14all-<ver>-arm64.dmg       ai-14all-<ver>-arm64-mac.zip
        ai-14all-<ver>-universal.dmg   ai-14all-<ver>-universal-mac.zip
        latest-mac.yml (files[] lists BOTH zips + dmgs + blockmaps)
        (afterPack guards run per arch: ABI + dependency-closure)
  3. NEW slice gate: assert-universal-slices.mjs
        universal .app + native modules  → must be fat (x86_64 + arm64)
        arm64 .app                       → must be arm64
  4. sign + notarize (one pass per artifact) + verify ALL apps/dmgs
  5. rewrite + publish latest-mac.yml to ai-creed; upload all assets
```

## 5. Component changes

### 5.1 `electron-builder.yml`
Change `mac.target` so each target builds both arches:

```yaml
mac:
  target:
    - target: zip
      arch: [arm64, universal]
    - target: dmg
      arch: [arm64, universal]
```

electron-builder builds the arm64 and x64 apps, `@electron/universal` `lipo`-merges the x64+arm64 apps into the universal `.app`, and also emits the standalone arm64 `.app`. `buildDependenciesFromSource: true` stays; it rebuilds native deps from source per arch sub-pass.

> **Verify during implementation, do not assume:** our native modules are `asarUnpack`'d (`node-pty`) and live under `app.asar.unpacked`. `@electron/universal` lipo-merges Mach-O files present in both arch builds (`better_sqlite3.node`, `pty.node`, `spawn-helper` are all Mach-O, so they are lipo-able), but the universal merge of an app that mixes an `asar` with arch-specific `asar.unpacked` content can require explicit electron-builder config (`mac.mergeASARs`, `singleArchFiles`, or `x64ArchFiles`). If the first universal build fails the merge, that config is the fix — the §5.4 slice gate is exactly what surfaces a bad/thin merge as a hard failure rather than a silent ship.

### 5.2 Native-dependency rebuild (in `release.yml`)
`better-sqlite3` and `node-pty` are native modules compiled against Electron's ABI. The existing single-arch pre-rebuild step (`electron-rebuild -f -w better-sqlite3`, arm64 only) must produce **both** arch binaries, or be reconciled with electron-builder's per-arch source rebuild. Concretely: run the Electron rebuild for `--arch x64` and `--arch arm64` before packaging (defeating the host-ABI cache-hit documented in the better-sqlite3 ABI gotcha). The macos-14 (Apple Silicon) Xcode toolchain cross-compiles the x64 slice. The §5.4 slice gate is the safety net that catches any arch that failed to build.

### 5.3 CI slice gate — `scripts/ci/assert-universal-slices.mjs` (new)
Mirrors the existing `scripts/ci/windows-x64-acceptance.ps1` pattern (a native acceptance gate, no human). Locates the packaged `.app`(s) under `release/` and asserts, via `lipo -archs`:

- **Universal `.app`:** the main executable AND every bundled native binary
  (`better_sqlite3.node`, node-pty `pty.node`, `spawn-helper`) are **fat**:
  contain both `x86_64` and `arm64`.
- **arm64 `.app`:** the same binaries contain `arm64`.

Fails the build (non-zero exit) on any missing slice or missing binary. The existing `afterPack` guards (better-sqlite3 `NODE_MODULE_VERSION` ABI guard, dependency-closure guard) are unchanged and continue to run per arch.

> Note: the `afterPack` ABI guard is **arch-blind** — it reads `NODE_MODULE_VERSION` from the binary, which is identical across CPU arches. The new slice gate is what verifies CPU slices are present; the two are complementary.

### 5.4 Signing / notarization / verification (in `release.yml`)
- Signing a universal `.app` signs both slices in one `codesign` pass; notarization is one submission per artifact. `electron-builder` `notarize: true` and `scripts/sign-notarize-dmg.mjs` work unchanged.
- The **"Verify signature & notarization"** step currently uses `find … | head -1`, verifying only one `.app` and one `.dmg`. It must verify **every** produced `.app` and `.dmg` (both arches), or the second artifact ships unverified.

### 5.5 Manifest rewrite — `shared/update/rewrite-manifest.ts`
`rewriteManifest` already maps over all `files[]`, so both zips and both dmgs survive the rewrite ✅. It **intentionally swaps the top-level `path`/`sha512` to the DMG** (verified: `tests/unit/update/rewrite-manifest.test.ts` — *"swaps path to the DMG"*), while electron-builder's emitted top-level `path` is the arm64 zip. One change: that swap currently picks the **first** `.dmg` found, which becomes order-dependent with two dmgs. Make it **deterministic** — prefer the **universal** dmg. (For electron-updater 6.8.3 this top-level field is only a legacy fallback; the arch-filtered zip from `files[]` is what mac auto-update actually downloads — verified `MacUpdater.js:77` `findFile(files, "zip", ["pkg","dmg"])` — so this is a cleanliness fix, not a correctness fix.) Update `rewrite-manifest.test.ts` accordingly to cover a two-dmg manifest.

### 5.6 Publish + Release upload (in `release.yml`)
- Upload **both** dmgs and **both** zips (plus mac `.blockmap`s if emitted) to the GitHub Release. The current globs (`release/*.dmg release/*.zip`) already match multiple files; confirm blockmaps are included if differential download is desired.
- The ai-creed `.mdx` download section currently hardcodes the `-arm64.dmg` link. Update it to expose the **universal** dmg as the default (works everywhere) and the **arm64** dmg as a secondary "Apple Silicon (native)" link. The `release.yml` `sed` rewrite of the `.mdx` must be updated accordingly.

## 6. Auto-updater behavior (verified)

Verified against the bundled `electron-updater@6.8.3` source (`MacUpdater.js:57-80`). The mac updater is **arch-aware**:

1. Detects Apple Silicon via `uname` (`ARM`), `process.arch === 'arm64'`, or Rosetta (`sysctl sysctl.proc_translated`).
2. Classifies each update file by whether its **filename contains `arm64`**.
3. Selects:
   - **Apple Silicon** and an `arm64`-named file exists → keep **only** the `arm64` file.
   - **Otherwise (Intel)** → keep **only** files **without** `arm64` in the name.
4. From the survivors, `findFile(files, "zip", ["pkg","dmg"])` picks the `.zip`.

With both `…-arm64-mac.zip` and `…-universal-mac.zip` in one `latest-mac.yml`:

| Machine | Auto-update picks | Outcome |
| --- | --- | --- |
| Apple Silicon | `…-arm64-mac.zip` | native arm64, slim download |
| Intel | `…-universal-mac.zip` | universal (x86_64 slice) |

**Invariants this relies on (must not break):**
- Both arches are built in **one** `electron-builder` run → one `latest-mac.yml` with both zips in `files[]`.
- The arm64 artifact's filename **contains** `arm64`; the universal artifact's filename does **not** contain `arm64`. electron-builder defaults satisfy this; do not rename to violate it.
- The manifest rewrite preserves all `files[]` entries (it does).

**Migration:** existing arm64 installs see the new version in `latest-mac.yml` and (being Apple Silicon) continue to pull the `-arm64` zip — no disruption. New Intel users install the universal dmg manually, then auto-update to the universal zip thereafter.

## 7. Testing

- **Unit (TDD)** for `assert-universal-slices.mjs`: inject a fake `lipo` runner.
  - fat binary (both slices) → pass.
  - missing `x86_64` slice on a universal binary → fail with a clear message.
  - missing binary on disk → fail.
  - arm64 artifact with arm64 slice → pass.
- **Existing** `electron-builder-after-pack` unit tests stay green (no behavior change there).
- **Manifest:** add/extend a `rewrite-manifest` unit test asserting both zips survive and the top-level pointer is the universal dmg.
- **CI integration:** the slice gate runs in `release.yml` on every release build (and any release-smoke `workflow_dispatch`).

## 8. Edge cases

- **x64 native module silently fails to cross-compile** → caught by the slice gate (universal `.node` would be thin arm64). Hard fail, no ship.
- **Two dmgs → nondeterministic top-level manifest pointer** → fixed by §5.5 (deterministic universal pick).
- **Verify step only checks one artifact** → fixed by §5.4 (verify all).
- **arm64 user on a universal-only manifest** would bloat to 2× download → avoided by keeping the native arm64 zip (§3.1).
- **Intel Mac under no-Rosetta** → universal's x86_64 slice runs natively; no Rosetta needed.
- **Download size** of the universal artifact is ~2× arm64; acceptable and documented; arm64 users avoid it via the native zip.

## 9. Risks

- **Static gate does not prove the x64 slice boots on real Intel silicon** — only that it is present and ABI-correct (the chosen verification bar). Follow-up if runtime certainty is wanted: a manual Intel smoke test (or a beta tester) before promoting a stable release.
- **Cross-compiling x64 native deps on an Apple Silicon runner** is the main implementation risk; the slice gate makes a bad build fail loudly rather than ship.

## 10. Out of scope

- Runtime Intel testing / Rosetta launch smoke in CI.
- Intel-runner (macos-13) matrix build.
- Any change to the Windows pipeline.

## 11. Files touched

| File | Change |
| --- | --- |
| `electron-builder.yml` | `mac.target` arch `[arm64, universal]` |
| `.github/workflows/release.yml` | both-arch native rebuild; slice gate step; verify-all-artifacts; mdx/manifest publish for both arches |
| `scripts/ci/assert-universal-slices.mjs` | **new** — `lipo -archs` slice assertion gate |
| `tests/unit/…assert-universal-slices…` | **new** — unit tests for the gate |
| `shared/update/rewrite-manifest.ts` | deterministic top-level pointer (universal dmg) |
| `tests/unit/…rewrite-manifest…` | extend — both zips survive, pointer is universal |
| `docs/…mac-distribution note` | short note on universal+arm64 + auto-update arch selection |
| ai-creed `.mdx` (separate repo) | expose universal (default) + arm64 (native) download links |

(>3 files → the implementation plan will decompose into reviewable slices.)
