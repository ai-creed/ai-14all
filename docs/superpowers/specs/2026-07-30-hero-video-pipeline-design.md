# Hero-video fixture pipeline — design spec

- **Date:** 2026-07-30
- **Status:** validated design, awaiting implementation plan
- **Origin:** ai-creed landing-redesign handoff (`~/.ai-pref-nsync/local-docs/ai-14all/brainstorm/2026-07-29-hero-video-e2e-fixture-handoff.md`)
- **Canonical copy:** `~/.ai-pref-nsync/local-docs/ai-14all/specs/2026-07-30-hero-video-pipeline-design.md`
- **Repo mirror:** `docs/superpowers/specs/2026-07-30-hero-video-pipeline-design.md`

## 1. Purpose & scope

Build a deterministic, fixture-driven recording pipeline that produces the ai-creed
homepage hero video by running ai-14all in e2e mode — replacing manual screen
recording. One storyboard drives both the staged in-app events and the camera, so
event↔camera sync is exact by construction, content is staged by construction, and
regeneration after a UI change is **one command** (`pnpm hero`).

**In scope:** the hero tour per storyboard "Fleet-tight" (§5), the recorder, the
master/poster/storyboard artifacts, and the tour render (which moves into this repo).
**Out of scope:** an insights-dashboard clip (explicit follow-up — the pipeline is
storyboard-parameterized so a second storyboard reuses everything), CI integration
(never — capture is a local-only concern, like the visual-baseline suite), and the
play-ring poster overlay (stays in ai-creed).

## 2. Validated feasibility (spike, 2026-07-30)

Live spike against `out/main/index.js` with `AI14ALL_E2E=1`, hidden window, macOS
(spike scripts archived at
`~/.ai-pref-nsync/local-docs/ai-14all/misc/hero-video-spikes/`; findings recorded as
memory `mem-2026-07-30-high-res-60fps-video-capture-of-the-app-98fe99`):

| Question | Result |
| --- | --- |
| CDP screencast frame rate | ~60fps sustained (jpeg, everyNthFrame:1, ack per frame), window **hidden** |
| Frame resolution | Screencast emits CSS-pixel frames; `Emulation.setDeviceMetricsOverride` `deviceScaleFactor:2` is **ignored** by screencast (`maxWidth`/`maxHeight` don't help) |
| The working recipe | Emulate 2880×1520 viewport at DSF 1 + `webContents.setZoomFactor(2)` → 1440×760 logical layout rendered 2× → **2880×1520 frames @ 60fps**, visually crisp (frame inspected) |
| Poster path | CDP `Page.captureScreenshot` **does** honor DSF 2 → 2880×1520 stills |
| Cursor | Screencast composites the page only — no OS cursor ever appears; automation clicks are invisible |
| Fallback | `page.screenshot` loop ≈ 33 ms/shot (not needed) |
| CFR 60 derivation | verified: spike frames re-encoded to an 8 s, 480-frame CFR-60 master (~60 Hz source cadence maps 1:1 — no judder) |
| Known hiccup | One ~267 ms frame gap right after screencast start → mitigated by a ≥1 s warmup with pre-t0 frames discarded |

Capture geometry is fully emulated: output is independent of the machine's display
size and DPR. **No app-code change is needed for window geometry.**

## 3. Consumer contract (confirmed back to ai-creed)

The handoff contract holds, with deltas marked:

- **Master:** 2880×1520 (the contract's own example geometry; ≥2600 px ✓), constant
  **60 fps**, stable staged layout, no OS chrome/cursor, silent. **Deltas:** produced
  DPR-independently via emulation — any Mac yields identical output; frame rate
  raised from the handoff's 30 fps to 60 fps for production smoothness (capture is
  ~60 Hz natively; 30 fps stays trivially derivable if ever needed).
- **Content:** three agents visible as claude · codex · ezio; one working / one
  ready / one waiting on camera; an inline-review moment; claims-safe transcripts (§9).
- **Storyboard:** `storyboard.json` with **as-executed** timestamps (plus measured
  camera-target rects and provenance, §7) — a superset of the agreed `[{t, beat, note}]`.
- **Poster:** 2880×1520 PNG of the staged hero state; ai-creed bakes the play ring.
- **Durations:** exact-length take — 25 s master = 2 s lead-in + 21 s tour + 2 s tail
  (clock model, §5). Total retained margin is 4 s, within the handoff's required
  "tour length + 2–4 s" — no amendment needed. (Open question 6 resolved: no ambient
  take; sync is the point.)
- **Tour (delta):** encode ceiling raised from the handoff's ≤3–4 MB to **≤5 MB** at
  60 fps; click-to-play `preload="none"` keeps the tour outside ai-creed's
  pre-interaction byte budget (only the poster counts against it).
- **Delta:** the zoompan tour render moves into this repo; ai-creed's `gen-tour.mjs`
  retires. ai-creed receives finished `tour.mp4` + `poster.png` + `storyboard.json`.

## 4. Architecture

```
scripts/hero/                      (committed)
  storyboard.ts        beat list: {beat, holdSec, target, events[], motionWindows[]}
                       — the contract; motionWindows declare where continuous
                       paint is expected (used by validation, §7)
  transcripts/*.jsonl  per-agent scripted output: {delayMs, text, marker?}
  agent-player.mjs     generic transcript player; claude/codex/ezio are PATH shims
  record.mts           `pnpm hero:record`
  render.mts           `pnpm hero:render`
  validate.mts         `pnpm hero:validate` — full produced-artifact guard (§7 stage B)
  gen-camera.ts        pure fn: as-executed storyboard → ffmpeg zoompan filter

hero-dist/                         (gitignored)
  frames/…             raw screencast JPEGs + timestamps
  master.mp4           2880×1520, CFR 60fps, 25 s
  storyboard.json      as-executed timestamps + measured rects + provenance
  poster.png           2880×1520 hero-state still
  tour.mp4             1600×844 @ 60fps, ~21 s, ≤5 MB, silent, faststart
```

`hero:record` = stage → arrange → record → source-level checks (§7 stage A) →
encode master + poster + storyboard. `hero:render` = storyboard + master → tour.
`hero:validate` = the produced-artifact guard (§7 stage B) over `master.mp4`,
`tour.mp4`, `poster.png`, and `storyboard.json` — it runs only once every artifact
exists. **`pnpm hero`** = record → render → **validate**, the canonical regeneration
path: one command yields every final deliverable *and* proves it against the
contract, satisfying the handoff's one-command repeatability requirement; the
sub-commands exist for iterating on a single stage. All local-only pnpm scripts;
the recorder is a standalone node script using `@playwright/test`'s `_electron` —
deliberately **not** a Playwright spec and not under `tests/e2e/` (a new e2e spec
first meets CI inside a release run — recorded gotcha
`mem-2026-07-22-new-e2e-specs-first-meet-ci-at-release-e824bb`).

Two structural moves kill the prototype's flaws:

1. **As-executed storyboard.** The fixture logs the real timestamp of every event and
   the measured `boundingBox()` of every camera target; `gen-camera.ts` derives
   keyframes from those. Scheduling jitter and UI drift cannot desync camera from
   content, and no rect is ever eyeballed.
2. **Emulated geometry.** 1440×760 logical @ 2× zoom → 2880×1520, machine-independent.

## 5. Storyboard "Fleet-tight" & staging

Tour ≈ 21 s (4 stops). Holds ~3 s, eased glides ~2 s. Cue events fire ~0.5 s after
the camera settles; each event's exact cue target (settle instant + 0.5 s) is
declared in `storyboard.ts`, and §7 asserts execution within the handoff's accepted
jitter of ±0.2 s.

**Clock model (explicit):** four named instants govern all timing —

- **Warmup** (discarded): screencast starts ≥1 s before master-zero purely to absorb
  the start-up frame hiccup (§2); warmup frames are dropped and are *not* the lead-in.
- **Master-zero (M0)** = first retained frame. Every storyboard timestamp is
  normalized to master-relative seconds against M0's wall-clock time via the clock
  calibration defined below.
- **Tour-zero (T0)** = M0 + 2.0 s retained lead-in. Beats (table below) are scheduled
  and expressed in tour time.
- **Tail** = 2.0 s retained after the last beat → master duration = 2.0 + 21 + 2.0 =
  **25 s**, all retained content — 4 s total margin, within the handoff contract's
  "tour length + 2–4 s".

**Clock domains & calibration — one authoritative clock.** The authoritative event
clock is the **recorder's wall clock** (`Date.now()`, Unix epoch ms). Events need no
cross-process calibration: MCP status calls and the review-seam hook are stamped by
the recorder itself at dispatch, and shim markers are stamped by `agent-player.mjs`
with the same system wall clock (same machine, same clock — sidecar and recorder
read identical time). The only foreign domain is CDP frame timestamps, whose
protocol origin (TimeSinceEpoch vs arbitrary-origin MonotonicTime) is deliberately
**not assumed**: during warmup the recorder records `(cdpTimestamp,
wallClockAtReceipt)` for every discarded frame and takes the **median** of
`wall − cdp·1000` as a constant offset (local-pipe receipt latency is small and
bounded; the median rejects outlier frames; if CDP already emits epoch time the
offset is simply ≈ 0 — one mechanism covers both protocol variants). That offset
places M0 on the wall clock, normalizing every event; frame **durations** continue
to use raw CDP differences, where any offset cancels exactly. The run **fails** if
the calibration residual spread exceeds 50 ms, and `storyboard.json` provenance
records `clockOffsetMs` and `clockResidualMs`.

**Timestamp semantics.** Every event timestamp is **dispatch time** — the instant
the recorder issues the MCP call or invokes the seam hook, or the shim writes the
marker line to stdout. Visibility follows within a bounded budget (≤ 100 ms: 16 ms
terminal output batching + renderer paint + IPC forwarding), an order of magnitude
inside the ±0.5 s cue placement and 3 s holds — dispatch-time sync cannot visibly
desynchronize the camera, and the §7 cue-window assertions prove each event landed
in its beat on the calibrated clock.

`storyboard.json` stores master-relative event times plus `tourOffset: 2.0` and the
tour duration; `hero:render` trims the master to [T0, T0 + 21 s] and `gen-camera.ts`
emits keyframes in tour time — so master↔tour mapping is a single recorded offset,
never an inference.

Beat table (tour time):

| Tour t | Beat | Camera target (measured rect) | On-cue event |
| --- | --- | --- | --- |
| 0–2.5 | establish | full frame | three terminals already streaming; dots: claude working, codex working, ezio working |
| 4.5–7.5 | sidebar | sidebar pane | **ezio flips to waiting** ("needs you") via MCP `report_session_status` |
| 9.5–12.5 | fleet | multi-slot terminal grid | claude's stream hits its **tests-pass + commit line** (stub marker) |
| 14.5–17.5 | review | review surface with codex's diff | **inline comment pops in** via the seam; comments chip ticks 0→1 |
| 19.5–21 | pull back | full frame | **codex flips to ready** → closing tableau: one working / one ready / one waiting |

**Poster:** full-frame still right after pull-back (mixed dots, rich terminals,
visible comment thread).

**Demo repo.** Product-neutral small TypeScript project, created fresh per run by
extending the `tests/e2e/fixtures/create-test-repo.ts` fixture. Three worktrees —
own branch, own terminal, matching the hero copy: `feat/checkout-retry` (claude),
`fix/cart-badge-count` (codex; carries the ~10-line diff the review beat shows),
`docs/api-examples` (ezio). Workspace opens via seeded `workspace-state.json`
(`AI14ALL_WORKSPACE_STATE_PATH`), not UI clicks. Theme pinned **dark** via seeded
settings in the isolated `AI14ALL_USER_DATA_PATH` (one-line change if ai-creed wants
another).

**Stub agents.** One generic `agent-player.mjs`; `claude`/`codex`/`ezio` are thin
PATH shims (temp dir prepended to PATH; `AI14ALL_FAKE_AGENT_CLIS=claude,codex,ezio`
so the capability probe reports them found). Each shim prints its OSC-0 title so the
app classifies the provider (badge appears), then plays its transcript JSONL. Lines
with `marker` also append `{marker, timestamp}` to a sidecar file
(`HERO_MARKS_PATH`) — how terminal moments enter the as-executed storyboard exactly.
Transcripts are sized to stream through the whole take.

**Status driver.** The recorder connects an MCP client over Streamable HTTP (port
from `<userData>/ai-14all/mcp-port`, the `session-attention.spec.ts` pattern) and
calls `report_session_status` at cue times. Bridge readiness is polled to completion
during arrange, so cue-time calls land instantly.

**Review seam — the only app-code change.** Under `AI14ALL_E2E=1`, main registers
`globalThis.__AI14ALL_E2E_HOOKS__.injectReviewComment(payload)` (same global-hook
pattern as `__AI14ALL_E2E_OPEN_EXTERNAL_CALLS__`). The hook is a small factory,
`makeInjectReviewComment(reviewCommentService)`, and it calls the real
**`ReviewCommentService.create()`** (`services/review/review-comment-service.ts`) —
the exact method the UI's `REVIEW_CREATE` IPC handler invokes — so the service
persists through its store and fires its `"created"` change event, which the existing
main→renderer forwarding turns into a live UI update. (`ReviewCommentStore` alone is
load/save only and cannot create or notify — the store is explicitly *not* the seam's
target.) Registration onto the global is a one-liner in main composition; the
recorder invokes the hook at cue time via `electronApp.evaluate()`. Test-first at the
service layer (§8).

**Arrange phase (off camera, every step polled-till-ready with a timeout):** window
ready → workspace restored with 3 worktrees → multi-slot layout preset applied →
agents started in their shells via `terminals.sendInput` → provider badges confirmed
→ MCP bridge ready → review diff surface open → screencast warmup → beat clock t0.

## 6. Capture, encode, render, poster

- **Capture:** CDP `Page.startScreencast`, JPEG **quality 95**, ack every frame.
  Window stays hidden; run wrapped in `caffeinate -dims`. Screencast starts ≥1 s
  before M0; only warmup frames (pre-M0) are discarded — the 2 s lead-in after M0 is
  retained master content, per the clock model in §5. Rationale for q95:
  the deepest stop upscales a ~985 px-wide crop to the 1600 px output (~1.6×), so
  master artifacts get magnified — verified visually at implementation (§10).
- **Master encode:** frames + CDP timestamps → ffmpeg concat-with-durations →
  `fps=60` CFR, libx264 crf ~17, yuv420p. Sparse frames during static holds are
  correct by the duration model (last frame persists); dips below 60 Hz paint rate
  duplicate the prior frame.
- **Render:** `gen-camera.ts` (pure) ports the prototype generator's ffmpeg facts —
  `zoompan` not `crop` (only x/y are per-frame in crop); no `t` var in zoompan → use
  `in/FPS`; interpolate view **width** (not zoom factor) for constant-feeling motion;
  even output dims for yuv420p — and adds **aspect normalization**: measured pane
  rects are grown to the output aspect (~1.893) with margin and clamped to frame, so
  nothing letterboxes. Output: 1600×844 @ **60 fps**, crf ~27–28, `+faststart`,
  `-an`, target ≤5 MB (click-to-play `preload="none"` keeps the tour outside
  ai-creed's pre-interaction byte budget; only the poster counts against it).
- **Poster:** CDP `captureScreenshot` PNG under DSF 2 → true 2880×1520.

## 7. Determinism & failure handling

- Every arrange gate polls with a timeout; on timeout the run aborts with a specific
  error and non-zero exit. A run costs ~90 s — the retry model is "run it again."
- **Validation is two-staged, and success is gated at both points:**
  - **Stage A — source checks, inside `hero:record` before any encoding** (so a bad
    take fails fast): source cadence only inside motion windows declared in
    `storyboard.ts` (streaming-terminal intervals and each **stream-backed** cue
    moment ± 1 s — the status flips and the marker burst; the review-inject cue is
    UI-mutation-backed against a static diff surface, so it carries no cadence
    window — its sync is proven by the ±0.2 s cue assertion in stage B plus the
    pre/post acceptance frames) — no inter-frame gap > 150 ms and mean cadence
    ≥ 30 Hz there; static intervals outside motion windows are sparse by design
    (§6) and exempt. Marker completeness
    and camera-rect measurement are also asserted here, as is the clock-calibration
    residual gate (§5: spread ≤ 50 ms) — all before any encoding.
  - **Stage B — produced-artifact guard, `hero:validate`, the final step of
    `pnpm hero`** (runs only once all four artifacts exist; also runnable
    standalone):
    - **master.mp4** (ffprobe): 2880×1520, exactly CFR 60, duration 25 s ± 0.5 s,
      `yuv420p`, zero audio streams.
    - **tour.mp4** (ffprobe + file probe): 1600×844, exactly CFR 60, duration 21 s
      ± 0.5 s, no audio stream, ≤ 5 MB, and faststart verified (`moov` atom precedes
      `mdat`).
    - **poster.png**: PNG format, exactly 2880×1520.
    - **storyboard.json — exact clock/schema contract, not field presence:**
      `tourOffset === 2.0` (the storyboard's declared lead-in) and declared tour
      duration `=== 21`; every event timestamp finite, ≥ 0, ≤ master duration
      (proving master-relative normalization on the calibrated clock, §5), and each
      cue event's calibrated dispatch time within **±0.2 s of its declared cue
      target** (the beat's camera-settle instant + 0.5 s, declared per event in
      `storyboard.ts` — the handoff's accepted jitter): a cue that lands inside its
      beat but outside this tolerance **fails**. This is the real-run proof that
      marker, status, and review events from all three sources land on target, not
      merely somewhere in the beat; every expected marker present; every camera-target
      rect finite with positive width/height and fully inside the 2880×1520 frame;
      provenance complete (app version, git SHA, record date, `clockOffsetMs`,
      `clockResidualMs`).
  Any miss at either stage → non-zero exit, artifacts kept for inspection.
- **Provenance:** `storyboard.json` records app version, git SHA, and record date, so
  any asset shipped to ai-creed traces back to what produced it.
- Relative-time labels in the UI ("2m ago") read small and plausible because every
  run starts from a fresh staged state; accepted as-is.

## 8. Testing strategy

TDD where there is real logic; nothing new under `tests/e2e/`:

- **Review seam** — vitest test written first against the real `ReviewCommentService`
  wired to a temp-dir store: `makeInjectReviewComment()` calls `create()` and the
  `"created"` change event is observed through a real listener subscription — no
  mocked events, and the load/save-only `ReviewCommentStore` is explicitly not the
  test target. The one-line env-gated registration in main composition is exercised
  by the recorder run itself.
- **`gen-camera.ts`** — unit tests: keyframe math, aspect normalization, frame
  clamping, golden filter-string test against a known storyboard.
- **Transcript player** — unit tests with fake timers: pacing and marker emission.
- **Clock calibration** — unit tests on the pure calibration function: median offset
  from synthetic `(cdpTimestamp, wallClockAtReceipt)` pairs including outlier frames,
  residual-spread computation, and the ≈ 0-offset epoch-time case. The §7 residual
  gate (≤ 50 ms) plus the stage-B cue-window assertions are the required real-run
  proof of cross-source normalization.
- **Recorder orchestration** — exercised by its own validation pass (§7) plus a real
  run; glue code gets no unit tests.

## 9. Claims-safety checklist (binding, from ai-creed)

- Transcripts show real, shipped product behavior only: generic plausible agent work
  (reading files, test output, a commit). No invented 14all features, no secrets, no
  real paths, no real API output.
- Flagships are **source-available (FSL-1.1-ALv2)** — never described "open source".
- xavier and samantha are out of scope for this video; no whisper workflow-lens
  content on camera.
- Silent video; no audio track.
- Transcript files reviewed against this checklist before a master is accepted.

## 10. Implementation-time verification items

1. **Review surface anatomy** — persistent pane vs expanded overlay in the current
   3-pane layout; the fixture targets whatever the rect probe measures, but the beat
   choreography (what's open when) needs the real affordance confirmed.
2. **JPEG q95 sufficiency** at the deepest zoom stop; if artifacts show, test PNG
   screencast fps before considering other levers.
3. **Multi-slot layout preset** exact ids/testids for a 3-visible-slot arrangement.
4. **Terminal batching** — default 16 ms output coalescing (`AI14ALL_TERMINAL_BATCH_MS`)
   is expected to be fine at reading pace; confirm streaming looks smooth on camera.

## 11. Follow-ups (explicitly deferred)

- **Insights clip** for an ai-creed features section: second storyboard over the same
  pipeline; usage data staged via `AI14ALL_E2E_USAGE_SNAPSHOT`; requires its own
  claims review. Not part of this implementation.
- **Done (2026-07-30):** the §3 contract confirmation and amendments were reported
  back to the ai-creed effort per the handoff's definition of done — see
  `~/.ai-pref-nsync/local-docs/ai-creed/knowledge-references/2026-07-30-hero-video-contract-report.md`.
