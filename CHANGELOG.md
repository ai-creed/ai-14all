# Changelog

All notable changes to ai-14all are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] – 2026-04-24

First stable release. Graduates the v0.1.0-beta.N line after the 2026-04 redesign landed.

### Added

- Sessions-first workflow: named sessions backed by Git worktrees, session title + worktree label + branch visible in the rail and the chip bar.
- Compact session chip bar replacing the expanded top band.
- Collapsible review drawer with Files, Changes, and Commits modes.
- Files overlay for fast keyboard-first file navigation.
- Note sheet for per-session notes.
- Shortcut help overlay driven by a single registry, with platform-specific bindings.
- Lightweight in-app editor for whitelisted file types.
- Notify-only update check: banner appears when a newer version is published; Download opens the browser.

### Known issues

See `KNOWN-ISSUES.md`.
