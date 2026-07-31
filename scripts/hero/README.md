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

| Command              | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm hero:record`   | Builds the app, stages the demo world, captures a calibrated 2880×1520 @ 60fps screencast through the storyboard, runs stage-A source checks, and writes `hero-dist/master.mp4` + `hero-dist/poster.png` + `hero-dist/storyboard.json`. At the start of every run (not just on success) it clears `hero-dist/frames/` and every file the pipeline produces — `master.mp4`, `tour.mp4`, `tour-filter.txt`, `poster.png`, `storyboard.json`, `frame-times.json`, `concat-list.txt`, `calibration-failure.json` — so a later stage can never validate a stale artifact from an unrelated capture. Anything else you leave in `hero-dist/` survives. |
| `pnpm hero:render`   | Reads `hero-dist/storyboard.json` + `hero-dist/master.mp4`, builds an ffmpeg `zoompan` filter from the as-executed beat geometry, and encodes `hero-dist/tour.mp4` — the 1600×844 cropped tour clip. Fails with a clear error if either input is missing (run `hero:record` first).                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm hero:validate` | Stage-B produced-artifact guard: ffprobes `master.mp4`/`tour.mp4`, checks `poster.png`'s PNG header, and checks `storyboard.json`'s schema/clock contract against `scripts/hero/storyboard.ts`. Runnable standalone once all four artifacts exist.                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm hero`          | **The one command**: `hero:record && hero:render && hero:validate`. Regenerates every deliverable and proves it against the contract in one shot. Budget ~2.5 minutes end to end: `electron-vite build` (triggered by `hero:record`), then ~90s of capture, then the master/tour encodes and stage B.                                                                                                                                                                                                                                                                                                                                            |

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
- Nothing identifies the machine that recorded it. Every terminal pane is
  driven by typing a one-word PATH shim (`claude`/`codex`/`ezio`,
  `watch-tests`/`dev-server` — see `stage.ts`), never a `node` invocation
  carrying absolute repo paths, and the recorder's scratch `ZDOTDIR/.zshrc`
  replaces macOS's default `%n@%m %1~ %# ` prompt with `%1~ %# ` so no
  username or hostname is legible. Re-check both in the frames after any
  change to the staging or shell setup.
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

## Fixture traps the frames pay for

None is caught by any automated stage — all are checked by reading frames.

- **Transcript wording drives the sidebar's red "NEEDS YOU" tier.** The app
  derives a pane's attention state from its raw output
  (`src/features/terminals/logic/process-attention.ts`): `continue?`, `y/n`,
  `error:`, `failed` or `exception` in ANY chunk raises `actionRequired` on
  that process. While the pane is on screen in the active worktree the
  recorder's own viewing clears it, so it only becomes visible AFTER the
  storyboard switches worktrees — i.e. exactly in the closing tableau and the
  poster. This is why `demo-tests.jsonl` reports `0 skipped` rather than a
  vitest-realistic `0 failed`. Grep any new transcript line against those five
  patterns.
- **An agent shim that runs out of transcript exits, and its dead session
  flags the worktree.** Agent shims must not loop (a second pass re-emits the
  `commit-line` marker and double-fires the cue — see `stage.ts`), so
  `claude.jsonl` instead has to be long enough to keep emitting past the end
  of the take: the master runs 25s and the poster is captured at master 23s,
  measured from the `fleet-burst` gate opening at master ≈11.2.
- **Accepted limitation — the `feat/checkout-retry` row shows a shell session,
  not claude's provider badge.** That worktree hosts three panes (claude plus
  the two demo shells), and the sidebar row surfaces one summary: attention
  tier first, then recency (`src/features/workspace/logic/sidebar-shell-
summary.ts`). All three are `active` during the establish beat, so recency
  decides, and `dev-server` emits every few tens of ms against claude's
  ~0.6-0.9s cadence — it always wins. Keeping claude alive cannot change this.
  Both apparent fixes are worse than the symptom: re-ranking agents over
  shells is an app behavior change to a shared, test-pinned path made only to
  flatter a video, and quieting `dev-server` removes the dominant motion
  source inside the `[2,4.5]` window. The frame is not misleading — it names
  the genuinely most-recent session — and the three-agent story is carried by
  the AGENTS tab bar and the `claude`-titled pane in the fleet beat.

## Reading a `pnpm hero` run: the stage-A exemption tripwire

Stage A allows **at most one** inter-frame gap per motion window to be exempt
from its 150ms rule, because Chromium's CDP screencast capturer deterministically
drops ~250ms of frames on any in-flow box-geometry relayout — an mcp-status cue
always causes exactly one (spec §7 errata; not app-visible jank, the renderer
holds 60Hz throughout). Every exemption prints a `[stage-A] … exempting one
NNN.Nms gap at t=…` line.

**Read that line on every run.** The errata was measured at 249–270ms. An
exempted gap materially outside that ~250–270ms band, or **any** exemption
appearing in the `[21,23]` window, is a different defect wearing the errata's
clothes: re-investigate it, do not accept the run. Never widen the band, the
≤400ms ceiling, or the `[t-0.05s, t+0.35s]` cue window to make a new gap fit —
see the tripwire comment on the exemption in `record.ts`.

## Delivering to ai-creed

After a `pnpm hero` run passes stage B, hand off the three files ai-creed
consumes — copy them into the ai-creed repo (destination path is defined on
the ai-creed side, not here):

```bash
cp hero-dist/tour.mp4 hero-dist/poster.png hero-dist/storyboard.json <ai-creed-destination>/
```

`tour.mp4` and `poster.png` are the assets that render on the homepage;
`storyboard.json` travels with them as provenance, not for direct display.
