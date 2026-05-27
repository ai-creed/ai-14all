# Known Issues

## Apple Silicon (arm64) only

<!-- tracked-in: #9 -->

ai-14all does not ship an Intel-Mac build. If you are on Intel hardware, the build will not run.

Tracking: [#9](https://github.com/ai-creed/ai-14all/issues/9).

## Log file location

<!-- tracked-in: n/a — documentation only -->

Local logs are written to `~/Library/Logs/ai-14all/` (Electron default). If something breaks, share that directory — no network telemetry is collected.
