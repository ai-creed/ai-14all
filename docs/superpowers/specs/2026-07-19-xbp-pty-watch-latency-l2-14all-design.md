# XBP PTY Watch Latency — ai-14all Child Spec (tail-first + backward serializer + fixture-gen extension)

**Date:** 2026-07-19 · **Status:** approved design, ready for SDD
**Parent:** `2026-07-19-xbp-pty-watch-latency-l2-umbrella-design.md` (normative for serializer semantics, contract, shared-fixture shape — read it first).
**Base:** the shipped PTY-inspect/reflow host on this worktree (`services/pty-inspect/*`, contract v5 = `0.1.0-alpha.4` vendored).

Everything deliverable inside ai-14all: the vendored contract bump to v6, the serializer's tail-first + backward modes with the `cursorBefore`/`moreBefore` backward channel, the `pullRows` arg wiring, host unit tests, and the fixture-generator extension that regenerates the shared fixture. The final `§6 downstream` section is the ai-xavier consumption task (no separate design doc).

---

## 1. Re-vendor contract v6 (`package.json`, `vendor/`)

- Pack the published contract at `0.1.0-alpha.5` from ai-xavier: `pnpm --filter @ai-creed/command-contract build`, then `pnpm --filter @ai-creed/command-contract pack --pack-destination <ai-14all>/vendor/` (produces `ai-creed-command-contract-0.1.0-alpha.5.tgz`). This is the same content published to GitHub Packages; ai-14all builds against the vendored tarball, not the registry (umbrella §3).
- Bump both `file:` references in `package.json` — the `dependencies` entry (line ~40) and the `pnpm.overrides` / resolution entry (line ~88) — from `…alpha.4.tgz` to `…alpha.5.tgz`, then `pnpm install` to relock. Keep the prior tarballs in `vendor/` (the repo retains `alpha.2/3/4`; add `alpha.5` alongside).
- Follow the repo's established vendoring mechanism from the reflow slice (child §1 of the reflow 14all spec). No code consumes the new fields yet at this step — the serializer does, next.

## 2. Serializer: tail-first + backward (`services/pty-inspect/pty-serializer.ts`)

`serializePage` gains awareness of the two new args. Preferred shape: widen the entry point to `serializePage(mirror, args, cap)` where `args = { cursor, tail?, before? }`, branch by mode internally, and share one backward-channel helper — no duplicated `cursorBefore` minting. (Rejected alternative: separate `serializeTail`/`serializeBefore` functions, which duplicate the emission tail-logic.) The caller already ticks + honors the reset barrier (`pullRows`, §3).

Absolute window (unchanged): `first = mirror.trimmedBefore`, `last = first + mirror.buffer.length − 1`.

**Mode dispatch (in order):**

1. `args.before !== undefined` → **Backward**.
2. `args.cursor === null && args.tail !== undefined` → **Tail-first**.
3. else → **Forward** (existing selection verbatim: fresh full snapshot on `cursor === null`, else the `(stamp, line)` delta, sorted, sliced to `cap`).

**Tail-first.**

```
n        = min(args.tail, cap)
startAbs = max(first, last − n + 1)          // empty buffer (last < first) ⇒ no rows
rows     = [startAbs .. last].map(abs => serializeRow(mirror, abs − first, abs))
cursor   = encodeCursor({ epoch: mirror.epoch, watermark: mirror.watermark, line: last })
more     = false
```

The forward cursor resumes live-tail from *now* (max watermark, newest line) so the next `{ cursor }` pull returns only genuinely new ticks — never a re-replay.

**Backward.**

```
tok = decodeCursor(args.before)
if (tok === null || tok.epoch !== mirror.epoch || tok.line <= first)
    rows = []                                 // stale / foreign / nothing older — never an error
else
    startAbs = max(first, tok.line − cap)
    endAbs   = tok.line − 1
    rows     = [startAbs .. endAbs].map(abs => serializeRow(mirror, abs − first, abs))
cursor = encodeCursor({ epoch: mirror.epoch, watermark: mirror.watermark, line: last })   // ignored by the phone; satisfies non-null contract
more   = false
```

**Uniform backward channel** (computed from the emitted `rows` for every mode, then written onto the page):

```
if (mirror.altScreen || rows.length === 0)
    moreBefore  = false
    cursorBefore = undefined
else
    oldest       = min(rows.map(r => r.line))     // = rows[0].line for tail/backward
    moreBefore   = oldest > first
    cursorBefore = moreBefore ? encodeCursor({ epoch: mirror.epoch, watermark: 0, line: oldest }) : undefined
```

`moreBefore` is **always a boolean** on an ok page — the v6 handshake the phone detects on (umbrella §2.2). `cursorBefore` is only set when there is an older page. The backward token reuses `pty-cursor.ts`; `watermark: 0` is a deliberate unused-axis marker on the backward token.

The `PtyRowsPage` type gains `cursorBefore?: string` and `moreBefore?: boolean` to mirror the contract's ok arm.

**Tests** (extend `tests/unit/services/pty-inspect/pty-serializer.test.ts`, using the existing `mirrorWith` helper):

1. **Tail sizing.** A mirror with, e.g., 300 retained rows served with `{ cursor: null, tail: 50 }` returns exactly the newest 50 rows (lines `250..299`), `more: false`, `moreBefore: true`, and a `cursorBefore` that decodes to `{ line: 250 }`.
2. **Tail clamp to cap.** `{ cursor: null, tail: 10_000 }` at `cap: 500` returns the newest 500 rows and `moreBefore: true` (older history remains above).
3. **Tail reaches the top.** `{ tail: N }` with `N ≥ buffer.length` (nothing trimmed, `first = 0`) returns from line 0, `moreBefore: false`, no `cursorBefore`.
4. **Tail forward cursor resumes live-tail.** After the tail page, one more tick that stamps a new line, then a `{ cursor: tailPage.cursor }` pull returns only the newly-stamped row(s) — not a re-replay of the tail window.
5. **Backward chain to exhaustion.** From a tail page's `cursorBefore`, repeated `{ before }` pulls return contiguous descending windows (`[max(first, B−cap) .. B−1]`), each carrying the next `cursorBefore`, until `moreBefore: false` and no `cursorBefore` at the top; the concatenation reconstructs the retained scrollback with no gaps or overlaps.
6. **Backward boundary at `first`.** A `before` token whose `line === first` returns `rows: []`, `moreBefore: false`.
7. **Backward stale/foreign token.** A `before` token with the wrong epoch, and a syntactically forged token, each return `rows: []`, `moreBefore: false`, page epoch = current — never a refusal.
8. **altScreen forces the channel off.** In an alt-screen buffer, tail-first and backward both return `moreBefore: false` and no `cursorBefore`, regardless of retained content.
9. **Forward path regression.** `{ cursor: null }` with no `tail` still returns the full oldest-first snapshot; a resume `{ cursor }` still returns the `(stamp, line)` delta — identical rows/`cursor`/`more` to the pre-L2 serializer. The added `moreBefore`/`cursorBefore` are present but do not alter forward row selection.
10. **v5-shape omission is impossible on a v6 page** (handshake guard): every ok page from this serializer includes `moreBefore` as a boolean (assert the key is present and typed, across tail/backward/forward/altScreen), proving a v6 host never looks like a v5 host to the phone's `moreBefore !== undefined` test.

## 3. Wiring: thread `tail`/`before` through `pullRows` (`services/pty-inspect/pty-subscription-registry.ts`)

- Widen `pullRows(worktreeId, agentId, cursor, opts?: { tail?: number; before?: string })`; pass `{ cursor, tail: opts?.tail, before: opts?.before }` into `serializePage`. The existing `settled()` barrier, post-await re-validate, and `tick()` are unchanged and still run before serialization.
- The capability dispatch site that decodes `PtyRowsArgs` and calls `pullRows` forwards `args.tail` and `args.before`. (Find it via the `ptyRowsCapability` handler registration; it currently passes only `args.cursor`.)

**Tests** (extend `tests/unit/services/pty-inspect/pty-subscription-registry.test.ts`, or the integration lifecycle test):

1. A `pullRows(..., null, { tail: N })` on a live subscription returns a tail page (newest rows, `more: false`, `moreBefore` boolean); the same call with no `opts` returns today's forward snapshot — proving the args are threaded, not dropped.
2. A `pullRows(..., null, { before })` returns the older page addressed by the token.
3. Regression: the existing `pullRows(..., cursor)` lifecycle tests (subscribe → replay → live-delta) stay green with the widened signature.

## 4. Fixture generator extension (`scripts/generate-pty-fixture.ts`, `scripts/pty-fixture-schema.ts`)

- After building the existing forward `pages[]` chain, the generator additionally emits (umbrella §5):
  - `tailPage`: one `serializePage(mirror, { cursor: null, tail: N }, cap)` at a configured `tail` (a new `--tail <n>` CLI flag, default a representative value such as 50).
  - `backwardPages[]`: starting from `tailPage.cursorBefore`, chain `serializePage(mirror, { cursor: null, before }, cap)` following each response's `cursorBefore` until `moreBefore === false` (or a fixed safety bound on iterations).
- Output shape becomes `{ subscribe, pages, tailPage, backwardPages }` — additive; `pages` is unchanged so the reflow smoke test keeps working.
- Extend `scripts/pty-fixture-schema.ts`: validate `tailPage` via the `{ ok: true, ...tailPage }` envelope against the vendored `PtyRowsResult`, and each `backwardPages[i]` the same way. Keep `subscribe`/`pages` validation intact.
- Deterministic for a given byte file + geometry + `--tail` (assert with a small sample).

**Tests** (extend `tests/unit/services/pty-inspect/` generator coverage):

1. A sample ANSI byte string long enough to trim (> viewport) → generated JSON passes the extended artifact schema (and therefore the vendored v6 contract via the envelope).
2. `tailPage` carries the newest `tail` rows and a `cursorBefore`; `backwardPages` chain via `cursorBefore`/`before` and terminate at `moreBefore: false`; concatenating `backwardPages` (oldest-first) then `tailPage` reconstructs the retained rows with no gap/overlap.
3. Determinism: two runs on the same bytes + geometry + `--tail` produce byte-identical JSON.

## 5. Fixture artifact

- Regenerate `tests/fixtures/pty-real-session.json` via §4 at the desktop's actual geometry (reuse the byte sample the reflow slice used, or capture per reflow umbrella §6.1). Commit the regenerated JSON; the raw bytes file is **not** committed (operator reviews the JSON for anything sensitive before commit).
- If no real capture is practical during the SDD run, regenerate from the representative recorded byte sample and note in the handback that a real capture should replace it later (`mem-2026-07-18` parked item) — the artifact path and schema stay identical.

## 6. Downstream (ai-xavier — separate SDD, sequenced after this one)

Not committed from the ai-14all mount. Spelled out here so the umbrella's e2e obligation is unambiguous:

- Copy the regenerated `tests/fixtures/pty-real-session.json` to `ai-xavier/apps/phone/tests-render/fixtures/pty-real-session.json` (byte-identical).
- Extend the phone smoke test (`apps/phone/tests-render/terminal-smoke.test.tsx`) to feed the fixture's `tailPage` + `backwardPages` through the mocked session API into the real consumer and assert: tail-first entry renders the newest rows and reports the backward channel (`hasBackfillChannel`), and scroll-up backfill applies `backwardPages` in order, growing the transcript upward until `moreBefore: false` clears the affordance.
- No phone runtime change — the L2 consumer shipped in the phone leg; this is test-only.

## 7. Definition of done (ai-14all scope only)

- Contract vendored at `0.1.0-alpha.5` (v6); `pnpm install` relocked; all pre-existing pty-inspect/reflow suites (unit + integration lifecycle) still green.
- Serializer implements tail-first + backward + the uniform backward channel per §2 with all ten test cases green — including the altScreen-off guard (§2.8), the stale-token graceful-empty (§2.7), the forward regression (§2.9), and the handshake guard (§2.10).
- `pullRows` threads `tail`/`before` (§3) with the regression suite green.
- Fixture generator emits `tailPage`/`backwardPages`, the extended artifact schema validates them through the vendored v6 contract, and the regenerated `pty-real-session.json` is committed and valid (§4–§5).
- No phone-side behavior is claimed or tested here; the e2e assertion and joint acceptance happen per umbrella §7 after the ai-xavier downstream SDD lands.
