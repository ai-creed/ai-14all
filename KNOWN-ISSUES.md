# Known Issues

## Apple Silicon (arm64) only

<!-- tracked-in: #9 -->

ai-14all does not ship an Intel-Mac build. If you are on Intel hardware, the build will not run.

Tracking: [#9](https://github.com/ai-creed/ai-14all/issues/9).

## Symbol search & go-to-definition need an ai-cortex index

<!-- tracked-in: n/a — documentation only -->

Code navigation (Cmd+T symbol search, go-to-definition, and peek) is backed by an ai-cortex SQLite index for the worktree. If the worktree has no cortex index (or the ai-cortex CLI isn't installed), these features are disabled and the Files pane surfaces a disabled state instead of erroring. The rest of the app works normally.

## Log file location

<!-- tracked-in: n/a — documentation only -->

Local logs are written to `~/Library/Logs/ai-14all/` (Electron default). If something breaks, share that directory — no network telemetry is collected.
