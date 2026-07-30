// scripts/hero/render.ts — `pnpm hero:render`: the missing middle of the hero
// pipeline. Turns the 25s master (T7) into the 21s cropped tour that actually
// ships to the ai-creed homepage. Reads the as-executed storyboard.json for
// exact beat geometry and the recorded tour offset/duration, derives an
// ffmpeg zoompan filter from it (gen-camera.ts, T2), and re-encodes an
// input-seeked, frame-accurate trim of master.mp4 into tour.mp4 (spec §6).
// Not a Playwright spec — a standalone script (Global Constraints: nothing
// new under tests/e2e/). Pure orchestration/glue, like record.ts's own
// encode step — no unit tests (spec §8: "glue code gets no unit tests");
// correctness is proven by a real run through `hero:validate` (stage B).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	buildZoompanFilter,
	keyframesFromBeats,
	type ExecutedBeat,
	type Rect,
} from "./gen-camera.js";
import type { AsExecutedStoryboard } from "./validate-rules.js";

const HERO_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERO_DIR, "..", "..");
const HERO_DIST_DIR = join(REPO_ROOT, "hero-dist");

// Master capture geometry (spec §3/§6: 2880x1520) and the tour delivery
// contract (spec §6/§7: 1600x844 @ 60fps, silent, ≤5MB, faststart) — the
// exact values task-9-brief.md specifies verbatim for buildZoompanFilter's
// opts.
const MASTER_W = 2880;
const MASTER_H = 1520;
const TOUR_W = 1600;
const TOUR_H = 844;
const TOUR_FPS = 60;

// "bump crf toward 28 only if > 5 MB" (brief) — start at 27 as written and
// step up one at a time until the file fits; MAX_CRF caps the escalation so
// a persistently oversized output surfaces as a real failure, not a silent
// quality slide.
const START_CRF = 27;
const MAX_CRF = 32;
const TOUR_MAX_BYTES = 5 * 1024 * 1024;

function main(): void {
	const masterPath = join(HERO_DIST_DIR, "master.mp4");
	const storyboardPath = join(HERO_DIST_DIR, "storyboard.json");

	const missing = [
		!existsSync(masterPath) && "master.mp4",
		!existsSync(storyboardPath) && "storyboard.json",
	].filter((v): v is string => Boolean(v));
	if (missing.length > 0) {
		console.error(
			`[hero:render] fatal: ${missing.join(", ")} missing from ${HERO_DIST_DIR} — run \`pnpm hero:record\` first.`,
		);
		process.exitCode = 1;
		return;
	}

	const storyboard = JSON.parse(
		readFileSync(storyboardPath, "utf8"),
	) as AsExecutedStoryboard;

	const beats: ExecutedBeat[] = storyboard.beats.map((b) => ({
		beat: b.beat,
		settle: b.settleTour,
		hold: b.holdSec,
		rect: b.rect,
	}));
	const frame: Rect = { x: 0, y: 0, w: MASTER_W, h: MASTER_H };
	const keyframes = keyframesFromBeats(beats, frame);
	const filter = buildZoompanFilter(keyframes, {
		iw: MASTER_W,
		ih: MASTER_H,
		ow: TOUR_W,
		oh: TOUR_H,
		fps: TOUR_FPS,
	});

	const filterPath = join(HERO_DIST_DIR, "tour-filter.txt");
	writeFileSync(filterPath, filter + "\n");

	const tourPath = join(HERO_DIST_DIR, "tour.mp4");

	let crf = START_CRF;
	let sizeBytes = Number.POSITIVE_INFINITY;
	for (; crf <= MAX_CRF; crf++) {
		// Input-seek (-ss before -i) + re-encode = frame-accurate trim (brief).
		// tourOffset/tourDuration come from the as-executed storyboard, not
		// hardcoded literals, though the contract pins them to 2.0 / 21.
		execFileSync(
			"ffmpeg",
			[
				"-ss",
				String(storyboard.tourOffset),
				"-i",
				masterPath,
				"-t",
				String(storyboard.tourDuration),
				"-filter_complex_script",
				filterPath,
				"-c:v",
				"libx264",
				"-crf",
				String(crf),
				"-preset",
				"medium",
				"-movflags",
				"+faststart",
				"-an",
				"-y",
				tourPath,
			],
			{ stdio: "inherit" },
		);
		sizeBytes = statSync(tourPath).size;
		const mb = (sizeBytes / (1024 * 1024)).toFixed(2);
		if (sizeBytes <= TOUR_MAX_BYTES) {
			console.log(`[hero:render] crf ${crf} → ${mb} MB (within 5 MB budget)`);
			break;
		}
		console.log(
			`[hero:render] crf ${crf} → ${mb} MB, over the 5 MB budget — retrying at crf ${crf + 1}`,
		);
	}

	if (sizeBytes > TOUR_MAX_BYTES) {
		console.error(
			`[hero:render] fatal: tour.mp4 still ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB after escalating crf to ${MAX_CRF} — over the 5 MB budget.`,
		);
		process.exitCode = 1;
		return;
	}

	console.log(
		`[hero:render] done — ${tourPath} (crf ${crf}, ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB)`,
	);
}

main();
