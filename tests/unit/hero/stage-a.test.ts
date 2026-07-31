import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type MockInstance,
} from "vitest";

import {
	runStageAChecks,
	type CaptureResult,
	type RetainedFrame,
} from "../../../scripts/hero/record";
import {
	DEFAULT_MARGIN_FRAC,
	type Rect,
} from "../../../scripts/hero/gen-camera";
import {
	FLEET_TIGHT,
	tourToMaster,
	type CameraTarget,
} from "../../../scripts/hero/storyboard";

// ---------------------------------------------------------------------------
// runStageAChecks is the ONLY take-quality gate on the pipeline: stage B probes
// the encoded artifacts and never sees the source frames, so anything this
// function misses ships. Its errata exemption in particular decides whether a
// 250ms hole in the capture is a known Chromium screencast artifact or a real
// defect — branches that were previously verified by reading them.
//
// Every fixture below is the CLEAN capture with exactly ONE thing wrong, so a
// row that fails proves the check it names and nothing else. The clean row
// proves the fixture itself is not accidentally failing for a fourth reason.
// ---------------------------------------------------------------------------

const HZ = 60;
const LAST_FRAME_INDEX = 25.2 * HZ; // master runs 25s + the recorder's 0.2s tail
const EMPTY_JPEG = Buffer.alloc(0);

/** Calibration + M0 chosen so masterSeconds === cdpTimestamp: the clock mapping
 * is `clock.test.ts`'s job, and an identity here keeps every fixture time in
 * this file readable as the master seconds the storyboard talks about. */
const IDENTITY_CAL = { offsetMs: 0, residualSpreadMs: 0 };

/** 60Hz frames across the whole master, minus every frame strictly inside a
 * dropped range. A capture stall presents exactly this way — a contiguous run
 * of frames the screencast never delivered. */
function framesWithDrops(drops: Array<[number, number]>): RetainedFrame[] {
	const frames: RetainedFrame[] = [];
	for (let i = 0; i <= LAST_FRAME_INDEX; i++) {
		const master = i / HZ;
		if (drops.some(([from, to]) => master > from && master < to)) continue;
		frames.push({ cdpTimestamp: master, data: EMPTY_JPEG });
	}
	return frames;
}

/** Replace the frames in `[from, to]` with a coarser uniform grid — a capture
 * that never stalled hard but ran far below 60Hz throughout a window. */
function framesThinned(from: number, to: number, stepSec: number) {
	const frames = framesWithDrops([[from - 1e-9, to + 1e-9]]);
	for (let t = from; t <= to + 1e-9; t += stepSec) {
		frames.push({ cdpTimestamp: t, data: EMPTY_JPEG });
	}
	return frames.sort((a, b) => a.cdpTimestamp - b.cdpTimestamp);
}

/** `count` frames evenly spread across `[from, to]`, with the only surviving
 * neighbours sitting `gapSec` outside each edge. Isolates the edge-anchor
 * question: the window's own cadence and its anchor distances are both exact,
 * so a check that counts the anchors gives a measurably different answer than
 * one that does not. */
function framesJustOutside(
	from: number,
	to: number,
	count: number,
	gapSec: number,
): RetainedFrame[] {
	const frames = framesWithDrops([[from - gapSec * 2, to + gapSec * 2]]);
	const step = (to - from) / (count - 1);
	for (let i = 0; i < count; i++) {
		frames.push({ cdpTimestamp: from + i * step, data: EMPTY_JPEG });
	}
	frames.push({ cdpTimestamp: from - gapSec, data: EMPTY_JPEG });
	frames.push({ cdpTimestamp: to + gapSec, data: EMPTY_JPEG });
	return frames.sort((a, b) => a.cdpTimestamp - b.cdpTimestamp);
}

/** Every storyboard event executed exactly on its nominal master time. */
function onTimeEvents(): Map<string, number> {
	return new Map(
		FLEET_TIGHT.events.map((e) => [e.id, tourToMaster(e.cueTargetTour)]),
	);
}

/** Measured-shaped rects: in bounds, and each a genuine crop once the margin is
 * applied (sidebar 0.177, review 0.587, fleet 0.845 of frame width — the values
 * the real arrange step produces). `full` is deliberately null: no crop. */
const CLEAN_RECTS: Partial<Record<CameraTarget, Rect | null>> = {
	full: null,
	sidebar: { x: 0, y: 40, w: 480, h: 1400 },
	"terminal-grid": { x: 500, y: 40, w: 2296, h: 1400 },
	"review-surface": { x: 900, y: 100, w: 1595, h: 700 },
};

function makeCapture(over: Partial<CaptureResult> = {}): CaptureResult {
	return {
		cal: IDENTITY_CAL,
		frames: framesWithDrops([]),
		M0wall: 0,
		executedMasterById: onTimeEvents(),
		posterCapturedMaster: 23,
		marks: [{ marker: "commit-line", t: 12_000 }],
		...over,
	};
}

let logSpy: MockInstance<typeof console.log>;
beforeEach(() => {
	logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
	logSpy.mockRestore();
});

function exemptionLogs(): string[] {
	return logSpy.mock.calls
		.map((call) => String(call[0]))
		.filter((line) => line.includes("exempting"));
}

// ---------------------------------------------------------------------------

type Row = {
	name: string;
	capture?: Partial<CaptureResult>;
	rects?: Partial<Record<CameraTarget, Rect | null>>;
	/** undefined = must pass with zero errors. */
	expect?: RegExp;
	/** Failing rows assert their error is the ONLY one, so a row can never pass
	 * for a reason it did not intend to test. */
	expectedErrorCount?: number;
};

const ROWS: Row[] = [
	{ name: "a clean 60Hz capture with measured rects passes" },

	// --- the 150ms inter-frame gap rule, and its single errata exemption ------
	{
		// [11,13] holds `commit-line`, kind "marker" — the exemption is scoped to
		// mcp-status relayouts only, so nothing here can be exempted.
		name: "a 250ms gap in a window with no mcp-status cue fails",
		capture: { frames: framesWithDrops([[11.5, 11.75]]) },
		expect:
			/motion window \[11,13\]: max inter-frame gap 250\.0ms exceeds 150ms/,
		expectedErrorCount: 1,
	},
	{
		// `ezio-waiting` (mcp-status) executes at master 7.0; the gap starts at the
		// dispatch instant, which is what the errata describes.
		name: "a 250ms gap at an mcp-status cue is exempted and passes",
		capture: { frames: framesWithDrops([[7.0, 7.25]]) },
	},
	{
		// Exactly one exemption per window: the larger gap is taken, the second
		// still fails even though it qualifies on every other count.
		name: "two qualifying gaps: one exempted, the other still fails",
		capture: {
			frames: framesWithDrops([
				[6.98, 7.16],
				[7.18, 7.34],
			]),
		},
		expect: /motion window \[6,8\]: max inter-frame gap 183\.3ms exceeds 150ms/,
		expectedErrorCount: 1,
	},
	{
		name: "a gap over the 400ms ceiling is never exempted, even at the cue",
		capture: { frames: framesWithDrops([[7.0, 7.5]]) },
		expect: /motion window \[6,8\]: max inter-frame gap 500\.0ms exceeds 150ms/,
		expectedErrorCount: 1,
	},
	{
		// Right of [t-0.05, t+0.35]: t = 7.0, gap starts at 7.4.
		name: "a qualifying-size gap AFTER the cue's exemption window fails",
		capture: { frames: framesWithDrops([[7.4, 7.65]]) },
		expect: /motion window \[6,8\]: max inter-frame gap 250\.0ms exceeds 150ms/,
		expectedErrorCount: 1,
	},
	{
		// Left of [t-0.05, t+0.35]: t = 7.0, gap starts at 6.9.
		name: "a qualifying-size gap BEFORE the cue's exemption window fails",
		capture: { frames: framesWithDrops([[6.9, 7.15]]) },
		expect: /motion window \[6,8\]: max inter-frame gap 250\.0ms exceeds 150ms/,
		expectedErrorCount: 1,
	},
	{
		// The edge-blindness regression (fix wave item 4). A freeze covering ALL
		// of [6,7] leaves 61 untouched frames inside [6,8] at a perfect 60Hz — an
		// inside-the-window-only scan sees a flawless window and PASSES. Anchoring
		// to the last frame at or before the window start turns the freeze back
		// into the one 1016.7ms gap it actually is.
		name: "a freeze straddling the window's leading edge is measured, not skipped",
		capture: { frames: framesWithDrops([[5.99, 7.0]]) },
		expect:
			/motion window \[6,8\]: max inter-frame gap 1016\.7ms exceeds 150ms/,
		expectedErrorCount: 1,
	},

	// --- cadence + coverage ---------------------------------------------------
	{
		// Every gap is 100ms — under the 150ms ceiling, so ONLY the cadence floor
		// can catch this. 10Hz is not a usable capture.
		name: "a window that never stalls but runs at 10Hz fails the cadence floor",
		capture: { frames: framesThinned(11, 13, 0.1) },
		expect: /motion window \[11,13\]: mean cadence 10\.\dHz below 30Hz/,
		expectedErrorCount: 1,
	},
	{
		// The anchors must never PAD the cadence floor. They sit outside the
		// window, so counting them adds two frames while extending the span by
		// less than two frame-intervals: (n+1)/(span+d) > (n-1)/span. Tuned to
		// the band where that difference decides the verdict — 60 frames evenly
		// spread across [11,13] is a true 29.5Hz (fails), but with anchors 5ms
		// outside each edge the padded figure is 30.35Hz (would pass). A window
		// genuinely below the floor must fail no matter how close the neighbours
		// on either side happen to land.
		name: "frames just outside a sub-30Hz window do not lift it over the cadence floor",
		capture: { frames: framesJustOutside(11, 13, 60, 0.005) },
		expect: /motion window \[11,13\]: mean cadence 29\.5Hz below 30Hz/,
		expectedErrorCount: 1,
	},
	{
		name: "a window with fewer than two frames of its own fails on coverage",
		capture: { frames: framesWithDrops([[20.99, 22.99]]) },
		expect: /motion window \[21,23\]: only 1 frame\(s\) captured/,
		expectedErrorCount: 1,
	},

	// --- camera-target rects --------------------------------------------------
	{
		name: "a null camera-target rect fails",
		rects: { ...CLEAN_RECTS, sidebar: null },
		expect: /camera target rect 'sidebar' missing or out of frame bounds/,
		expectedErrorCount: 1,
	},
	{
		name: "a rect running off the right edge of the frame fails",
		rects: {
			...CLEAN_RECTS,
			"review-surface": { x: 2400, y: 100, w: 600, h: 700 },
		},
		expect:
			/camera target rect 'review-surface' missing or out of frame bounds/,
		expectedErrorCount: 1,
	},
	{
		name: "a rect running off the bottom of the frame fails",
		rects: { ...CLEAN_RECTS, sidebar: { x: 0, y: 200, w: 480, h: 1400 } },
		expect: /camera target rect 'sidebar' missing or out of frame bounds/,
		expectedErrorCount: 1,
	},
	{
		name: "a negative-origin rect fails",
		rects: { ...CLEAN_RECTS, sidebar: { x: -1, y: 40, w: 480, h: 1400 } },
		expect: /camera target rect 'sidebar' missing or out of frame bounds/,
		expectedErrorCount: 1,
	},
	{
		name: "a zero-width rect fails",
		rects: { ...CLEAN_RECTS, sidebar: { x: 0, y: 40, w: 0, h: 1400 } },
		expect: /camera target rect 'sidebar' missing or out of frame bounds/,
		expectedErrorCount: 1,
	},
	{
		// In bounds and positive, but 0.957 of the frame width once the margin is
		// applied — a 1.045x "push-in" that renders as a static full-frame shot.
		// This is the defect that once shipped and was caught only by a human.
		name: "an in-bounds rect that spans >0.95 of the frame is not a push-in and fails",
		rects: {
			...CLEAN_RECTS,
			"review-surface": { x: 100, y: 100, w: 2600, h: 700 },
		},
		expect:
			/camera target rect 'review-surface' spans 0\.957 of frame width .* no-op push-in \(ceiling 0\.95\)/,
		expectedErrorCount: 1,
	},

	// --- marker + cue timing --------------------------------------------------
	{
		name: "a missing commit-line marker fails",
		capture: { marks: [] },
		expect: /commit-line marker missing from marks file/,
		expectedErrorCount: 1,
	},
	{
		name: "a cue executed outside ±0.2s fails",
		capture: {
			executedMasterById: new Map([...onTimeEvents(), ["ezio-waiting", 7.3]]),
		},
		expect:
			/event 'ezio-waiting' \(mcp-status\) executed at 7\.300s.*exceeds ±0\.2s/,
		expectedErrorCount: 1,
	},
	{
		name: "an event with no recorded executedMaster fails",
		capture: {
			executedMasterById: new Map(
				[...onTimeEvents()].filter(([id]) => id !== "poster"),
			),
		},
		expect: /event 'poster' has no recorded executedMaster/,
		expectedErrorCount: 1,
	},
];

describe("runStageAChecks", () => {
	it.each(ROWS)("$name", (row) => {
		const result = runStageAChecks(
			makeCapture(row.capture),
			row.rects ?? CLEAN_RECTS,
		);
		if (!row.expect) {
			expect(result.errors).toEqual([]);
			expect(result.ok).toBe(true);
			return;
		}
		expect(result.ok).toBe(false);
		expect(result.errors.join("\n")).toMatch(row.expect);
		expect(result.errors).toHaveLength(row.expectedErrorCount ?? 1);
	});

	// The exemption is silent-by-default machinery that can hide a real defect,
	// so the log line is the operator's only tripwire (see the README section and
	// the comment on the log call). Pin that it fires, once, with the gap it
	// exempted — a future refactor that drops the line takes the tripwire with it.
	it("logs exactly one tripwire line naming the exempted gap and its window", () => {
		const result = runStageAChecks(
			makeCapture({ frames: framesWithDrops([[7.0, 7.25]]) }),
			CLEAN_RECTS,
		);
		expect(result.ok).toBe(true);
		expect(exemptionLogs()).toHaveLength(1);
		expect(exemptionLogs()[0]).toMatch(
			/\[stage-A\] motion window \[6,8\]: exempting one 250\.0ms gap at t=7\.000 \(mcp-status relayout, spec errata\)/,
		);
	});

	it("stays silent when nothing is exempted", () => {
		runStageAChecks(makeCapture(), CLEAN_RECTS);
		expect(exemptionLogs()).toEqual([]);
	});

	// Guards the fixture, not the production code: if the crop-fraction rows ever
	// stop straddling the ceiling (because DEFAULT_MARGIN_FRAC moved), they would
	// silently stop testing anything.
	it("fixture sanity: the clean rects sit under the crop ceiling the margin implies", () => {
		expect(DEFAULT_MARGIN_FRAC).toBe(0.06);
		const fleet = CLEAN_RECTS["terminal-grid"]!;
		expect((fleet.w * (1 + DEFAULT_MARGIN_FRAC)) / 2880).toBeCloseTo(0.845, 3);
	});
});
