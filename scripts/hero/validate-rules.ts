// scripts/hero/validate-rules.ts — stage B: pure produced-artifact assertions
// (spec §7 stage B, docs/superpowers/specs/2026-07-30-hero-video-pipeline-design.md).
// No fs/child_process here — every probe (ffprobe, box/IHDR parsing) lives in
// validate.ts, which is what makes the exhaustive mutation table in
// tests/unit/hero/validate-rules.test.ts possible: these functions take plain
// data in and return failure strings out, nothing more.
import type { Rect } from "./gen-camera.js";
import type { HeroEvent } from "./storyboard.js";

export type VideoProbe = {
	width: number;
	height: number;
	rFrameRate: string;
	avgFrameRate: string;
	framesCount: number;
	maxPtsDeltaSec: number;
	durationSec: number;
	pixFmt: string;
	audioStreams: number;
};

export type AsExecutedStoryboard = {
	tourOffset: number;
	tourDuration: number;
	masterDuration: number;
	beats: Array<{
		beat: string;
		settleTour: number;
		holdSec: number;
		rect: Rect | null;
	}>;
	events: Array<{
		id: string;
		kind: string;
		cueTargetTour: number;
		executedMaster: number;
	}>;
	motionWindows: Array<{ startMaster: number; endMaster: number }>;
	provenance: {
		appVersion: string;
		gitSha: string;
		recordedAt: string;
		clockOffsetMs: number;
		clockResidualMs: number;
		posterCapturedMaster: number;
	};
};

const NOMINAL_FRAME_RATE = "60/1";
const NOMINAL_FPS = 60;
const CADENCE_TOLERANCE_SEC = 0.001;
const FRAME_COUNT_TOLERANCE = 1;
const CUE_TOLERANCE_SEC = 0.2;
const MASTER_DURATION_TOLERANCE_SEC = 0.5;
const TOUR_DURATION_TOLERANCE_SEC = 0.5;
const TOUR_MAX_BYTES = 5 * 1024 * 1024;
const FRAME_W = 2880;
const FRAME_H = 1520;
const POSTER_CAPTURED_MASTER_MIN = 23.0;
const POSTER_CAPTURED_MASTER_MAX = 24.0;

/**
 * Pure max-abs-delta-between-consecutive-elements. Exported so both
 * validate.ts's real probe AND its test's real-media fixtures compute
 * cadence through the exact same code — a probe that swapped presentation
 * order for decode order, or dropped the sort, would otherwise be a
 * production bug with no test able to see it (fix-round-1 finding 3).
 * Does NOT sort — the caller decides ordering; validate.ts sorts before
 * calling this for presentation-ordered cadence, and a test deliberately
 * calls it on UNSORTED decode-order timestamps to demonstrate the trap.
 */
export function maxConsecutiveDelta(times: number[]): number {
	let max = 0;
	for (let i = 1; i < times.length; i++) {
		max = Math.max(max, Math.abs(times[i]! - times[i - 1]!));
	}
	return max;
}

/**
 * CFR is proven by MEASURED cadence, not the nominal rate: an adversarial VFR
 * file can report r_frame_rate=60/1 while avg_frame_rate is something else
 * entirely (e.g. 600/13), and even a genuinely-60/1-average file can still
 * have uneven presentation spacing. `maxPtsDeltaSec` must already be computed
 * by the caller over SORTED, PRESENTATION-ordered timestamps (frame=pts_time,
 * not packet=pts_time — see validate.ts) for this check to mean anything.
 *
 * Every numeric field this function reads is Number.isFinite-checked before
 * any arithmetic: `Math.abs(NaN - x) > tolerance` is ALWAYS false (NaN
 * comparisons are never true), so an ffprobe "N/A" duration/frame-count/pts
 * value would otherwise sail through as a silent CFR pass (fix-round-1
 * finding 2 — the same hazard checkRect already guards against for rects).
 */
function isExactlyCfr60(p: VideoProbe): boolean {
	if (p.rFrameRate !== NOMINAL_FRAME_RATE) return false;
	if (p.avgFrameRate !== NOMINAL_FRAME_RATE) return false;
	if (!Number.isFinite(p.maxPtsDeltaSec)) return false;
	if (!Number.isFinite(p.framesCount)) return false;
	if (!Number.isFinite(p.durationSec)) return false;
	if (Math.abs(p.maxPtsDeltaSec - 1 / NOMINAL_FPS) > CADENCE_TOLERANCE_SEC) {
		return false;
	}
	if (
		Math.abs(p.framesCount - p.durationSec * NOMINAL_FPS) >
		FRAME_COUNT_TOLERANCE
	) {
		return false;
	}
	return true;
}

function cfrFailureDetail(p: VideoProbe): string {
	return `rFrameRate=${p.rFrameRate} avgFrameRate=${p.avgFrameRate} maxPtsDeltaSec=${p.maxPtsDeltaSec} framesCount=${p.framesCount} durationSec=${p.durationSec}`;
}

export function checkMaster(p: VideoProbe): string[] {
	const errors: string[] = [];
	if (p.width !== FRAME_W) {
		errors.push(`master width ${p.width} !== ${FRAME_W}`);
	}
	if (p.height !== FRAME_H) {
		errors.push(`master height ${p.height} !== ${FRAME_H}`);
	}
	if (!isExactlyCfr60(p)) {
		errors.push(`master is not exactly CFR 60 (${cfrFailureDetail(p)})`);
	}
	if (
		!Number.isFinite(p.durationSec) ||
		Math.abs(p.durationSec - 25) > MASTER_DURATION_TOLERANCE_SEC
	) {
		errors.push(
			`master duration ${p.durationSec}s outside 25s ± ${MASTER_DURATION_TOLERANCE_SEC}s`,
		);
	}
	if (p.pixFmt !== "yuv420p") {
		errors.push(`master pixFmt "${p.pixFmt}" !== "yuv420p"`);
	}
	if (p.audioStreams !== 0) {
		errors.push(`master has ${p.audioStreams} audio stream(s), expected 0`);
	}
	return errors;
}

export function checkTour(
	p: VideoProbe,
	sizeBytes: number,
	moovBeforeMdat: boolean,
): string[] {
	const errors: string[] = [];
	if (p.width !== 1600) errors.push(`tour width ${p.width} !== 1600`);
	if (p.height !== 844) errors.push(`tour height ${p.height} !== 844`);
	if (!isExactlyCfr60(p)) {
		errors.push(`tour is not exactly CFR 60 (${cfrFailureDetail(p)})`);
	}
	if (
		!Number.isFinite(p.durationSec) ||
		Math.abs(p.durationSec - 21) > TOUR_DURATION_TOLERANCE_SEC
	) {
		errors.push(
			`tour duration ${p.durationSec}s outside 21s ± ${TOUR_DURATION_TOLERANCE_SEC}s`,
		);
	}
	if (p.audioStreams !== 0) {
		errors.push(`tour has ${p.audioStreams} audio stream(s), expected 0`);
	}
	if (sizeBytes > TOUR_MAX_BYTES) {
		errors.push(
			`tour size ${sizeBytes} bytes exceeds ${TOUR_MAX_BYTES} bytes (5 MB)`,
		);
	}
	if (!moovBeforeMdat) {
		errors.push("tour is not faststart: the moov atom does not precede mdat");
	}
	return errors;
}

export function checkPoster(
	width: number,
	height: number,
	isPng: boolean,
): string[] {
	const errors: string[] = [];
	if (!isPng) errors.push("poster is not a PNG file");
	if (width !== FRAME_W) errors.push(`poster width ${width} !== ${FRAME_W}`);
	if (height !== FRAME_H) {
		errors.push(`poster height ${height} !== ${FRAME_H}`);
	}
	return errors;
}

/**
 * Every one of the four fields is Number.isFinite-checked independently
 * before any arithmetic runs on them: NaN silently passes every ordinary
 * comparison (`NaN < 0` and `NaN > 0` are both false), so a finite-check on
 * only some fields would let a NaN in the others sail through.
 */
function checkRect(label: string, rect: Rect): string[] {
	const errors: string[] = [];
	const fields: Array<["x" | "y" | "w" | "h", number]> = [
		["x", rect.x],
		["y", rect.y],
		["w", rect.w],
		["h", rect.h],
	];
	let anyNonFinite = false;
	for (const [name, value] of fields) {
		if (!Number.isFinite(value)) {
			errors.push(`${label} rect.${name} is not finite (${value})`);
			anyNonFinite = true;
		}
	}
	if (anyNonFinite) return errors; // further arithmetic would be meaningless

	if (rect.w <= 0) errors.push(`${label} rect.w ${rect.w} is not positive`);
	if (rect.h <= 0) errors.push(`${label} rect.h ${rect.h} is not positive`);
	if (rect.x < 0) errors.push(`${label} rect.x ${rect.x} is negative`);
	if (rect.y < 0) errors.push(`${label} rect.y ${rect.y} is negative`);
	if (rect.x + rect.w > FRAME_W) {
		errors.push(
			`${label} rect x+w ${rect.x + rect.w} exceeds frame width ${FRAME_W}`,
		);
	}
	if (rect.y + rect.h > FRAME_H) {
		errors.push(
			`${label} rect y+h ${rect.y + rect.h} exceeds frame height ${FRAME_H}`,
		);
	}
	return errors;
}

export function checkStoryboard(
	sb: AsExecutedStoryboard,
	expected: { events: HeroEvent[]; markers: string[] },
): string[] {
	const errors: string[] = [];

	if (sb.tourOffset !== 2.0) {
		errors.push(`storyboard tourOffset ${sb.tourOffset} !== 2.0`);
	}
	if (sb.tourDuration !== 21) {
		errors.push(`storyboard tourDuration ${sb.tourDuration} !== 21`);
	}

	const byId = new Map(sb.events.map((e) => [e.id, e]));
	for (const expectedEvent of expected.events) {
		const actual = byId.get(expectedEvent.id);
		if (!actual) {
			errors.push(`storyboard missing expected event '${expectedEvent.id}'`);
			continue;
		}
		if (!Number.isFinite(actual.executedMaster)) {
			errors.push(
				`event '${actual.id}' executedMaster is not finite (${actual.executedMaster})`,
			);
			continue; // further arithmetic would be meaningless
		}
		if (actual.executedMaster < 0) {
			errors.push(
				`event '${actual.id}' executedMaster ${actual.executedMaster} is negative`,
			);
		}
		if (actual.executedMaster > sb.masterDuration) {
			errors.push(
				`event '${actual.id}' executedMaster ${actual.executedMaster} exceeds master duration ${sb.masterDuration}`,
			);
		}
		// ui-action choreography uses declared, non-settle-derived times (spec
		// §5/§7) — only cue events (mcp-status | marker | review-inject) are held
		// to the ±0.2s handoff tolerance.
		if (expectedEvent.kind !== "ui-action") {
			const target = sb.tourOffset + expectedEvent.cueTargetTour;
			const delta = Math.abs(actual.executedMaster - target);
			if (delta > CUE_TOLERANCE_SEC) {
				errors.push(
					`event '${actual.id}' executedMaster ${actual.executedMaster} misses cue target ${target} by ${delta.toFixed(3)}s (> ±${CUE_TOLERANCE_SEC}s)`,
				);
			}
		}
	}

	const presentMarkerIds = new Set(
		sb.events.filter((e) => e.kind === "marker").map((e) => e.id),
	);
	for (const markerId of expected.markers) {
		if (!presentMarkerIds.has(markerId)) {
			errors.push(`storyboard missing expected marker '${markerId}'`);
		}
	}

	// "full" is deliberately null (whole-frame, no crop) — every other beat's
	// camera-target rect must be finite, positive, and fully in-frame.
	for (const beat of sb.beats) {
		if (beat.rect !== null) {
			errors.push(...checkRect(`beat '${beat.beat}'`, beat.rect));
		}
	}

	const p = sb.provenance;
	if (!p?.appVersion) errors.push("storyboard provenance missing appVersion");
	if (!p?.gitSha) errors.push("storyboard provenance missing gitSha");
	if (!p?.recordedAt) errors.push("storyboard provenance missing recordedAt");
	if (!p || !Number.isFinite(p.clockOffsetMs)) {
		errors.push("storyboard provenance missing clockOffsetMs");
	}
	if (!p || !Number.isFinite(p.clockResidualMs)) {
		errors.push("storyboard provenance missing clockResidualMs");
	}
	if (
		!p ||
		!Number.isFinite(p.posterCapturedMaster) ||
		p.posterCapturedMaster < POSTER_CAPTURED_MASTER_MIN ||
		p.posterCapturedMaster > POSTER_CAPTURED_MASTER_MAX
	) {
		errors.push(
			`storyboard provenance.posterCapturedMaster ${p?.posterCapturedMaster} outside ${POSTER_CAPTURED_MASTER_MIN}–${POSTER_CAPTURED_MASTER_MAX}`,
		);
	}

	return errors;
}
