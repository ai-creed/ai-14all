# Known Issues

Each section links to a tracking GitHub issue once the repository is public (see Task 23). Placeholders (`#TBD-*`) are replaced with real issue numbers during the go-live flip.

## Unsigned build (Gatekeeper)

<!-- tracked-in: #TBD-unsigned -->

v0.1.0 is not signed with an Apple Developer ID and is not notarized. macOS Gatekeeper blocks it on first launch with a "cannot be opened because the developer cannot be verified" dialog.

Workaround, any of:

- Right-click the app in Finder, choose Open, then confirm.
- Run `xattr -dr com.apple.quarantine /Applications/ai-14all.app`.
- System Settings → Privacy & Security → scroll down → click "Open Anyway" after the first failed launch.

Signing and notarization will land in a later patch release once the developer account is enrolled. Tracking: [#TBD-unsigned](https://github.com/ai-creed/ai-14all/issues/TBD-unsigned).

## No in-app update install

<!-- tracked-in: #TBD-notify-only -->

The app notifies you when a newer version is published and opens the download in your browser. It does not auto-install. Quit the running app, drag the new DMG into `/Applications`, replace, relaunch.

Tracking: [#TBD-notify-only](https://github.com/ai-creed/ai-14all/issues/TBD-notify-only).

## Apple Silicon (arm64) only

<!-- tracked-in: #TBD-arm64-only -->

v0.1.0 does not ship an Intel-Mac build. If you are on Intel hardware, the build will not run.

Tracking: [#TBD-arm64-only](https://github.com/ai-creed/ai-14all/issues/TBD-arm64-only).

## Log file location

<!-- tracked-in: n/a — documentation only -->

Local logs are written to `~/Library/Logs/ai-14all/` (Electron default). If something breaks, share that directory — no network telemetry is collected.
