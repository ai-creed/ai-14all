# Fix-Review Installer — CLI Detection & Comment-Pane CTA

## Problem

Users who install Claude Code or Codex outside Homebrew (Anthropic's official `curl install.sh` lands in `~/.claude/local/claude`; npm-global, bun, asdf, volta, nvm all land off Homebrew's PATH) cannot install the `ai-14all-fix-review` skill. The Electron main process inherits a stripped PATH from launchd on macOS, so `which claude` fails even when the user's shell finds it. The install modal disables the checkbox and the user is stuck.

The install entry point is also poorly discoverable — only the menu opens it. A user mid-review who tries to "fix review" via their agent has no in-context affordance to install the skill.

## Goals

1. Detect provider CLIs across common non-Homebrew install layouts.
2. Let the user manually pick the CLI binary as a last-resort fallback, persisted across sessions.
3. Surface a CTA in the review comment pane when no provider is installed, so users discover the installer at the moment they need it.

## Non-Goals

- Auto-installing the CLI on the user's behalf.
- Detecting Windows-specific install paths beyond `where`.
- Per-workspace overrides (overrides are global).

## Architecture

### Visibility rule (locked)

The CTA is shown when **no provider has the skill installed** — i.e. `providers.every(p => !p.installed)`. Once the user installs the skill for at least one provider, the CTA hides. No dismiss state.

### Detection — `services/review/agent-skill-installer/cli-detection.ts` (new)

Pure module. Single export:

```ts
export type CliSource = "override" | "path" | "fixed" | "shell" | "none";
export type Detection = { cliPath: string; source: CliSource } | null;

export async function detectCliPath(
  cmd: "claude" | "codex",
  deps: {
    home: string;
    platform: NodeJS.Platform;
    shell: string | undefined; // process.env.SHELL
    override: string | null;
    exec: (file: string, args: string[], opts?: { timeout?: number }) => Promise<{ stdout: string }>;
    access: (path: string) => Promise<void>;
  },
): Promise<Detection>;
```

Probe order, first hit wins:

1. **Override** — if `deps.override` set: validate via `access(path)`. If exists, return `{ cliPath: override, source: "override" }`. If missing, fall through (do not error — the override path may have been removed).
2. **PATH** — `which` (posix) / `where` (win32). Use first stdout line. If success, return `{ cliPath: <line>, source: "path" }`.
3. **Fixed candidates** — per-cmd ordered list of absolute paths. Validate via `access`. First hit returned with `source: "fixed"`.
   - **claude:** `~/.claude/local/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, `~/.local/bin/claude`, `~/.bun/bin/claude`, `~/.npm-global/bin/claude`, `~/.volta/bin/claude`, `~/.cargo/bin/claude`.
   - **codex:** `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`, `~/.local/bin/codex`, `~/.bun/bin/codex`, `~/.npm-global/bin/codex`, `~/.volta/bin/codex`, `~/.cargo/bin/codex`.
   - On win32, skip this tier (no reliable convention).
4. **Login-shell probe** — `${SHELL} -ilc 'command -v <cmd>'` with 2 s timeout. Skip when `platform === "win32"` or `shell` undefined. Trim stdout; if non-empty and points to an existing file, return with `source: "shell"`. Swallow timeouts and exec errors silently.
5. Return `null`.

The login-shell probe runs every `listProviders` call but is gated by tiers 1–3 short-circuiting first. In practice tier 4 only runs for users who hit none of the cheap probes — exactly the population we need to help.

### Override store — `services/review/agent-skill-installer/cli-override-store.ts` (new)

JSON file at `<userData>/ai-14all/cli-overrides.json`:

```json
{ "claude-code": "/Users/x/.claude/local/claude", "codex": null }
```

Class `CliOverrideStore` with:

- `constructor(filePath: string)`
- `load(): Promise<Partial<Record<ProviderId, string | null>>>` — returns `{}` if file missing or parse fails (non-fatal). Callers must handle absent keys; the installer treats `undefined` and `null` identically as "no override".
- `set(id: ProviderId, path: string | null): Promise<void>` — atomic temp-file + rename, mirroring `ReviewCommentStore.save`.

Validated by zod schema reusing `ProviderId`.

### Installer changes — `services/review/agent-skill-installer/index.ts`

- Constructor gains `overrideStore: CliOverrideStore`.
- `ProviderRow` extends with `cliPath: string | null` and `cliSource: CliSource`.
- `listProviders` calls `detectCliPath` per provider, merging the override map.
- `install` passes the resolved `cliPath` (from detection) into `ClaudeProvider`/`CodexProvider`, and rewires `isCliAvailable` to a closure over the same detection result rather than `isOnPath("<cmd>")`. Today the providers gate `execFile` behind `isCliAvailable()` (claude-provider.ts:28, codex-provider.ts:24); without this rewire, override/fixed/shell paths would still be rejected at install time. Concretely:

  ```ts
  const detection = await detectCliPath("claude", { ..., override: overrides["claude-code"] });
  const cliPath = detection?.cliPath ?? "claude";
  new ClaudeProvider({
    home,
    cliPath,
    isCliAvailable: async () => detection !== null,
  });
  ```

  The providers' `Deps` shape is unchanged — only the values supplied by the installer change. `isOnPath` becomes an internal helper of `cli-detection.ts` and is no longer used by the installer directly.

- New methods:
  - `setOverride(id: ProviderId, path: string | null): Promise<{ providers: ProviderRow[] }>` — validates path (file exists, not directory) before persisting; returns refreshed list.

### IPC contract — `shared/contracts/agent-install.ts` + `electron/main/ipc.ts` + `electron/preload/index.ts`

Add to `agentInstall` namespace:

- `pickCliPath(id: ProviderId): Promise<{ canceled: boolean; path: string | null }>` — main calls `dialog.showOpenDialog({ properties: ["openFile"], message: "Locate <id> CLI" })` against the focused window. Returns the first file path or `canceled: true`.
- `setCliOverride(id: ProviderId, path: string | null): Promise<{ providers: ProviderRow[] }>` — delegates to `installer.setOverride`.

`ProviderRow` shape change must be reflected in the `agentInstall.listProviders` return type.

### Renderer wiring — single status owner

Today `AgentInstallModal` calls `useAgentInstallStatus()` directly (AgentInstallModal.tsx:10) and `App.tsx` does not. If we add a second `useAgentInstallStatus()` call in `App.tsx` for the CTA, the two hooks hold independent state — installing from inside the modal would refresh the modal's copy but leave the CTA visible until next mount.

Resolution: make `App.tsx` the **single owner**. Lift the hook to `App.tsx` and pass status + actions down by props:

- `App.tsx` calls `useAgentInstallStatus()` once.
- `AgentInstallModal` becomes a presentational component receiving `providers`, `bindError`, `install`, `pickCliPath`, `setCliOverride` as props instead of calling the hook itself.
- `ReviewCommentSidebar` receives `installCtaVisible` and `onOpenInstall` from `App.tsx`, both derived from the same hook instance.

The hook itself gains `pickCliPath` and `setCliOverride` callbacks that wrap the new IPC methods and refresh state. Provider type extended with `cliPath` and `cliSource`.

This refactor is part of Phase 2 (modal locate flow) so the lift and the new affordance land together; Phase 3 then only adds the sidebar consumer.

### Modal — `src/features/review/AgentInstallModal.tsx`

For each provider row:

- If `cliAvailable`: existing checkbox row, with hint "CLI detected (via override)" when `cliSource === "override"`.
- If `!cliAvailable`: render a **Locate CLI…** button alongside the disabled checkbox. Click handler:
  1. `await pickCliPath(p.id)` → if canceled, no-op.
  2. `await setCliOverride(p.id, picked.path)` → refresh.
  3. If the refreshed row still reports `!cliAvailable`, surface `"Selected file is not a usable <id> CLI"` inline.
- After successful override, the row flips to the checked path; user proceeds with normal install.

### Comment-pane CTA — `src/features/review/AgentInstallCta.tsx` (new) + `ReviewCommentSidebar.tsx`

Component renders a footer banner inside the sidebar (below the comments list) — placement chosen so it does not push existing content. Copy:

> **Install fix-review skill** — let your Claude Code or Codex agent address these comments. [Install…]

Sidebar gets two new optional props:

```ts
installCtaVisible: boolean;
onOpenInstall: () => void;
```

When `installCtaVisible` is true, render `<AgentInstallCta onOpenInstall={onOpenInstall} />` as the last child of `.shell-review-comment-sidebar` (after the list). When false, render nothing extra.

### App wiring — `src/app/App.tsx`

`App.tsx` calls `useAgentInstallStatus()` (newly lifted — see Renderer wiring above) and computes:

```ts
const installCtaVisible = providers.length > 0
  && providers.every(p => !p.installed);
```

Status object (`providers`, `bindError`, `install`, `pickCliPath`, `setCliOverride`) is passed into `<AgentInstallModal>` as props. `installCtaVisible` and `onOpenInstall={() => setInstallModalOpen(true)}` are passed into `<ReviewCommentSidebar>`. The existing menu trigger continues to work unchanged.

Because both consumers share one hook instance, an install completed inside the modal triggers a single refresh that flips `installed: true` on the relevant row, which immediately drops `installCtaVisible` to false and hides the banner.

## Data Flow — Non-PATH CLI Install

1. User opens review drawer; comment pane footer shows the install CTA (no provider installed).
2. Click "Install…" → `AgentInstallModal` opens. Both rows show **Locate CLI…** because login-shell probe also missed (rare, but happens for users with bespoke shells).
3. User clicks **Locate Claude CLI…** → file picker opens → user navigates to `~/.claude/local/claude` → confirms.
4. Main validates the file, persists `cli-overrides.json`, returns refreshed providers. Row now reports `cliAvailable: true, cliSource: "override"`.
5. User checks the Claude box, clicks **Install** → `ClaudeProvider.install` runs `execFile(cliPath="/Users/x/.claude/local/claude", ["mcp", "add", ...])`.
6. `listProviders` after install reports `installed: true` → CTA hides.

## Error Handling

- File picker returns directory or `.app` bundle: reject before persist; surface inline.
- File exists but is not executable: detection's `access` succeeds; the actual `execFile` will fail at install time with the existing error path. Acceptable — the user gets a real error with the bad path.
- Login-shell probe hangs: 2 s timeout; treated as miss.
- Override path deleted between sessions: detection falls through to other tiers; UI shows whatever tier won. If all tiers miss, row reverts to "Locate CLI…".

## Testing

### Unit

- `cli-detection.test.ts` — table-driven, mocked fs/exec. Cases: override hit, override stale (falls through), `which` hit, fixed-path hit per candidate, shell-probe hit, all-miss returns null, win32 skips fixed + shell tiers.
- `cli-override-store.test.ts` — round-trip; atomic write (assert temp file removed); corrupt JSON returns empty map without throwing.
- `agent-skill-installer-list-providers.test.ts` — extends existing tests: asserts `cliPath`/`cliSource` propagate; override path overrides PATH detection; install passes override `cliPath` to provider.

### Renderer

- `agent-install-modal-locate.test.tsx` — mocks `pickCliPath`/`setCliOverride`; clicking **Locate CLI…** opens picker, persists override, flips row to checkable.
- `review-comment-sidebar-cta.test.tsx` — banner visible when prop is true, fires `onOpenInstall` on click; absent when false.

### E2E (`tests/e2e/agent-skill-install.test.ts`)

This file is currently globally skipped due to a pre-existing Playwright + Electron preload timing issue (`window.ai14all` is undefined at test launch — see file-level comment, lines 1–17). Unblocking that harness is **out of scope** for this design; investigating Playwright/Electron preload exposure is a separate effort.

We still add the new cases to the file so they exist alongside the existing skipped suite. They will remain skipped until the harness is unblocked. Do not claim "covered by e2e" in PR descriptions for this work — the unit and renderer tests above are the real coverage gate.

Cases to add (skipped):

- Stub `dialog.showOpenDialog` via Electron testing API; simulate user picking a fixture script that records its argv; assert install completes against the override path.
- Open install modal via the sidebar CTA (asserts the new affordance, not just the menu path).

## Out of Scope

- Validating that the picked file is actually a Claude/Codex CLI (e.g. running `<path> --version`). Considered, rejected: would couple us to vendor CLI surface and slow the picker. The install attempt itself surfaces a clear error if the binary is wrong.
- Surfacing detection diagnostics in the modal beyond `cliSource`. Can be added later if support load justifies it.

## Implementation Phasing

Per the rule against >3-file changes per task, split into three reviewable plans:

1. **Backend detection + override store** — new `cli-detection.ts`, `cli-override-store.ts`, their unit tests, and updates to `agent-skill-installer/index.ts` to thread `cliPath`/`cliSource` through `ProviderRow` and rewire `isCliAvailable` from the detection result.
2. **IPC + modal locate flow + status lift** — `shared/contracts/agent-install.ts`, `electron/main/ipc.ts`, `electron/preload/index.ts`, `useAgentInstallStatus.ts` (add `pickCliPath`/`setCliOverride`), `AgentInstallModal.tsx` (becomes presentational, props-driven), `App.tsx` (hook lift: own the single `useAgentInstallStatus` instance and pass status + actions into the modal), modal unit tests. The hook lift ships in this phase so the modal still builds after going props-driven.
3. **Sidebar CTA** — new `AgentInstallCta.tsx`, `ReviewCommentSidebar.tsx` gains `installCtaVisible` and `onOpenInstall` props and renders the banner, `App.tsx` only adds the derived `installCtaVisible` and forwards both props (consuming the already-owned hook from Phase 2), sidebar unit test, e2e cases (added but skipped).
