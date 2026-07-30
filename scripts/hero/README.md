# Hero-video pipeline

Runbook for regenerating the ai-creed homepage hero video from this repo.
Design spec: `docs/superpowers/specs/2026-07-30-hero-video-pipeline-design.md`.

The pipeline runs a fixture-driven recording of ai-14all in e2e mode (staged
demo repo, stub agent CLIs, a scripted storyboard), records the result, then
crops and encodes it into the clip ai-creed actually ships. It is **local-only**
— never wired into CI, same as the visual-baseline suite.

## Prerequisites

- macOS (the pipeline drives the real built Electron app via CDP; the capture
  recipe is macOS-specific).
- `ffmpeg` (and `ffprobe`) on `PATH`. Verify with `ffmpeg -version`.
- Nothing else to install manually — `pnpm hero:record` runs `electron-vite
build` itself before capturing, so a stale `out/` build is never used.

## Commands

| Command              | Does                                                                                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm hero:record`   | Builds the app, stages the demo world, captures a calibrated 2880×1520 @ 60fps screencast through the storyboard, runs stage-A source checks, and writes `hero-dist/master.mp4` + `hero-dist/poster.png` + `hero-dist/storyboard.json`. Clears `hero-dist/` at the start of every run. |
| `pnpm hero:render`   | Reads `hero-dist/storyboard.json` + `hero-dist/master.mp4`, builds an ffmpeg `zoompan` filter from the as-executed beat geometry, and encodes `hero-dist/tour.mp4` — the 1600×844 cropped tour clip. Fails with a clear error if either input is missing (run `hero:record` first).    |
| `pnpm hero:validate` | Stage-B produced-artifact guard: ffprobes `master.mp4`/`tour.mp4`, checks `poster.png`'s PNG header, and checks `storyboard.json`'s schema/clock contract against `scripts/hero/storyboard.ts`. Runnable standalone once all four artifacts exist.                                     |
| `pnpm hero`          | **The one command**: `hero:record && hero:render && hero:validate`. Regenerates every deliverable and proves it against the contract in one shot. A full run is ~90s capture + a few seconds of encode/validate.                                                                       |

Run `pnpm hero` end to end when regenerating for a real delivery. Use the
sub-commands to iterate on a single stage (e.g. re-running `hero:render`
alone after tweaking `gen-camera.ts`, without re-capturing).

## Artifacts (`hero-dist/`, gitignored)

| File              | Contract                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `master.mp4`      | 2880×1520, exactly CFR 60, ~25s (2s lead-in + 21s tour + 2s tail), `yuv420p`, silent.                                                                                           |
| `tour.mp4`        | 1600×844, exactly CFR 60, ~21s, silent, **≤ 5 MB**, `+faststart` (`moov` before `mdat`) — the file ai-creed embeds with `preload="none"`.                                       |
| `poster.png`      | 2880×1520 PNG still of the staged hero state (ai-creed bakes the play-ring overlay on top).                                                                                     |
| `storyboard.json` | As-executed timestamps, measured camera-target rects, and provenance (app version, git SHA, record date, clock calibration). Traces any shipped asset back to what produced it. |

`master.mp4`, `frames/`, and the other intermediate files stay local — only
`tour.mp4`, `poster.png`, and `storyboard.json` are delivered downstream.

## Claims-safety checklist

Before a master is accepted, review it against the spec's binding checklist
(design spec §9):

- Transcripts show only generic, plausible agent work (reading files, test
  output, a commit) — no invented ai-14all features, no secrets, no real
  file paths.
- The app is **source-available under FSL-1.1-ALv2** — it must never be
  described as "open source," on camera or in any accompanying text.
- xavier and samantha are out of scope for this video — no whisper
  workflow-lens content on camera.
- The video is silent — no audio track (enforced by `hero:validate`'s
  zero-audio-stream check on both `master.mp4` and `tour.mp4`).

**Any edit to `scripts/hero/transcripts/*.jsonl` requires re-review against
this checklist before the next master is accepted** — transcript content is
exactly what the checklist is scoped to, and a passing `hero:validate` run
proves the clock/schema contract, not claims-safety.

## Delivering to ai-creed

After a `pnpm hero` run passes stage B, hand off the three files ai-creed
consumes — copy them into the ai-creed repo (destination path is defined on
the ai-creed side, not here):

```bash
cp hero-dist/tour.mp4 hero-dist/poster.png hero-dist/storyboard.json <ai-creed-destination>/
```

`tour.mp4` and `poster.png` are the assets that render on the homepage;
`storyboard.json` travels with them as provenance, not for direct display.
