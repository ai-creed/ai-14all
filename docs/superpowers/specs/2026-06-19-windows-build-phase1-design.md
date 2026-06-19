# Windows Build — Phase 1: Prove a Running arm64 Build

- **Date:** 2026-06-19
- **Project:** ai-14all (Electron, v0.9.3)
- **Status:** Design approved; pending implementation plan
- **Author:** Vu Phan (with Claude)

## 1. Background & Goal

ai-14all currently ships a macOS-only release (signed/notarized arm64 DMG + ZIP, built by `release.yml` on `macos-14`). The app is an Electron mission-control surface for running AI coding agents in PTYs across Git worktrees. We want to know whether a working Windows build is feasible and, as the first concrete step, produce one.

Feasibility verdict: **yes.** It is an Electron app and every dependency is cross-platform, including the two native modules (`node-pty` ships ConPTY/winpty support and Windows prebuilds; `better-sqlite3` builds on Windows). Nothing in the stack blocks Windows. The work is a real port, not a config flip — the codebase is macOS-centric in three layers: build/packaging config, CI/release, and runtime code (shell/PTY selection, binary/PATH resolution, a few path-separator assumptions).

**Phase 1 goal:** produce an unsigned **win-arm64** build that compiles and launches inside a Windows 11 ARM VM on the developer's Apple-Silicon Mac, with the core product loop working. This de-risks the runtime port before any investment in CI, signing, or auto-update.

## 2. Hard Constraints

1. **The currently-supported macOS build and runtime MUST NOT break.** Every change in this work is strictly additive or platform-gated. Behavior on `darwin` stays identical: the mac electron-builder target, the `afterPack` guards, the signing/notarization path, and the default shell resolution (`process.env.SHELL ?? "/bin/zsh"` + `["-l"]`) are all unchanged on macOS. Windows logic lives behind `process.platform === "win32"` branches or new helpers whose darwin path reproduces today's behavior exactly.
2. **Target win-arm64 only for now.** The build is produced and run locally in a Windows 11 ARM VM. x64 is deferred until a Windows CI job exists.

## 3. Scope

**In scope (Phase 1):**
- A `win:` electron-builder target (zip, arm64) that packages successfully.
- Making the `afterPack` guards platform-aware so the Windows build does not abort.
- Default-shell selection on Windows (pwsh → Windows PowerShell).
- Agent binary + git resolution on Windows.
- Path-separator correctness fixes.
- TDD unit coverage for the new/changed logic + a manual VM smoke checklist.

**Out of scope (later phases):**
- Windows CI job; x64 target/matrix.
- NSIS installer; code signing (EV/OV cert or Azure Trusted Signing).
- Auto-update (`latest.yml`) generation/publishing for Windows.
- Linux support.
- Deep binary-resolver parity (full per-agent search-path tiers); a `.ico` app icon (Phase 1 uses Electron's default icon).

## 4. Acceptance Criteria

"Done" for Phase 1, verified manually in the VM:

**Must:**
- `pnpm install` in the VM succeeds; the ARM64 MSVC + Python toolchain compiles `node-pty` and `better-sqlite3` from source for win-arm64. (These build against the **host-Node** ABI at this step — `pnpm install` only runs `postinstall`; it does **not** target Electron's ABI.)
- `pnpm build` then `electron-builder --win --dir` (or `zip`) succeeds. **Electron-ABI alignment is owned by this packaging/rebuild step, not by `pnpm install`:** `buildDependenciesFromSource: true` recompiles the native modules against Electron's headers when packaging (and `predev`/`electron-rebuild` does the same for run-from-source). The afterPack `assertPackagedBetterSqliteAbi` guard then passes — the packaged `NODE_MODULE_VERSION` equals Electron's ABI — and that passing assertion is the ABI evidence.
- The app launches — window opens, no "Cannot find module" / native-module crash.
- A Git worktree can be opened/added.
- A terminal pane spawns **pwsh.exe** (or **powershell.exe** fallback) and is interactive.
- **better-sqlite3** opens without an ABI crash (the code-nav/symbol path that uses the DB works).
- Basic `git` operations work (status, worktree list).

**Should:**
- An agent CLI (e.g. `claude`) resolves and launches inside a terminal.

## 5. Design

### 5.1 Build & packaging

**`electron-builder.yml`** — add a `win:` block alongside the existing `mac:` block (additive; `mac:` untouched):

```yaml
win:
  target:
    - target: zip
      arch:
        - arm64
  # icon omitted in Phase 1 — Electron default icon is used.
```

`buildDependenciesFromSource: true` stays as-is: it forces native modules to compile from source against Electron's headers, which guarantees the correct win-arm64 Electron ABI (arm64 prebuilds are spotty).

**`scripts/electron-builder-after-pack.mjs`** — the current `afterPack` would abort a Windows build for two reasons; both are fixed by making it platform-aware while preserving the darwin path:

1. **node-pty spawn-helper assertion.** `ensurePackagedNodePtySpawnHelperExecutable()` looks for a `darwin-<arch>/spawn-helper` and the default `afterPack` throws if it is missing. Windows node-pty has no spawn-helper (it uses `conpty.node`), so this must be **skipped on win32**. On darwin the assertion remains active and unchanged. Optionally, assert the presence of `conpty.node` on win32 as the equivalent guard.
2. **macOS-shaped resources path.** `getPackagedAsarUnpackedDir()` / `getPackagedAsarPath()` hardcode `${productFilename}.app/Contents/Resources/...`. On Windows electron-builder emits `<appOutDir>/resources/app.asar` and `<appOutDir>/resources/app.asar.unpacked`. Introduce a `getPackagedResourcesDir({ appOutDir, productFilename, platform })` that returns the mac path on darwin (identical to today) and `<appOutDir>/resources` on win32/linux. Derive the asar + unpacked dirs from it so the **better-sqlite3 ABI guard** and the **dependency-closure guard** keep running on Windows (both are valuable cross-platform and must not be lost).

These functions are already dependency-injected with unit tests, so the change is straightforward to drive test-first.

**`package.json`** — add a script:

```json
"package:win": "pnpm build && electron-builder --win zip --publish never"
```

### 5.2 Runtime code

**New helper `services/platform/default-shell.ts`** — single source of truth for the default interactive shell, replacing the `process.env.SHELL ?? "/bin/zsh"` literal duplicated across `terminal-service.ts`, `shell-path.ts`, and `binary-resolver.ts` (the "extract repeated code" cleanup):

```
resolveDefaultShell({ platform, env, existsSync }) -> { shell: string, args: string[] }
```

- darwin/linux: `{ shell: env.SHELL ?? "/bin/zsh", args: ["-l"] }` — behavior identical to today.
- win32: prefer `pwsh.exe` if discoverable (PATH / known install location), else `powershell.exe` (always present on Win10/11); `args: ["-NoLogo"]` (no `-l`).

Wire it into **`services/terminals/terminal-service.ts`** at the `pty.spawn(shell, ["-l"], …)` call site. On Windows the current code falls through to `/bin/zsh`, so `pty.spawn` throws and the terminal lands in an error state — this is the central runtime fix.

> Note: `shell-path.ts` (`resolveLoginShellPath` / `mergePath`) is a macOS GUI-PATH repair mechanism reached only through `augmentGuiLaunchPath`, which already early-returns off darwin. Its `:`-delimiter logic never executes on Windows, so it needs **no** change. (`binary-resolver.ts` still has its own `?? "/bin/zsh"` literal that the helper should replace, but its login-shell probe is replaced wholesale on win32 — see below.)

**`services/plugins/binary-resolver.ts`** — add a win32 branch. Today the `-ilc command -v <name>` probe errors on Windows and the fallback search paths (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`) do not exist, so it returns `null` (no crash, but no agent found). On win32:
- Skip the interactive login-shell probe.
- Resolve via `where <name>` and a Windows search-path list (e.g. `%LOCALAPPDATA%\Programs`, the npm global prefix, `%USERPROFILE%\.local\bin`).
- Append the Windows executable extensions (`.exe`, `.cmd`, `.ps1`) when probing a bare name.
- The non-win path is byte-for-byte unchanged.

**`services/git/git-binary.ts`** — add a win32 branch: probe common Git-for-Windows locations (`C:\Program Files\Git\cmd\git.exe`, `%LOCALAPPDATA%\Programs\Git\cmd\git.exe`), else fall back to bare `git` on PATH. Non-win behavior unchanged.

**Path-separator correctness** — handle `\` in addition to `/`, without regressing macOS:
- `src/features/terminals/logic/agent-attention.ts` — `token.lastIndexOf("/")` should also account for `\`.
- `electron/code-nav/watch/worktree-watcher.ts` — the `ignored` filter assumes `/` in paths; normalize separators before matching.

**`services/review/agent-skill-installer/cli-detection.ts`** — already has a win32 `where` branch; Phase 1 only needs it to find PATH agents. Deeper per-agent tiers are punch-list.

### 5.3 Native modules & VM toolchain

In the Windows 11 ARM VM:
- Node 24 (matches Electron 41's bundled Node), corepack/pnpm.
- Python 3.
- **Visual Studio Build Tools 2022** with "Desktop development with C++" and the **ARM64** build components.

Then `pnpm install` builds `node-pty` and `better-sqlite3` from source against the **host-Node** ABI (`onlyBuiltDependencies` lists both; `pnpm install` itself only runs `postinstall` and does not target Electron's ABI). **Electron-ABI alignment is a separate packaging/rebuild step:** `electron-builder --win` with `buildDependenciesFromSource: true` recompiles the native modules against Electron's headers when packaging, and `predev` / `electron-rebuild` does the same for run-from-source (`pnpm dev`). The afterPack `assertPackagedBetterSqliteAbi` guard validates that the packaged binary's `NODE_MODULE_VERSION` matches Electron's ABI and aborts the build on mismatch — this is the ABI verification evidence required in §6.

## 6. Testing Strategy (TDD)

Unit tests (Vitest), written test-first, using the codebase's dependency-injection style (inject `platform`, `env`, `existsSync`, spawn seams) so they run on macOS:
- `resolveDefaultShell`: darwin vs win32; pwsh-present vs absent fallback; args correctness.
- `binary-resolver` win32 branch: `where` hit / miss / extension handling; darwin path unchanged.
- `git-binary` win32 resolution: Program Files hit vs PATH fallback.
- The two path-separator fixes: failing test reproducing the `\` case first, then fix.
- `after-pack`: extend existing tests for the platform-aware `getPackagedResourcesDir` and the win32 spawn-helper skip; confirm darwin tests stay green.

Reuse existing test helpers where they make the tests cleaner.

Manual VM smoke = the §4 acceptance bar.

**macOS regression check (the hard constraint):** before considering the work done, run `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test` on the Mac; the `after-pack` unit tests cover the packaged-layout logic. Optionally run a local `electron-builder --mac --dir` to confirm mac packaging still succeeds, then `node scripts/rebuild-better-sqlite3-host.mjs` to restore the host ABI for vitest.

## 7. Risks & Unknowns

- **arm64 native-module compile** in the VM — mitigated by `buildDependenciesFromSource: true` plus the ARM64 MSVC toolchain.
- **Windows environment-variable casing** — `process.env` is passed to the PTY as `Record<string,string>`; Windows uses `Path`/`PATH` interchangeably via a case-insensitive accessor, but a literal copy can lose that. Verify the spawned shell inherits a usable PATH.
- **node-pty ConPTY maturity on win-arm64** — verify the terminal actually drives an interactive session, not just spawns.
- **electron-builder Windows resources layout** — confirmed assumption is `<appOutDir>/resources/...`; verify against the actual output during bring-up.

## 8. Task Breakdown (phased; >3 files so decomposed per workflow rules)

1. **Build green** — `after-pack` platform-awareness (`getPackagedResourcesDir`, win32 spawn-helper skip) + `win:` config + `package:win` script. Goal: `electron-builder --win` produces a packaged app and the guards pass.
2. **Terminal** — `default-shell` helper + `terminal-service` wiring (TDD).
3. **Resolution** — `binary-resolver` + `git-binary` win32 branches (TDD).
4. **Correctness** — path-separator fixes (TDD).
5. **VM bring-up** — toolchain setup, manual smoke against the acceptance bar, capture a punch-list of remaining polish.

Each task is small, independently testable, and preserves macOS behavior.

## 9. Future Phases (not now)

- Windows CI job (`windows-latest`), x64 target/matrix.
- NSIS installer + code signing.
- Auto-update: generate and publish `latest.yml` for Windows.
- Deeper agent binary-resolver parity; `.ico` app icon; Linux.
