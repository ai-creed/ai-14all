import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
	checkMaster,
	checkPoster,
	checkStoryboard,
	checkTour,
	type AsExecutedStoryboard,
	type VideoProbe,
} from "../../../scripts/hero/validate-rules";
import { FLEET_TIGHT } from "../../../scripts/hero/storyboard";

// ---------------------------------------------------------------------------
// Conforming fixtures — each check function must return [] against these.
// Video-probe numbers mirror the real produced hero-dist/master.mp4 (2880x
// 1520, 60/1 CFR, 1500 frames @ 25.000000s, yuv420p, 0 audio streams).
// storyboard fixture values mirror the real hero-dist/storyboard.json shape
// (tourOffset 2, tourDuration 21, per-beat rects, provenance).
// ---------------------------------------------------------------------------

const MASTER_FIXTURE: VideoProbe = {
	width: 2880,
	height: 1520,
	rFrameRate: "60/1",
	avgFrameRate: "60/1",
	framesCount: 1500,
	maxPtsDeltaSec: 1 / 60,
	durationSec: 25,
	pixFmt: "yuv420p",
	audioStreams: 0,
};

const TOUR_PROBE_FIXTURE: VideoProbe = {
	width: 1600,
	height: 844,
	rFrameRate: "60/1",
	avgFrameRate: "60/1",
	framesCount: 1260,
	maxPtsDeltaSec: 1 / 60,
	durationSec: 21,
	pixFmt: "yuv420p",
	audioStreams: 0,
};
const TOUR_SIZE_BYTES_FIXTURE = 4 * 1024 * 1024; // under the 5 MB ceiling
const TOUR_MOOV_BEFORE_MDAT_FIXTURE = true;

const POSTER_FIXTURE = { width: 2880, height: 1520, isPng: true };

const STORYBOARD_FIXTURE: AsExecutedStoryboard = {
	tourOffset: 2.0,
	tourDuration: 21,
	masterDuration: 25.2,
	beats: [
		{ beat: "establish", settleTour: 0, holdSec: 2.5, rect: null },
		{
			beat: "sidebar",
			settleTour: 4.5,
			holdSec: 3,
			rect: { x: 32, y: 32, w: 480, h: 520 },
		},
		{
			beat: "fleet",
			settleTour: 9.5,
			holdSec: 3,
			rect: { x: 548, y: 212, w: 2296, h: 1172.39 },
		},
		{
			beat: "review",
			settleTour: 14.5,
			holdSec: 3,
			rect: { x: 544, y: 104, w: 2304, h: 1416 },
		},
		{ beat: "pullback", settleTour: 19.5, holdSec: 1.5, rect: null },
	],
	events: [
		// cue events: executedMaster === tourOffset + cueTargetTour exactly, i.e.
		// dead on target (delta 0), well inside the ±0.2s handoff tolerance.
		{
			id: "ezio-waiting",
			kind: "mcp-status",
			cueTargetTour: 5.0,
			executedMaster: 7.0,
		},
		{
			id: "commit-line",
			kind: "marker",
			cueTargetTour: 10.0,
			executedMaster: 12.0,
		},
		{
			id: "review-comment",
			kind: "review-inject",
			cueTargetTour: 15.0,
			executedMaster: 17.0,
		},
		{
			id: "codex-ready",
			kind: "mcp-status",
			cueTargetTour: 20.0,
			executedMaster: 22.0,
		},
		// ui-action choreography: declared times, no ±0.2s cue-tolerance check.
		{
			id: "switch-codex",
			kind: "ui-action",
			cueTargetTour: 12.6,
			executedMaster: 14.6,
		},
		{
			id: "open-review",
			kind: "ui-action",
			cueTargetTour: 13.0,
			executedMaster: 15.0,
		},
		{
			id: "codex-burst",
			kind: "ui-action",
			cueTargetTour: 18.5,
			executedMaster: 20.5,
		},
		{
			id: "poster",
			kind: "ui-action",
			cueTargetTour: 21.0,
			executedMaster: 23.0,
		},
	],
	motionWindows: FLEET_TIGHT.motionWindows.map((w) => ({ ...w })),
	provenance: {
		appVersion: "1.9.0",
		gitSha: "cb7f813d48364e50e5efb2a733dbc5485535a1f5",
		recordedAt: "2026-07-30T15:50:24.705Z",
		clockOffsetMs: 34.8,
		clockResidualMs: 15.8,
		posterCapturedMaster: 23.5, // inside 23.0–24.0
	},
};

// never mutate FLEET_TIGHT's arrays in place — copy before any use.
const EXPECTED_FIXTURE = {
	events: [...FLEET_TIGHT.events],
	markers: FLEET_TIGHT.events
		.filter((e) => e.kind === "marker")
		.map((e) => e.id),
};

describe("conforming fixtures pass every check", () => {
	it("checkMaster returns [] for the conforming master probe", () => {
		expect(checkMaster(MASTER_FIXTURE)).toEqual([]);
	});
	it("checkTour returns [] for the conforming tour probe", () => {
		expect(
			checkTour(
				TOUR_PROBE_FIXTURE,
				TOUR_SIZE_BYTES_FIXTURE,
				TOUR_MOOV_BEFORE_MDAT_FIXTURE,
			),
		).toEqual([]);
	});
	it("checkPoster returns [] for the conforming poster", () => {
		expect(
			checkPoster(
				POSTER_FIXTURE.width,
				POSTER_FIXTURE.height,
				POSTER_FIXTURE.isPng,
			),
		).toEqual([]);
	});
	it("checkStoryboard returns [] for the conforming storyboard", () => {
		expect(checkStoryboard(STORYBOARD_FIXTURE, EXPECTED_FIXTURE)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Exhaustive mutation table. Every row mutates exactly one property of a
// conforming fixture and MUST produce >= 1 failure — a single flat loop over
// every target (master/tour/poster/storyboard) so a missing rule can never
// hide behind a category-scoped test file that nobody extended.
// ---------------------------------------------------------------------------

type MutationRow = [name: string, run: () => string[], target: string];

const MASTER_MUTATIONS: MutationRow[] = [
	[
		"width 2560",
		() => checkMaster({ ...MASTER_FIXTURE, width: 2560 }),
		"master",
	],
	[
		"height 1440",
		() => checkMaster({ ...MASTER_FIXTURE, height: 1440 }),
		"master",
	],
	[
		"rFrameRate 30/1",
		() => checkMaster({ ...MASTER_FIXTURE, rFrameRate: "30/1" }),
		"master",
	],
	[
		"avgFrameRate 600/13 (nominal-60 VFR — rFrameRate stays 60/1)",
		() => checkMaster({ ...MASTER_FIXTURE, avgFrameRate: "600/13" }),
		"master",
	],
	[
		"maxPtsDeltaSec 0.2",
		() => checkMaster({ ...MASTER_FIXTURE, maxPtsDeltaSec: 0.2 }),
		"master",
	],
	[
		"framesCount duration*60 - 20",
		() =>
			checkMaster({
				...MASTER_FIXTURE,
				framesCount: MASTER_FIXTURE.durationSec * 60 - 20,
			}),
		"master",
	],
	[
		"duration 27s",
		() => checkMaster({ ...MASTER_FIXTURE, durationSec: 27 }),
		"master",
	],
	[
		"duration 24.4s",
		() => checkMaster({ ...MASTER_FIXTURE, durationSec: 24.4 }),
		"master",
	],
	[
		"pixFmt yuvj420p",
		() => checkMaster({ ...MASTER_FIXTURE, pixFmt: "yuvj420p" }),
		"master",
	],
	[
		"audioStreams 1",
		() => checkMaster({ ...MASTER_FIXTURE, audioStreams: 1 }),
		"master",
	],
];

function runTour(patch: Partial<VideoProbe>): string[] {
	return checkTour(
		{ ...TOUR_PROBE_FIXTURE, ...patch },
		TOUR_SIZE_BYTES_FIXTURE,
		TOUR_MOOV_BEFORE_MDAT_FIXTURE,
	);
}

const TOUR_MUTATIONS: MutationRow[] = [
	["width 1440", () => runTour({ width: 1440 }), "tour"],
	["height 760", () => runTour({ height: 760 }), "tour"],
	["rFrameRate 30/1", () => runTour({ rFrameRate: "30/1" }), "tour"],
	[
		"avgFrameRate 600/13 (nominal-60 VFR — rFrameRate stays 60/1)",
		() => runTour({ avgFrameRate: "600/13" }),
		"tour",
	],
	["maxPtsDeltaSec 0.2", () => runTour({ maxPtsDeltaSec: 0.2 }), "tour"],
	[
		"framesCount duration*60 - 20",
		() => runTour({ framesCount: TOUR_PROBE_FIXTURE.durationSec * 60 - 20 }),
		"tour",
	],
	["duration 20.3s", () => runTour({ durationSec: 20.3 }), "tour"],
	["duration 21.7s", () => runTour({ durationSec: 21.7 }), "tour"],
	["audioStreams 1", () => runTour({ audioStreams: 1 }), "tour"],
	[
		"size 6 MB",
		() =>
			checkTour(
				TOUR_PROBE_FIXTURE,
				6 * 1024 * 1024,
				TOUR_MOOV_BEFORE_MDAT_FIXTURE,
			),
		"tour",
	],
	[
		"moovBeforeMdat false",
		() => checkTour(TOUR_PROBE_FIXTURE, TOUR_SIZE_BYTES_FIXTURE, false),
		"tour",
	],
];

const POSTER_MUTATIONS: MutationRow[] = [
	[
		"isPng false",
		() => checkPoster(POSTER_FIXTURE.width, POSTER_FIXTURE.height, false),
		"poster",
	],
	[
		"width-only 2560x1520",
		() => checkPoster(2560, POSTER_FIXTURE.height, true),
		"poster",
	],
	[
		"height-only 2880x1440",
		() => checkPoster(POSTER_FIXTURE.width, 1440, true),
		"poster",
	],
];

function withEvent(
	id: string,
	patch: Partial<AsExecutedStoryboard["events"][number]>,
): AsExecutedStoryboard {
	const clone = structuredClone(STORYBOARD_FIXTURE);
	const event = clone.events.find((e) => e.id === id);
	if (!event) throw new Error(`fixture has no event '${id}'`);
	Object.assign(event, patch);
	return clone;
}

function withBeatRect(
	beat: string,
	patch: Partial<{ x: number; y: number; w: number; h: number }>,
): AsExecutedStoryboard {
	const clone = structuredClone(STORYBOARD_FIXTURE);
	const b = clone.beats.find((x) => x.beat === beat);
	if (!b?.rect) throw new Error(`fixture beat '${beat}' has no rect`);
	Object.assign(b.rect, patch);
	return clone;
}

function withoutProvenanceField(
	field: keyof AsExecutedStoryboard["provenance"],
): AsExecutedStoryboard {
	const clone = structuredClone(STORYBOARD_FIXTURE);
	Reflect.deleteProperty(clone.provenance, field);
	return clone;
}

const STORYBOARD_MUTATIONS: MutationRow[] = [
	[
		"tourOffset 3.0",
		() =>
			checkStoryboard(
				{ ...STORYBOARD_FIXTURE, tourOffset: 3.0 },
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"tourDuration 20",
		() =>
			checkStoryboard(
				{ ...STORYBOARD_FIXTURE, tourDuration: 20 },
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"event executedMaster 0.35s off its cue target",
		() =>
			checkStoryboard(
				withEvent("ezio-waiting", { executedMaster: 7.35 }),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"event executedMaster: NaN",
		() =>
			checkStoryboard(
				withEvent("commit-line", { executedMaster: Number.NaN }),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"event executedMaster: Infinity",
		() =>
			checkStoryboard(
				withEvent("review-comment", {
					executedMaster: Number.POSITIVE_INFINITY,
				}),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"event executedMaster: -0.1",
		() =>
			checkStoryboard(
				withEvent("codex-ready", { executedMaster: -0.1 }),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"event executedMaster: 26 (> master)",
		() =>
			checkStoryboard(
				withEvent("switch-codex", { executedMaster: 26 }),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"a missing expected event id",
		() =>
			checkStoryboard(
				{
					...STORYBOARD_FIXTURE,
					events: STORYBOARD_FIXTURE.events.filter(
						(e) => e.id !== "ezio-waiting",
					),
				},
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"a missing expected marker (commit-line absent from events of kind marker)",
		() =>
			checkStoryboard(
				withEvent("commit-line", { kind: "ui-action" }),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"rect w: -1",
		() => checkStoryboard(withBeatRect("sidebar", { w: -1 }), EXPECTED_FIXTURE),
		"storyboard",
	],
	[
		"rect h: 0",
		() => checkStoryboard(withBeatRect("sidebar", { h: 0 }), EXPECTED_FIXTURE),
		"storyboard",
	],
	[
		"rect x: -5",
		() => checkStoryboard(withBeatRect("sidebar", { x: -5 }), EXPECTED_FIXTURE),
		"storyboard",
	],
	[
		"rect y: -5",
		() => checkStoryboard(withBeatRect("sidebar", { y: -5 }), EXPECTED_FIXTURE),
		"storyboard",
	],
	[
		"rect x: NaN",
		() =>
			checkStoryboard(
				withBeatRect("sidebar", { x: Number.NaN }),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"rect y: NaN",
		() =>
			checkStoryboard(
				withBeatRect("sidebar", { y: Number.NaN }),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"rect w: NaN",
		() =>
			checkStoryboard(
				withBeatRect("sidebar", { w: Number.NaN }),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"rect h: NaN",
		() =>
			checkStoryboard(
				withBeatRect("sidebar", { h: Number.NaN }),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"rect h: Infinity",
		() =>
			checkStoryboard(
				withBeatRect("sidebar", { h: Number.POSITIVE_INFINITY }),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"rect x+w > 2880",
		() =>
			checkStoryboard(withBeatRect("sidebar", { w: 2900 }), EXPECTED_FIXTURE),
		"storyboard",
	],
	[
		"rect y+h > 1520",
		() =>
			checkStoryboard(withBeatRect("sidebar", { h: 1600 }), EXPECTED_FIXTURE),
		"storyboard",
	],
	[
		"provenance.appVersion deleted",
		() =>
			checkStoryboard(withoutProvenanceField("appVersion"), EXPECTED_FIXTURE),
		"storyboard",
	],
	[
		"provenance.gitSha deleted",
		() => checkStoryboard(withoutProvenanceField("gitSha"), EXPECTED_FIXTURE),
		"storyboard",
	],
	[
		"provenance.recordedAt deleted",
		() =>
			checkStoryboard(withoutProvenanceField("recordedAt"), EXPECTED_FIXTURE),
		"storyboard",
	],
	[
		"provenance.clockOffsetMs deleted",
		() =>
			checkStoryboard(
				withoutProvenanceField("clockOffsetMs"),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"provenance.clockResidualMs deleted",
		() =>
			checkStoryboard(
				withoutProvenanceField("clockResidualMs"),
				EXPECTED_FIXTURE,
			),
		"storyboard",
	],
	[
		"posterCapturedMaster 24.6 (outside 23.0–24.0)",
		() => {
			const clone = structuredClone(STORYBOARD_FIXTURE);
			clone.provenance.posterCapturedMaster = 24.6;
			return checkStoryboard(clone, EXPECTED_FIXTURE);
		},
		"storyboard",
	],
];

const ALL_MUTATIONS: MutationRow[] = [
	...MASTER_MUTATIONS,
	...TOUR_MUTATIONS,
	...POSTER_MUTATIONS,
	...STORYBOARD_MUTATIONS,
];

describe("exhaustive mutation table — every row produces >= 1 failure", () => {
	for (const [name, run, target] of ALL_MUTATIONS) {
		it(`[${target}] ${name}`, () => {
			expect(run().length).toBeGreaterThanOrEqual(1);
		});
	}
});

// ---------------------------------------------------------------------------
// Real media fixtures — both directions, guarded by ffmpeg/ffprobe
// availability. These are the regression traps for the CFR-by-cadence rule:
// a packet-order (decode-order) probe would get this exactly backwards.
// ---------------------------------------------------------------------------

function ffmpegToolingAvailable(): boolean {
	try {
		execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
		execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

const FFMPEG_AVAILABLE = ffmpegToolingAvailable();
if (!FFMPEG_AVAILABLE) {
	console.warn(
		"[validate-rules.test] ffmpeg/ffprobe not found on PATH — skipping real-media fixture tests",
	);
}

/** Mirrors validate.ts's probeVideo recipe, standalone here so this test file
 * doesn't import scripts/hero/validate.ts (that module calls main() at load
 * time — importing it as a library would run the whole CLI as a side effect). */
function probeRealVideo(path: string): VideoProbe {
	const streamJson = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration,pix_fmt",
				"-of",
				"json",
				path,
			],
			{ encoding: "utf8" },
		),
	) as { streams: Array<Record<string, string>> };
	const stream = streamJson.streams[0]!;

	const ptsOut = execFileSync(
		"ffprobe",
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"frame=pts_time",
			"-of",
			"csv=p=0",
			path,
		],
		{ encoding: "utf8" },
	);
	const ptsTimes = ptsOut
		.split("\n")
		.map((line) => Number.parseFloat(line.split(",")[0] ?? ""))
		.filter((v) => Number.isFinite(v))
		.sort((a, b) => a - b);
	let maxPtsDeltaSec = 0;
	for (let i = 1; i < ptsTimes.length; i++) {
		maxPtsDeltaSec = Math.max(
			maxPtsDeltaSec,
			Math.abs(ptsTimes[i]! - ptsTimes[i - 1]!),
		);
	}

	return {
		width: Number(stream.width),
		height: Number(stream.height),
		rFrameRate: stream.r_frame_rate,
		avgFrameRate: stream.avg_frame_rate,
		framesCount: Number(stream.nb_frames ?? ptsTimes.length),
		maxPtsDeltaSec,
		durationSec: Number(stream.duration),
		pixFmt: stream.pix_fmt,
		audioStreams: 0,
	};
}

/** Only the CFR-cadence portion of checkMaster's verdict — the synthetic
 * fixtures below are tiny (64x64, ~2s), so they will always fail the
 * unrelated width/height/duration/pixFmt checks; that's expected and not
 * what these tests are verifying. */
function cfrFailures(errors: string[]): string[] {
	return errors.filter((e) => e.includes("not exactly CFR 60"));
}

describe.skipIf(!FFMPEG_AVAILABLE)(
	"real media — CFR-by-cadence, presentation vs decode order",
	() => {
		it("a real CFR-60 file WITH libx264 B-frames passes the CFR rule (frame-order, not packet-order)", () => {
			const path = "/tmp/cfr-bframes.mp4";
			execFileSync(
				"ffmpeg",
				[
					"-f",
					"lavfi",
					"-i",
					"testsrc=size=64x64:rate=60",
					"-t",
					"2",
					"-c:v",
					"libx264",
					"-y",
					path,
				],
				{ stdio: "ignore" },
			);

			// Confirm B-frames are actually present — libx264 defaults emit them,
			// but this fixture is only the regression trap it claims to be if that
			// holds.
			const pictTypes = execFileSync(
				"ffprobe",
				[
					"-v",
					"error",
					"-select_streams",
					"v:0",
					"-show_entries",
					"frame=pict_type",
					"-of",
					"csv=p=0",
					path,
				],
				{ encoding: "utf8" },
			);
			expect(pictTypes).toContain("B");

			// The decode-order packet walk is the exact bug this rule guards
			// against: with B-frames present, UNSORTED packet=pts_time deltas run
			// from -0.033s to +0.083s on this very file — that probe would reject
			// a perfectly valid CFR-60 file. Prove it here so a future edit that
			// swaps frame= back to packet= (or drops the sort) fails loudly.
			const packetOut = execFileSync(
				"ffprobe",
				[
					"-v",
					"error",
					"-select_streams",
					"v:0",
					"-show_entries",
					"packet=pts_time",
					"-of",
					"csv=p=0",
					path,
				],
				{ encoding: "utf8" },
			);
			const packetOrderTimes = packetOut
				.split("\n")
				.map((l) => Number.parseFloat(l.split(",")[0] ?? ""))
				.filter((v) => Number.isFinite(v));
			let maxPacketOrderDelta = 0;
			for (let i = 1; i < packetOrderTimes.length; i++) {
				maxPacketOrderDelta = Math.max(
					maxPacketOrderDelta,
					Math.abs(packetOrderTimes[i]! - packetOrderTimes[i - 1]!),
				);
			}
			expect(maxPacketOrderDelta).toBeGreaterThan(0.05); // decode-order noise

			const probe = probeRealVideo(path);
			expect(probe.rFrameRate).toBe("60/1");
			expect(probe.avgFrameRate).toBe("60/1");
			// The presentation-ordered (sorted frame=pts_time) cadence this rule
			// actually measures is tight, unlike the decode-order walk above.
			expect(probe.maxPtsDeltaSec).toBeCloseTo(1 / 60, 3);
			expect(cfrFailures(checkMaster(probe))).toEqual([]);
		});

		it("a nominal-60 VFR file (r_frame_rate=60/1, uneven presentation spacing) fails the CFR rule", () => {
			// The brief's literal recipe (`-vf setpts=... -r 60`) forces ffmpeg's
			// output-side CFR resampler, which normalizes presentation spacing back
			// to a uniform 60fps grid on this ffmpeg build — verified empirically,
			// it does NOT reproduce true unevenness here. `-fps_mode vfr` disables
			// that resampling so the filtered (uneven) PTS survive to the
			// container, which is what the brief's fallback text explicitly
			// allows: "or any recipe that yields r_frame_rate=60/1 with uneven
			// presentation timestamps; verify with ffprobe first."
			const path = "/tmp/vfr-check.mp4";
			execFileSync(
				"ffmpeg",
				[
					"-f",
					"lavfi",
					"-i",
					"testsrc=size=64x64:rate=60",
					"-t",
					"2",
					"-vf",
					"setpts=PTS*(1+0.5*sin(N))",
					"-fps_mode",
					"vfr",
					"-y",
					path,
				],
				{ stdio: "ignore" },
			);

			const probe = probeRealVideo(path);
			expect(probe.rFrameRate).toBe("60/1"); // nominal — the adversarial part
			expect(probe.maxPtsDeltaSec).toBeGreaterThan(0.05); // genuinely uneven
			expect(cfrFailures(checkMaster(probe)).length).toBeGreaterThanOrEqual(1);
		});
	},
);
