# ai-14all

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Latest release](https://img.shields.io/github/v/release/ai-creed/ai-14all?display_name=tag)](https://github.com/ai-creed/ai-14all/releases)
[![macOS arm64](https://img.shields.io/badge/macOS-arm64-informational)](#install)

A terminal-first Electron shell for orchestrating AI coding agents against Git worktrees. Each session is pinned to one worktree; the terminal is the primary surface, and file review, notes, and Git inspection are summoned on demand.

![ai-14all session view](./docs/assets/hero.png)

**Status:** v0.1.0 (first stable release). Apple Silicon only. Unsigned build — see [KNOWN-ISSUES](./KNOWN-ISSUES.md).

## Install

Download the latest DMG:

- [ai-14all-0.1.0-arm64.dmg](https://downloads.ai-creed.dev/ai-14all/0.1.0/ai-14all-0.1.0-arm64.dmg)

Because the build is unsigned, macOS Gatekeeper blocks it on first launch. Right-click the app in Finder, choose Open, and confirm. Alternatively:

```sh
xattr -dr com.apple.quarantine /Applications/ai-14all.app
```

### Optional: verify the download

The release manifest at [ai-creed.dev/ai-14all/latest-mac.yml](https://ai-creed.dev/ai-14all/latest-mac.yml) lists the sha512 of every shipped artifact. Compare it against your local download:

```sh
shasum -a 512 ai-14all-0.1.0-arm64.dmg | awk '{print $1}' | xxd -r -p | base64
```

This produces the same base64-encoded digest that appears in `latest-mac.yml` under the matching `files[].sha512` field. If they differ, the download is corrupt or tampered.

## Build from source

```sh
pnpm install
pnpm dev
```

## Project page

https://ai-creed.dev/projects/ai-14all

## Links

- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- Known issues: [KNOWN-ISSUES.md](./KNOWN-ISSUES.md)
- License: MIT — see [LICENSE](./LICENSE)
