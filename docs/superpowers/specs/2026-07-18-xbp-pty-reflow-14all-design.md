# XBP PTY Reflow — ai-14all Child Spec (serializer wrap flag + capture tooling)

**Date:** 2026-07-18 · **Status:** approved design, ready for SDD
**Parent:** `2026-07-18-xbp-pty-reflow-umbrella-design.md` (normative for protocol delta, reflow semantics, fixture pipeline — read it first)
**Base:** the shipped PTY Inspect host on this worktree (`services/pty-inspect/*`, contract v4 vendored).

Everything deliverable inside ai-14all: the serializer's `wrapped` flag, the vendored contract bump to v5, the dev-only raw-byte capture tee, and the fixture-generation script plus one committed real-session fixture artifact. The phone consumes all of this via the xavier child spec.

---

## 1. Serializer: emit `wrapped` (`services/pty-inspect/pty-serializer.ts`)

- `serializeRow` additionally reads the buffer line's `isWrapped` flag and emits `wrapped: true` **only when true** (omit when false — keeps payloads lean and matches the optional-field contract).
- Semantics (umbrella §3): `wrapped: true` = this row began as a soft-wrap continuation of the previous buffer line; explicit newlines never set it. This is xterm's own `IBufferLine.isWrapped` — no reimplementation, no heuristics.
- The flag rides through `serializePage` unchanged for both normal and alt-screen buffers; epoch/watermark/cursor/trim behavior is untouched.
- Vendored contract: bump to `@ai-creed/command-contract` `0.1.0-alpha.4` (v5) — one optional field on `PtyRow`; no other schema motion. Follow the repo's established vendoring/update mechanism from the v1 slice.

Tests (extend `tests/unit/services/pty-inspect/pty-serializer.test.ts` using the existing `mirrorWith` helper):

1. A single logical line longer than `cols` (e.g. 200 chars at 80 cols) serializes as row 0 without `wrapped` and rows 1..N with `wrapped: true`.
2. Explicit `\r\n`-separated lines never carry `wrapped`.
3. A wrapped chain that spans a `serializePage` boundary (cap the page below the chain length) carries correct flags on both pages.
4. Styled soft-wrapped content: runs still tile each row's text exactly; the flag adds no run motion.
5. Resize/reflow: after `resize()`, the new epoch's rows carry flags consistent with the new geometry (whatever xterm reflow produced — assert flags match `isWrapped` per line, not a hardcoded layout).
6. Alt-screen buffer rows report their own `isWrapped` (typically false) — no cross-buffer leakage.
7. Compat guard, old host → new phone (umbrella §3): a serialized page containing no `wrapped` key anywhere (v4-shaped payload from unwrapped content) parses against the v5 `PtyRowsResult` schema via the `{ ok: true, ...page }` wire envelope, and every parsed row reports `wrapped` absent — proving the field is genuinely optional in v5.
8. Compat guard, new host → old phone (umbrella §3): a frozen copy of the v4 `pty-rows` success-arm schema — extracted verbatim from the vendored `0.1.0-alpha.3` contract into a test-local fixture module (`tests/unit/services/pty-inspect/fixtures/v4-pty-rows-schema.ts`, provenance comment naming the tarball) — parses an **unmodified** v5 page whose rows include `wrapped: true`, and the parse output has the `wrapped` key stripped. This proves the umbrella's strip-on-parse compatibility claim against the real v4 schema, not against a hand-stripped payload.

## 2. Capture tee (dev-only, `services/terminals/terminal-service.ts`)

- **Configuration is injected, not read from env inside the service.** The terminal service stays Electron-agnostic: it gains an optional `captureDir?: string` construction option (alongside the existing mirrors hook) and never touches `process.env` itself. The gate lives in an exported pure resolver, `resolvePtyCaptureDir({ env, isPackaged }): string | undefined` — returns the dir iff `AI14ALL_PTY_CAPTURE_DIR` is non-empty **and** `isPackaged === false`, else `undefined`. The main-process composition root (`electron/main/ipc.ts`, where `new TerminalService(...)` happens) calls it with `process.env` and `app.isPackaged`. Packaged production builds therefore cannot enable capture even with the env var set — the invariant is enforced by code and unit-testable, not operator discipline.
- When `captureDir` is provided, the existing PTY `onData` feed (the same point that writes into the inspect mirror) also appends the raw bytes to `<dir>/<sessionId>.bytes` (create dir if missing, append mode).
- **Appends are serialized per session.** Each session's tee owns an async append queue (promise chain): a chunk's append is scheduled only after the previous chunk's append settles, so on-disk byte order always equals arrival order even while an earlier write is still pending. Enqueueing is synchronous; the delivery path never awaits the queue — the mirror write stays synchronous and renderer output keeps its existing `OutputBatcher` scheduling (async flush after the batch window), so capture may lag, the terminal never does.
- On append rejection: disable that session's tee (subsequent chunks are dropped with zero further fs calls), log exactly once per session, and leave the PTY, mirror, and renderer delivery untouched.
- `captureDir` absent (the default): zero behavior change, zero file I/O — assert in tests, not by inspection.
- No UI, no settings surface — this is an operator/dev affordance only.

Tests:

1. Service constructed without `captureDir` → writing PTY data performs zero fs calls (spy on the fs surface the tee uses).
2. Resolver gate: `resolvePtyCaptureDir` returns `undefined` when the env var is unset, **and** when it is set but `isPackaged === true`; returns the dir only for env set + `isPackaged === false`. Plus composition: a service constructed with the packaged-mode resolver output performs zero fs calls even with the env var set.
3. Ordering under a pending write (deferred-first-write): stub the first append to return an unresolved promise, deliver chunks `A` then `B` before resolving, then resolve — the capture file receives exactly `AB` in arrival order.
4. Failure path: first append rejects → that session's tee is disabled, subsequent chunks perform no fs calls, the error is logged exactly once, and mirror content plus data delivery are unaffected — assert the mirror write happened synchronously and the chunk was enqueued into the existing `OutputBatcher` unhindered, then observe renderer output after the batcher's normal batch window elapses (its shipped async contract, `output-batcher.ts`), all without awaiting the capture queue.

## 3. Fixture generator (`scripts/generate-pty-fixture.ts`)

- CLI: `--bytes <file> --cols <n> --rows <n> --out <file>`.
- Behavior: construct a real `PtyMirror({cols, rows})`, `write` the byte file, `await drained()`, `tick()`, then chain `serializePage(mirror, cursor)` from `null` until `more: false`, and emit JSON `{ subscribe: { cols, epoch, watermark }, pages: PtyRowsPage[] }` — the exact shape the xavier smoke test consumes (umbrella §6). Elements are stored **without** the `ok: true` wire envelope, matching the host's `PtyRowsPage` value before the subscription registry stamps `{ ok: true }` onto the wire (`pty-subscription-registry.ts`).
- **Validation layer:** the naked sub-shapes cannot parse against the contract capability schemas — `SubscribePtyResult` and `PtyRowsResult` are discriminated unions whose success arms require `ok: true`. Define a dedicated artifact schema (`scripts/pty-fixture-schema.ts`, exported so tests import it) that validates the exact artifact shape by re-adding the envelope: parse `{ ok: true, ...artifact.subscribe }` with the vendored `SubscribePtyResult` and `{ ok: true, ...page }` for every page with the vendored `PtyRowsResult`. The wrapper mirrors exactly what the live registry does on the wire, so artifact validity implies wire validity.
- The script is deterministic for a given byte file + geometry (assert in test with a small sample).
- Tests: sample ANSI byte string → generated JSON passes the artifact schema (and therefore the vendored v5 contract schemas via the envelope); pages chain (`cursor`/`more`) correctly; `wrapped` flags present on soft-wrapped rows in the output.

## 4. Fixture artifact

- Capture one real agent session's bytes via §2 on this machine, generate `tests/fixtures/pty-real-session.json` via §3 at the desktop's actual geometry, and commit it (bytes file itself is NOT committed — it may contain arbitrary session content; the operator reviews the generated JSON before commit for anything sensitive).
- Hand the same JSON to the operator for `ai-xavier/apps/phone/tests-render/fixtures/pty-real-session.json` (file copy is the delivery mechanism; umbrella §6.3).
- If no real session is practical during the SDD run, generate from a representative recorded byte sample and note in the handback that a real capture should replace it — the artifact path and schema stay identical.

## 5. Definition of done

- Serializer emits `wrapped` per §1 with all eight test cases green — including both §1 compat guards (v5-parses-v4-shape, frozen-v4-strips-v5-field); vendored contract at v5; all v1 pty-inspect suites (unit + integration lifecycle) still green.
- Tee provably inert when no `captureDir` is injected **and** under packaged mode with the env var set (resolver gate test §2.2); ordering, single-log failure disable, and never-blocks-terminal verified by the §2 tests, not manual inspection.
- Generator script green and documented (`--help` text suffices); fixture artifact committed and valid against the §3 artifact schema (which parses every element through the vendored v5 contract schemas via the `ok: true` envelope).
- No phone-side behavior is claimed or tested here — joint acceptance happens per umbrella §7 after both repos land.
