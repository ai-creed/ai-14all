import { describe, expect, it } from "vitest";
import {
	CUE_TOLERANCE_SEC,
	FLEET_TIGHT,
	MASTER_DURATION,
	TOUR_DURATION,
	TOUR_OFFSET,
	tourToMaster,
} from "../../../scripts/hero/storyboard";

describe("FLEET_TIGHT storyboard", () => {
	// Pin every field of every beat, not just the names and settle times. A
	// wrong `target` reframes the whole video and NOTHING else catches it:
	// stage A measures rects per CameraTarget rather than per beat, and stage B
	// only rect-checks non-null beats — so a beat pointed at the wrong surface
	// produces a green pipeline and the wrong film. `holdSec` is equally
	// unguarded: it feeds the render's dwell, and only the establish beat's is
	// read back anywhere else in this file.
	it("pins all five spec beats — order, settle, hold, and camera target", () => {
		expect(FLEET_TIGHT.beats).toEqual([
			{ beat: "establish", settleTour: 0, holdSec: 2.5, target: "full" },
			{ beat: "sidebar", settleTour: 4.5, holdSec: 3, target: "sidebar" },
			{ beat: "fleet", settleTour: 9.5, holdSec: 3, target: "terminal-grid" },
			{
				beat: "review",
				settleTour: 14.5,
				holdSec: 3,
				target: "review-surface",
			},
			{ beat: "pullback", settleTour: 19.5, holdSec: 1.5, target: "full" },
		]);
	});

	it("every CUE event target is its beat settle + 0.5 and inside the tour", () => {
		const cues = FLEET_TIGHT.events.filter((e) => e.kind !== "ui-action");
		expect(cues.map((e) => e.id)).toEqual([
			"ezio-waiting",
			"commit-line",
			"review-comment",
			"codex-ready",
		]);
		for (const e of cues) {
			const beat = FLEET_TIGHT.beats.find((b) => b.beat === e.beat)!;
			expect(e.cueTargetTour).toBeCloseTo(beat.settleTour + 0.5, 6);
			expect(e.cueTargetTour).toBeLessThan(TOUR_DURATION);
		}
	});

	it("declares the review choreography and poster ui-actions at their times", () => {
		const ui = Object.fromEntries(
			FLEET_TIGHT.events
				.filter((e) => e.kind === "ui-action")
				.map((e) => [e.id, e.cueTargetTour]),
		);
		// switch to the codex worktree and open its diff DURING the fleet→review
		// glide (12.5–14.5), so the surface is settled before the camera lands;
		// codex-burst opens codex's transcript gate so its slot streams through
		// the pullback motion window; poster fires at the pullback boundary.
		expect(ui).toEqual({
			"switch-codex": 12.6,
			"open-review": 13.0,
			"codex-burst": 18.5,
			poster: 21.0,
		});
	});

	// Pin the motion-window SET exactly — count and bounds — not just coverage.
	// A coverage-only assertion is satisfied by a single {0,25} window, which
	// would make stage A's cadence gate meaningless AND leave the deliberate
	// ABSENCE of a {16,18} window unpinned. That absence is the spec errata
	// (b411676b): review-inject mutates a static diff surface, so there is no
	// cadence to measure there; its sync is proven by stage B's ±0.2s cue
	// assertion instead. Adding a {16,18} window would fail this test, which is
	// the point — it should be a deliberate spec change, not a drive-by edit.
	it("declares exactly the four spec motion windows, and no window for review-inject", () => {
		expect(FLEET_TIGHT.motionWindows).toEqual([
			{ startMaster: 2, endMaster: 4.5 },
			{ startMaster: 6, endMaster: 8 },
			{ startMaster: 11, endMaster: 13 },
			{ startMaster: 21, endMaster: 23 },
		]);
		const reviewInject = FLEET_TIGHT.events.find(
			(ev) => ev.kind === "review-inject",
		)!;
		const m = tourToMaster(reviewInject.cueTargetTour);
		expect(
			FLEET_TIGHT.motionWindows.some(
				(w) => w.startMaster <= m && w.endMaster >= m,
			),
		).toBe(false);
	});

	it("declares a motion window covering every STREAM-BACKED cue target ±1s, inside the master", () => {
		// mcp-status flips repaint the sidebar and the marker rides a token burst;
		// review-inject mutates a static diff surface — no cadence window (spec §7).
		const streamBacked = FLEET_TIGHT.events.filter(
			(ev) => ev.kind === "mcp-status" || ev.kind === "marker",
		);
		for (const e of streamBacked) {
			const m = tourToMaster(e.cueTargetTour);
			const hit = FLEET_TIGHT.motionWindows.some(
				(w) => w.startMaster <= m - 1 + 1e-9 && w.endMaster >= m + 1 - 1e-9,
			);
			expect(hit, `no motion window for ${e.id}`).toBe(true);
		}
		for (const w of FLEET_TIGHT.motionWindows) {
			expect(w.startMaster).toBeGreaterThanOrEqual(0);
			expect(w.endMaster).toBeLessThanOrEqual(MASTER_DURATION);
		}
		// the establish beat REQUIRES already-streaming terminals (spec §5 beat
		// table) — a motion window must span the whole beat so a frozen opening
		// fails stage A instead of slipping past a single acceptance still
		const est = FLEET_TIGHT.beats[0];
		const estStart = tourToMaster(est.settleTour);
		const estEnd = tourToMaster(est.settleTour + est.holdSec);
		expect(
			FLEET_TIGHT.motionWindows.some(
				(w) => w.startMaster <= estStart && w.endMaster >= estEnd,
			),
		).toBe(true);
	});

	it("constants match the spec clock model", () => {
		expect(TOUR_OFFSET).toBe(2.0);
		expect(TOUR_DURATION).toBe(21);
		expect(MASTER_DURATION).toBe(25);
		expect(CUE_TOLERANCE_SEC).toBe(0.2);
	});
});
