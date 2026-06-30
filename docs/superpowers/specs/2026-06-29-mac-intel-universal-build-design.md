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
        universal .app: main exe + better_sqlite3.node → fat (x86_64 + arm64)
        universal .app: node-pty prebuilds/darwin-{x64,arm64}/{pty.node,spawn-helper}
                        → BOTH dirs present, each thin for its own arch (NOT fat)
        arm64 .app: main exe + better_sqlite3.node → arm64;
                    node-pty prebuilds/darwin-arm64/* present (arm64)
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

> **Verify during implementation, do not assume:** our native modules are `asarUnpack`'d (`node-pty`) and live under `app.asar.unpacked`. The two modules merge differently, and the slice gate (§5.3) must reflect that:
> - **`better_sqlite3.node`** sits at one fixed path (`build/Release/better_sqlite3.node`, no `prebuilds/` dir). `@electron/universal` lipo-merges the x64 and arm64 copies into one **fat** Mach-O.
> - **node-pty** loads `prebuilds/${process.platform}-${process.arch}/pty.node` at runtime (`node-pty/lib/utils.js:17`) and derives `spawn-helper` from that *selected* directory (`node-pty/lib/unixTerminal.js:27`). Its binaries therefore live under **per-arch** paths (`prebuilds/darwin-x64/...`, `prebuilds/darwin-arm64/...`), the npm package ships both committed prebuilts (each thin for its arch, byte-identical across the two arch sub-builds), and the universal merge passes them through unchanged so **both directories coexist** in the universal `.app`. They are NOT (and must not be) lipo-merged into a fat file — forcing that would break node-pty's runtime lookup.
>
> The universal merge of an app that mixes an `asar` with arch-specific `asar.unpacked` content can still require explicit electron-builder config (`mac.mergeASARs`, `singleArchFiles`, or `x64ArchFiles`) — in particular, the node-pty loader checks `build/Release/` *before* `prebuilds/`, so if a per-arch `build/Release/pty.node` is packaged at the same path in both sub-builds it would collide on merge. Ensure node-pty resolves from `prebuilds/` (the layout the existing `afterPack` guard already assumes, `scripts/electron-builder-after-pack.mjs:29-44`) so the two arch dirs stay distinct. If the first universal build fails the merge, that config is the fix — the §5.3 slice gate is exactly what surfaces a bad/thin/missing merge as a hard failure rather than a silent ship.

### 5.2 Native-dependency rebuild (in `release.yml`)
`better-sqlite3` and `node-pty` are native modules compiled against Electron's ABI. The existing single-arch pre-rebuild step (`electron-rebuild -f -w better-sqlite3`, arm64 only) must produce **both** arch binaries, or be reconciled with electron-builder's per-arch source rebuild. Concretely: run the Electron rebuild for `--arch x64` and `--arch arm64` before packaging (defeating the host-ABI cache-hit documented in the better-sqlite3 ABI gotcha). The macos-14 (Apple Silicon) Xcode toolchain cross-compiles the x64 slice. The §5.3 slice gate is the safety net that catches any arch that failed to build.

### 5.3 CI slice gate — `scripts/ci/assert-universal-slices.mjs` (new)
Mirrors the existing `scripts/ci/windows-x64-acceptance.ps1` pattern (a native acceptance gate, no human). Locates the packaged `.app`(s) under `release/` and asserts the correct slice condition **per native module's actual runtime layout** via `lipo -archs`. Two layouts coexist and must be checked **differently** — asserting "everything is fat" is wrong for node-pty:

**(a) Single-path, lipo-merged binaries** — the main Electron executable and `better_sqlite3.node` (`build/Release/better_sqlite3.node`; one fixed path, no `prebuilds/` dir). `@electron/universal` lipo-merges these across the x64 and arm64 sub-builds into one fat Mach-O. Assert:

- **Universal `.app`:** main executable AND `better_sqlite3.node` are **fat** (contain both `x86_64` and `arm64`).
- **arm64 `.app`:** the same binaries contain `arm64`.

**(b) Per-arch prebuild binaries** — node-pty. Its loader selects `prebuilds/${process.platform}-${process.arch}/` at runtime (`node-pty/lib/utils.js:17`) and derives `spawn-helper` from the *selected* directory (`node-pty/lib/unixTerminal.js:27`). The shipped prebuilds are intentionally **thin per arch** (`prebuilds/darwin-arm64/{pty.node,spawn-helper}` → `arm64`; `prebuilds/darwin-x64/{pty.node,spawn-helper}` → `x86_64`). A universal app therefore ships **both arch directories side by side** — they are NOT lipo-merged into a fat file, and must not be. Assert:

- **Universal `.app`:** BOTH `prebuilds/darwin-x64/pty.node` + `darwin-x64/spawn-helper` (each **thin `x86_64`**) AND `prebuilds/darwin-arm64/pty.node` + `darwin-arm64/spawn-helper` (each **thin `arm64`**) exist with their expected single slice.
- **arm64 `.app`:** `prebuilds/darwin-arm64/pty.node` + `darwin-arm64/spawn-helper` exist and are **`arm64`** (the npm package also ships the unused `darwin-x64` dir; the gate need not reject its presence).

> **Why node-pty differs (do not assert fat here):** node-pty never loads a fat binary — it indexes into `prebuilds/darwin-<arch>/` by `process.arch`. Requiring a *fat* `pty.node`/`spawn-helper` would either fail a valid universal package or force packaging away from node-pty's real runtime layout. The packaged path the existing `afterPack` guard already targets (`app.asar.unpacked/.../node-pty/prebuilds/darwin-${arch}/spawn-helper`, `scripts/electron-builder-after-pack.mjs:29-44`) confirms this layout; the gate's job for the universal build is to verify the **peer x64 directory** is present and correctly thin.

Fails the build (non-zero exit) on any missing slice, wrong slice, or missing binary. The existing `afterPack` guards (better-sqlite3 `NODE_MODULE_VERSION` ABI guard, dependency-closure guard, node-pty spawn-helper existence/chmod) are unchanged and continue to run per arch.

> Note: the `afterPack` ABI guard is **arch-blind** — it reads `NODE_MODULE_VERSION` from the binary, which is identical across CPU arches. The new slice gate is what verifies CPU slices are present and correctly placed; the two are complementary.

### 5.4 Signing / notarization / verification (in `release.yml`)
- Signing a universal `.app` signs both slices in one `codesign` pass; notarization is one submission per artifact. `electron-builder` `notarize: true` handles the `.app`s unchanged.
- **`scripts/sign-notarize-dmg.mjs` does NOT work unchanged** (corrected during implementation): it signs/notarizes/staples the DMG container that electron-builder leaves untouched, and its `pickDmg` helper **threw when more than one `.dmg` was present** ("refusing to guess"). With two dmgs (`-arm64.dmg` + `-universal.dmg`) that would fail the release. Fix: replace `pickDmg` with `listDmgs` (returns **all** dmgs, sorted; still throws on zero) and loop the codesign → notarytool → stapler pass over **every** dmg. The Developer ID identity is resolved once and reused. Update `tests/unit/scripts/sign-notarize-dmg.test.ts` (the old "throws when more than one .dmg" case is replaced by "returns every .dmg path" + a single-dmg back-compat case).
- The **"Verify signature & notarization"** step currently uses `find … | head -1`, verifying only one `.app` and one `.dmg`. It must verify **every** produced `.app` and `.dmg` (both arches), or the second artifact ships unverified.

### 5.5 Manifest rewrite — `shared/update/rewrite-manifest.ts`
`rewriteManifest` already maps over all `files[]`, so both zips and both dmgs survive the rewrite ✅. It **intentionally swaps the top-level `path`/`sha512` to the DMG** (verified: `tests/unit/update/rewrite-manifest.test.ts` — *"swaps path to the DMG"*), while electron-builder's emitted top-level `path` is the arm64 zip. One change: that swap currently picks the **first** `.dmg` found, which becomes order-dependent with two dmgs. Make it **deterministic** — prefer the **universal** dmg. (For electron-updater 6.8.3 this top-level field is only a legacy fallback; the arch-filtered zip from `files[]` is what mac auto-update actually downloads — verified `MacUpdater.js:77` `findFile(files, "zip", ["pkg","dmg"])` — so this is a cleanliness fix, not a correctness fix.) Update `rewrite-manifest.test.ts` accordingly to cover a two-dmg manifest.

### 5.6 Publish + Release upload (in `release.yml`)
- Upload **both** dmgs and **both** zips (plus mac `.blockmap`s if emitted) to the GitHub Release. The current globs (`release/*.dmg release/*.zip`) already match multiple files; confirm blockmaps are included if differential download is desired.
- The ai-creed `.mdx` download section currently hardcodes the `-arm64.dmg` link. Expose the **universal** dmg as the default (works everywhere) and the **arm64** dmg as a secondary "Apple Silicon (native)" link, and drop the stale "no Intel macOS" copy. **Delivery (decided during implementation): an idempotent transform `scripts/ci/ensure-ai-creed-universal-download.mjs` wired into the `release.yml` ai-creed publish step, run BEFORE the version-bump `sed`.** This makes the **first universal release** atomically rewrite the live page at the moment the universal dmg becomes downloadable — avoiding the 404 window a manual pre-release edit would open (no `-universal.dmg` exists for older arm64-only versions). The added `sed -e` rule for `-universal.dmg` then keeps both links version-pinned on every subsequent release. The transform is unit-tested and idempotent (a no-op once applied).

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

- **Unit (TDD)** for `assert-universal-slices.mjs`: inject a fake `lipo` runner and a fake filesystem layout.
  - *Single-path binaries (main executable, `better_sqlite3.node`):*
    - universal build → fat (both `x86_64` + `arm64`) → pass.
    - universal build with a thin (arm64-only) `better_sqlite3.node` → fail with a clear "missing x86_64 slice" message.
    - arm64 build → arm64 → pass.
    - binary missing on disk → fail.
  - *node-pty per-arch prebuilds:*
    - universal build with BOTH `prebuilds/darwin-x64/{pty.node,spawn-helper}` (thin `x86_64`) and `prebuilds/darwin-arm64/{pty.node,spawn-helper}` (thin `arm64`) present → pass.
    - universal build missing the `darwin-x64` prebuild dir (or a file inside it) → fail with a clear "node-pty x64 prebuild missing" message.
    - universal build where `darwin-x64/pty.node` carries the *wrong* slice (arm64) → fail.
    - **a *fat* node-pty `pty.node`/`spawn-helper` is REJECTED** — the gate enforces an *exact* single slice per arch (a fat `darwin-x64/pty.node` returning `x86_64 arm64` fails), never merely "contains the slice". This both forbids requiring fat and catches an unexpected lipo-merge of node-pty's per-arch layout (regression guard for this finding).
    - arm64 build with `prebuilds/darwin-arm64/{pty.node,spawn-helper}` present and `arm64` → pass.
- **Existing** `electron-builder-after-pack` unit tests stay green (no behavior change there).
- **Manifest:** add/extend a `rewrite-manifest` unit test asserting both zips survive and the top-level pointer is the universal dmg.
- **CI integration:** the slice gate runs in `release.yml` on every release build (and any release-smoke `workflow_dispatch`).

## 8. Edge cases

- **x64 `better_sqlite3.node` silently fails to cross-compile** → the lipo-merge yields a thin arm64 `better_sqlite3.node`; caught by the slice gate's fat-binary assertion. Hard fail, no ship.
- **node-pty's `darwin-x64` prebuild missing from (or wrong-slice in) the universal app** → caught by the slice gate's "both `prebuilds/darwin-x64` and `darwin-arm64` present, thin per arch" assertion. Hard fail, no ship.
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
| `scripts/sign-notarize-dmg.mjs` | **fix** — `listDmgs` (all dmgs) + loop sign/notarize/staple over every dmg |
| `tests/unit/…sign-notarize-dmg…` | update — `listDmgs` returns all dmgs; single-dmg back-compat |
| `scripts/ci/ensure-ai-creed-universal-download.mjs` | **new** — idempotent ai-creed `.mdx` universal-default transform |
| `tests/unit/…ensure-ai-creed-universal-download…` | **new** — transform unit tests (incl. idempotency) |
| `docs/mac-distribution.md` | **new** — note on universal+arm64 + auto-update arch selection |
| ai-creed `.mdx` (separate repo) | rewritten at release time by the transform above (universal default + arm64 native, drop "no Intel macOS") |

(>3 files → the implementation plan decomposed into reviewable slices.)
