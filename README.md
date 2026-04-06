# ai-14all

## Summary

`ai-14all` is an Electron desktop app for managing one local repository through a session-first workflow built around Git worktrees and embedded terminals.

The app is terminal-first. It is meant to keep the active worktree, shell sessions, code inspection, and lightweight Git review in one place without turning into a full IDE.

## Current Scope

The current project scope is:

- one local repository first
- one active worktree session at a time
- multiple embedded terminal sessions per worktree
- read-only file viewing and diff inspection
- lightweight Git review for working-tree changes and recent commits
- persisted workspace restore for practical restart behavior

Deliberately out of scope for the current MVP:

- multi-repository UX
- advanced Git client operations
- editable embedded code workflows
- remote environments
- collaboration or sync features

## Required Setup (Prerequisites)

You need:

- Node.js 20+
- `pnpm`
- Git
- a macOS or Linux environment supported by Electron and `node-pty`

The app shell also depends on:

- a local Git repository to load
- Git worktrees if you want the full session workflow

## Installation Guide (for dev)

1. Clone the repository.
2. Install dependencies:

```bash
pnpm install
```

3. Start the app in development mode:

```bash
pnpm dev
```

Useful commands:

```bash
pnpm build
pnpm test
pnpm test:e2e
pnpm test:all
```

## Phase Roadmap

- Phase 0: technical spike for Electron, PTY terminals, Git worktree discovery, and basic file viewing
- Phase 1: core app skeleton, shared contracts, and session-oriented architecture
- Phase 2: session-first workflow with worktree navigation, terminal workspace, and review workspace
- Phase 3: process session lifecycle, presets, and attention model
- Phase 4: code inspection and lightweight Git review
- Phase 5: persistence and restore for workspace context
- Phase 6: shell redesign, commit review, and personal MVP hardening

The current direction is focused on turning the existing Phase 6 shell into a dependable daily-use personal MVP before expanding scope further.

## Beta Release (macOS)

Create a private beta artifact with:

```bash
pnpm release:beta
```

This command:

- requires a clean working tree
- reuses the existing beta tag if `HEAD` is already tagged
- otherwise computes the next `0.1.0-beta.N`
- runs verification
- packages the app into `release/` — share the `.dmg` with testers (arm64 only)
- creates the Git tag only after packaging succeeds

See [docs/shared/beta-testing.md](docs/shared/beta-testing.md) for the tester-facing runtime note.

## License

MIT
