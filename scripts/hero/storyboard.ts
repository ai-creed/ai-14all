export type CameraTarget =
	| "full"
	| "sidebar"
	| "terminal-grid"
	| "review-surface";

export type HeroEvent = {
	id:
		| "ezio-waiting"
		| "commit-line"
		| "review-comment"
		| "codex-ready" // cue events
		| "switch-codex"
		| "open-review"
		| "codex-burst"
		| "poster"; // choreography
	kind: "mcp-status" | "marker" | "review-inject" | "ui-action";
	cueTargetTour: number; // cue events: beat settle + 0.5; ui-actions: declared choreography time
	beat: string;
};

export type HeroBeat = {
	beat: "establish" | "sidebar" | "fleet" | "review" | "pullback";
	settleTour: number; // camera settled, tour seconds
	holdSec: number;
	target: CameraTarget;
};

export type MotionWindow = { startMaster: number; endMaster: number }; // master seconds

export const TOUR_OFFSET = 2.0;
export const TOUR_DURATION = 21;
export const MASTER_DURATION = 25;
export const CUE_TOLERANCE_SEC = 0.2;

export const tourToMaster = (t: number): number => t + TOUR_OFFSET;

const beats: HeroBeat[] = [
	{ beat: "establish", settleTour: 0, holdSec: 2.5, target: "full" },
	{ beat: "sidebar", settleTour: 4.5, holdSec: 3, target: "sidebar" },
	{ beat: "fleet", settleTour: 9.5, holdSec: 3, target: "terminal-grid" },
	{ beat: "review", settleTour: 14.5, holdSec: 3, target: "review-surface" },
	{ beat: "pullback", settleTour: 19.5, holdSec: 1.5, target: "full" },
];

const events: HeroEvent[] = [
	// cue events: fire at beat settle + 0.5s (spec §5), inside the tour and
	// within the recorder's ±CUE_TOLERANCE_SEC handoff window (Task 7/8).
	{
		id: "ezio-waiting",
		kind: "mcp-status",
		cueTargetTour: 5.0,
		beat: "sidebar",
	},
	{ id: "commit-line", kind: "marker", cueTargetTour: 10.0, beat: "fleet" },
	{
		id: "review-comment",
		kind: "review-inject",
		cueTargetTour: 15.0,
		beat: "review",
	},
	{
		id: "codex-ready",
		kind: "mcp-status",
		cueTargetTour: 20.0,
		beat: "pullback",
	},
	// ui-action choreography: declared times, not settle-derived. switch-codex
	// and open-review land during the fleet→review glide (12.5–14.5) so the
	// surface is settled before the camera arrives; codex-burst opens codex's
	// transcript gate so its slot streams through the pullback motion window;
	// poster fires at the pullback boundary.
	{
		id: "switch-codex",
		kind: "ui-action",
		cueTargetTour: 12.6,
		beat: "review",
	},
	{ id: "open-review", kind: "ui-action", cueTargetTour: 13.0, beat: "review" },
	{
		id: "codex-burst",
		kind: "ui-action",
		cueTargetTour: 18.5,
		beat: "pullback",
	},
	{ id: "poster", kind: "ui-action", cueTargetTour: 21.0, beat: "pullback" },
];

// Master-second windows covering the establish beat (already-streaming
// terminals required, spec §5 beat table) and each STREAM-BACKED cue
// (mcp-status | marker) ±1s. review-inject mutates a static diff surface —
// no cadence window; its sync is proven by the stage-B ±0.2s cue assertion
// and Task 10's pre/post frames (spec §7 errata).
const motionWindows: MotionWindow[] = [
	{ startMaster: 2, endMaster: 4.5 },
	{ startMaster: 6, endMaster: 8 },
	{ startMaster: 11, endMaster: 13 },
	{ startMaster: 21, endMaster: 23 },
];

export const FLEET_TIGHT: {
	beats: HeroBeat[];
	events: HeroEvent[];
	motionWindows: MotionWindow[];
} = { beats, events, motionWindows };
