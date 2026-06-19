# Windows Build — Phase 1 VM Acceptance Checklist (operator-run)

- **Date:** 2026-06-19
- **Branch:** `feat/windows-build-phase1`
- **Spec:** `docs/superpowers/specs/2026-06-19-windows-build-phase1-design.md`
- **Plan:** `docs/superpowers/plans/2026-06-19-windows-build-phase1.md` (Task 6)

## Status

- **Code (Tasks 1–5) + Prettier fix:** COMPLETE and committed (`bfd3c19`, `128192d`, `d3d7357`, `550acb3`, `b757da8`, `9d65258`), each per-task spec+quality reviewed; final whole-branch review: READY TO MERGE.
- **macOS regression gate:** PASSED — `pnpm lint` (0 errors, 12 pre-existing warnings), `pnpm format` (clean), `pnpm typecheck` (clean), `pnpm test` (1756/1756 passing, 219 files).
- **Windows VM acceptance (this document):** PENDING — must be run by the operator on the Windows 11 ARM VM.

## Why this is operator-run, not automated

Phase 1's acceptance bar (spec §4) is verified *manually in the Windows 11 ARM VM*. The autonomous workflow that produced the code runs on macOS (`darwin`) and has no access to that VM. The native modules (`better-sqlite3`, `node-pty`) cannot be compiled for win-arm64 from macOS, and the packaged `.exe` cannot be launched or interactively smoke-tested from a macOS shell. These steps require the VM and human visual confirmation (e.g. "the terminal spawns pwsh and is interactive"). No agent in a macOS session can produce this evidence, and fabricating it is not acceptable — hence this checklist for the operator.

## Prerequisites (in the Windows 11 ARM VM)

Two paths. **Route A is the one in use** — CI builds the artifact, you only run it.

### Route A — run the prebuilt artifact (recommended; only Git needed)

The packaged app is self-contained: it bundles its own Node (Electron's runtime) and all `node_modules` in `app.asar`. You do **not** need Node, pnpm, Python, or Visual Studio Build Tools in the VM.

- [ ] **Git for Windows** — required at runtime: the app shells out to `git` for worktree/status (`getGitBinaryPath` → Program Files Git path, else `git.exe` on PATH). Without it, the worktree/git smoke steps fail.
- [ ] (optional) An agent CLI such as `claude` — only to exercise the "Should" criterion below.

### Route B — build inside the VM instead (only if not using CI)

- [ ] Node 24 (matches Electron 41's bundled Node); `corepack enable`.
- [ ] Python 3 (for node-gyp).
- [ ] Visual Studio Build Tools 2022 — "Desktop development with C++" workload **+ ARM64** build components.
- [ ] Git for Windows (also a runtime dependency, as in Route A).
- [ ] Verify: `node -v` (24.x), `pnpm -v`, `python --version`.

## Steps & Must-criteria (record the result of each)

### Get the build

**Route A (CI — in use):** the `build-windows-arm64` workflow (`.github/workflows/build-windows-arm64.yml`) builds the unsigned win-arm64 zip on a `windows-11-arm` runner and uploads it as the `ai-14all-win-arm64-zip` artifact. The afterPack guards (better-sqlite3 Electron-ABI, spawn-helper-skip on win32, dependency-closure) all pass there, so packaging is already validated.

- [ ] `gh run download <run-id> -n ai-14all-win-arm64-zip` (on a machine with `gh`), transfer the zip into the VM, unzip. _Result:_ ____

**Route B (build in VM):** instead run `git checkout feat/windows-build-phase1` → `pnpm install --frozen-lockfile` (compiles `node-pty` + `better-sqlite3` for win-arm64) → `pnpm package:win` (afterPack guards must pass; zip lands under `release/`). _Result:_ ____

### Launch / smoke (spec §4 "Must")

- [ ] App launches — window opens, no "Cannot find module" / native-module crash. _Result:_ ____
- [ ] A Git worktree can be opened/added (exercises `getGitBinaryPath` win32). _Result:_ ____
- [ ] A terminal pane spawns **pwsh.exe** (or **powershell.exe** fallback) and is interactive (exercises `resolveDefaultShell` + node-pty ConPTY). _Result:_ ____
- [ ] better-sqlite3 opens without an ABI crash (trigger the code-nav/symbol path that uses the DB). _Result:_ ____
- [ ] Basic `git` operations work (status, worktree list). _Result:_ ____

### Should

- [ ] An agent CLI (e.g. `claude`) resolves and launches in a terminal (exercises `resolveBinary` win32 branch). _Result:_ ____

## Punch-list captured during code review (fold into a follow-up phase)

- `whichOnPathWindows` (`where` spawn) has no timeout (low risk; Windows-only fast builtin).
- `defaultWindowsSearchPaths` reads `process.env` directly (env-default branch untested).
- `.exe`-suffix agent-name matching not yet added in `agent-attention.ts` (only the path separator was fixed).
- No `win.icon` — Windows artifact ships Electron's default icon (intentional Phase 1).
- New worktree-watcher backslash test uses real timers vs the fake-timer style elsewhere.

## Sign-off

- [ ] All "Must" criteria pass in the VM → Phase 1 acceptance MET. Record VM (Windows version, arch), Node version, and the date here: ____
