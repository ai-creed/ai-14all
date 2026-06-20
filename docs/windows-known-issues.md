# Windows Known Issues

A running backlog of Windows-specific bugs found while bringing up the Windows
build (Phase 1+). Each entry records the symptom, a copy-paste repro, the root
cause, where it surfaces in the app, which layer owns the fix, and a proposed
direction. Add new issues under **Open**; move them to **Resolved** with the
fixing commit when closed.

Status legend: 🔴 open · 🟡 in progress · ⚪ needs triage / unconfirmed · 🟢 fixed

---

## Open

### 1. 🟡 `whisper collab mount <provider>` crashes — `spawnSync tty ENOENT` (mitigated: whisper gated off on Windows)

**Symptom.** Launching a mounted agent (e.g. clicking *mount claude* in the
agent launcher) runs `whisper collab mount claude` in a terminal, which prints
the turn-events banner and then crashes instead of mounting.

**Repro** (any Windows shell, from a repo dir):

```pwsh
whisper collab mount claude
```

```
[ai-whisper] turn-events: claude=ON codex=ON (codex notify-chaining: off)
node:internal/child_process:1143
    result.error = new ErrnoException(result.error, 'spawnSync ' + options.file);
                   ^
Error: spawnSync tty ENOENT
    at Object.spawnSync (node:internal/child_process:1143:20)
    at execFileSync (node:child_process:954:15)
    at resolveCurrentTty (…/ai-whisper/dist/bin/whisper.js:8010:80)
    at runCollabMount (…/ai-whisper/dist/bin/whisper.js:15181:65)
  errno: -4058, code: 'ENOENT', syscall: 'spawnSync tty', path: 'tty'
```

**Root cause.** ai-whisper's `resolveCurrentTty()` shells out to the POSIX
`tty(1)` command via `execFileSync('tty', …)` to discover the controlling
terminal. `tty` does not exist on Windows, so the spawn fails with `ENOENT` and
the unhandled error kills the mount. This is **upstream ai-whisper** code
(`dist/bin/whisper.js`), not ai-14all — the app only issues the command.

**Where it surfaces in the app.**
- Command is built in `src/features/terminals/logic/agent-launch.ts:69`
  (`whisper collab mount ${provider}`).
- Launched into a terminal via the collab flow (`App.tsx` `launchCollabTerminal`
  / `AgentLauncherBar`), guarded by `use-mount-pending-guard`.

**Layer / ownership.** Upstream **ai-whisper**. Not directly fixable in this
repo.

**Mitigation in place.** The whole ai-whisper plugin is now gated off on Windows
(`createPluginRegistry({ unsupported: { whisper: … } })` from `electron/main`
when `process.platform === "win32"`). The plugin reports an `unsupported` status
("not supported on Windows yet"), can't be enabled, is never probed/started, and
`whisperOnHealthy` stays false — so `launchCommandFor` never issues
`whisper collab mount` and the crash path is closed. **Remove the gate to
re-enable once the upstream `tty` fix ships.**

**Proposed direction.**
- *Upstream (preferred):* guard `resolveCurrentTty` on `win32` — fall back to a
  ConPTY-aware path or `process.stdout.isTTY` / a no-op when `tty` is absent,
  rather than hard-failing.
- *App-side stopgap:* until a fixed whisper ships, detect `win32` and either
  surface a clear "collab mount needs whisper ≥ <fixed version> on Windows"
  message instead of launching, or pin the minimum whisper version in the
  plugin compatibility check.

**Notes.** The probe path is unaffected — `whisper env --json` runs fine (that's
how the plugin reports `installed 0.6.0`). Only the `collab mount` flow hits the
`tty` lookup. Observed with ai-whisper **0.6.0**.

---

### 2. ⚪ `whisper --version` aborts on exit with a libuv assertion (needs triage)

**Symptom.** `whisper --version` prints `0.6.0` correctly, then the process
aborts during shutdown:

```
0.6.0
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
```
(exit code `-1073740791` / `0xC0000409`).

**Status / triage needed.**
- Did **not** reproduce on `whisper env --json` or `ai-cortex --version`, both of
  which exit 0 cleanly — so the plugin probe is not affected.
- May be specific to this Node build, or an artifact of how the command was
  piped when captured (`2>&1` through PowerShell). Needs a clean repro (run
  directly in a terminal, capture exit code) before deciding whether it is an
  ai-whisper bug, a Node/libuv issue, or measurement noise.

**Layer / ownership.** TBD (likely upstream ai-whisper or Node/libuv).

---

_(No open issues in the app layer. The two remaining open items above are upstream ai-whisper / Node concerns.)_

---

## Resolved

These were Windows-specific runtime bugs already fixed on
`feat/windows-build-phase1`; kept here for context.

- 🟢 **Usage attribution didn't match a cwd to its worktree on Windows.**
  `matchCwd` (`services/usage/worktree-map.ts`) prefix-tested
  `cwd.startsWith(base + "/")` with a hardcoded "/". `cwd` comes from external
  usage logs and `worktree.path` from the registry, so on Windows the two could
  carry — and disagree on — backslashes, and the match failed (usage attributed
  to no worktree). Unlike `resolveWithinWorktree` (two `resolve()`-produced,
  consistently OS-native paths → `path.sep`), these are independently-sourced
  strings, so `norm()` now folds both sides' backslashes to "/" before the
  prefix test, making the match separator-agnostic. mac unchanged.
- 🟢 **Plugins showed "degraded" though the CLIs work.** Two-part fix: probes
  could not exec the npm `.cmd` shim (`adaptResolvedExec` routes `.cmd`/`.bat`
  via `cmd.exe`, `.ps1` via PowerShell — commit `8cdcb60`); and `where` resolved
  the extensionless POSIX shim first, so the runnable `.cmd` was never picked
  (`pickWindowsExecutable` ranks by executable extension — commit `0539b1d`).
- 🟢 **Launch buttons typed a command but did not run it.** ConPTY/PowerShell
  only submits a line on CR; the app sent `\n`. `commandSubmitKey()` sends `\r`
  on Windows and keeps `\n` elsewhere — commit `8cdcb60`.
- 🟢 **Every file in the review/editor chrome refused to open — "Refused: path
  escapes the worktree".** The worktree-boundary guards compared a resolved
  absolute path against `worktreePath + "/"`, but `resolve()` returns backslashes
  on Windows, so the prefix never matched and every in-worktree file was rejected
  as an escape. Affected the Monaco view/edit path (`file-service` read /
  openForEdit / saveFile / listScopedFiles) and the diff/discard path
  (`git-service` readDiff / discardChange). Centralised into
  `resolveWithinWorktree` (uses `path.sep`, injectable `path.win32`/`path.posix`
  so a POSIX CI guards the regression).
- 🟢 **ai-cortex "Configure" threw a PowerShell parse error.** The composed
  command used POSIX shell syntax — `<get> >/dev/null 2>&1 || <add>` — but it
  runs in the terminal's default shell, which is Windows PowerShell. PowerShell
  5.1 has no `||` (`The token '||' is not a valid statement separator`) and no
  `/dev/null`. `composeCortexConfigureCommand` now emits per-shell:
  `<get> 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { <add> }` on Windows
  (valid in 5.1 and pwsh 7), POSIX unchanged. Shell chosen by
  `detectConfigureShell()` (Windows → PowerShell). Plain commands
  (`npm i -g …`, agent launch) were already cross-shell; this was the only
  composed command using POSIX redirection.
