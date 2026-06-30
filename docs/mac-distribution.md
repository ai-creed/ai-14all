# macOS distribution: universal + arm64

The macOS release ships two artifacts from one `electron-builder` run, listed in
one `latest-mac.yml`:

| Artifact | Filename | Who installs it |
| --- | --- | --- |
| Universal | `ai-14all-<ver>-universal.dmg` / `-universal-mac.zip` | Intel Macs (and any Mac — the arm64 slice runs natively) |
| Native arm64 | `ai-14all-<ver>-arm64.dmg` / `-arm64-mac.zip` | Apple Silicon Macs wanting a slim, native download |

## Auto-update is arch-aware

`electron-updater` (6.8.3) classifies each manifest file by whether its filename
contains `arm64`, then on an Apple Silicon Mac keeps only the `arm64` file and on
an Intel Mac keeps only files without `arm64`, finally selecting the `.zip`:

- Apple Silicon → downloads `…-arm64-mac.zip` (native, slim).
- Intel → downloads `…-universal-mac.zip` (x86_64 slice).

This relies on three invariants: both arches are built in one run (one
`latest-mac.yml`), the arm64 filename contains `arm64`, and the universal
filename does not. electron-builder's default artifact names satisfy all three —
do not rename to violate them.

## The slice gate

`scripts/ci/assert-universal-slices.mjs` runs in CI after packaging and asserts,
via `lipo -archs`:

- The universal app's main executable and `better_sqlite3.node` are **fat**
  (`x86_64` + `arm64`) — `@electron/universal` lipo-merges these single-path
  binaries.
- node-pty's `prebuilds/darwin-x64/{pty.node,spawn-helper}` (thin `x86_64`) and
  `prebuilds/darwin-arm64/{pty.node,spawn-helper}` (thin `arm64`) are both
  present. node-pty selects its prebuild directory by `process.arch` at runtime,
  so these are intentionally thin-per-arch and must **not** be fat.
- The arm64 app's single-path binaries contain `arm64` and its
  `prebuilds/darwin-arm64/` files are present.

The gate proves the slices are present and ABI-correct; it does **not** prove the
x64 slice boots on real Intel silicon (CI runs on Apple Silicon). A manual Intel
smoke test before promoting a stable release is the follow-up if runtime
certainty is wanted.
