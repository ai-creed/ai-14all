// scripts/hero/validate.ts — stage B: `pnpm hero:validate`, the final,
// standalone-runnable produced-artifact guard over hero-dist/ (spec §7 stage
// B). Everything that touches fs/ffprobe lives here; the assertions
// themselves are pure functions imported from validate-rules.ts. Not a
// Playwright spec — a standalone script (Global Constraints: nothing new
// under tests/e2e/).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FLEET_TIGHT } from "./storyboard.js";
import {
	checkMaster,
	checkPoster,
	checkStoryboard,
	checkTour,
	maxConsecutiveDelta,
	type AsExecutedStoryboard,
	type VideoProbe,
} from "./validate-rules.js";

const HERO_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERO_DIR, "..", "..");
const HERO_DIST_DIR = join(REPO_ROOT, "hero-dist");

// ---------------------------------------------------------------------------
// ffprobe
// ---------------------------------------------------------------------------

function ffprobeJson(args: string[]): unknown {
	const out = execFileSync("ffprobe", args, { encoding: "utf8" });
	return JSON.parse(out);
}

function ffprobeText(args: string[]): string {
	return execFileSync("ffprobe", args, { encoding: "utf8" });
}

/**
 * Cadence MUST be measured on presentation-ordered timestamps: `packet=
 * pts_time` is emitted in DECODE order, and with libx264 B-frames a
 * perfectly valid CFR-60 file shows packet deltas anywhere from -0.033s to
 * +0.083s — a naive packet walk rejects correct output. `frame=pts_time`
 * gives presentation order already; SORT it numerically anyway (defense in
 * depth against any ffprobe/container quirk that reorders it) before taking
 * consecutive deltas.
 *
 * Exported (not just used internally) so tests/unit/hero/validate-rules.test.ts's
 * real-media fixtures call THIS function — not a hand-rolled copy — to probe
 * real ffmpeg output. A copy that drifts (e.g. swaps frame= for packet=, or
 * drops the sort) is a production regression no test could see; importing
 * the real one closes that gap (fix-round-1 finding 3).
 */
export function probeVideo(path: string): VideoProbe {
	const streamJson = ffprobeJson([
		"-v",
		"error",
		"-select_streams",
		"v:0",
		"-show_entries",
		"stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration,pix_fmt",
		"-of",
		"json",
		path,
	]) as { streams?: Array<Record<string, string | number>> };
	const stream = streamJson.streams?.[0];
	if (!stream) {
		throw new Error(`ffprobe found no video stream in ${path}`);
	}

	const ptsOut = ffprobeText([
		"-v",
		"error",
		"-select_streams",
		"v:0",
		"-show_entries",
		"frame=pts_time",
		"-of",
		"csv=p=0",
		path,
	]);
	const ptsTimes = ptsOut
		.split("\n")
		.map((line) => Number.parseFloat(line.split(",")[0] ?? ""))
		.filter((v) => Number.isFinite(v))
		.sort((a, b) => a - b);
	const maxPtsDeltaSec = maxConsecutiveDelta(ptsTimes);

	const audioOut = ffprobeText([
		"-v",
		"error",
		"-select_streams",
		"a",
		"-show_entries",
		"stream=index",
		"-of",
		"csv=p=0",
		path,
	]);
	const audioStreams = audioOut
		.split("\n")
		.filter((line) => line.trim().length > 0).length;

	const nbFrames = Number(stream.nb_frames);

	return {
		width: Number(stream.width),
		height: Number(stream.height),
		rFrameRate: String(stream.r_frame_rate),
		avgFrameRate: String(stream.avg_frame_rate),
		framesCount: Number.isFinite(nbFrames) ? nbFrames : ptsTimes.length,
		maxPtsDeltaSec,
		durationSec: Number(stream.duration),
		pixFmt: String(stream.pix_fmt),
		audioStreams,
	};
}

// ---------------------------------------------------------------------------
// MP4 top-level box walk (moov vs mdat order — faststart proof)
// ---------------------------------------------------------------------------

type Mp4Box = { type: string; offset: number };

function walkTopLevelBoxes(buf: Buffer): Mp4Box[] {
	const boxes: Mp4Box[] = [];
	let offset = 0;
	while (offset + 8 <= buf.length) {
		const size32 = buf.readUInt32BE(offset);
		const type = buf.toString("ascii", offset + 4, offset + 8);
		let boxSize: number;
		let headerSize = 8;
		if (size32 === 1) {
			// 64-bit extended size in the next 8 bytes.
			if (offset + 16 > buf.length) break;
			const hi = buf.readUInt32BE(offset + 8);
			const lo = buf.readUInt32BE(offset + 12);
			boxSize = hi * 2 ** 32 + lo;
			headerSize = 16;
		} else if (size32 === 0) {
			// Box extends to EOF — only valid for the last box.
			boxSize = buf.length - offset;
		} else {
			boxSize = size32;
		}
		boxes.push({ type, offset });
		if (boxSize < headerSize) break; // malformed; avoid an infinite loop
		offset += boxSize;
	}
	return boxes;
}

function isMoovBeforeMdat(buf: Buffer): boolean {
	const boxes = walkTopLevelBoxes(buf);
	const moov = boxes.find((b) => b.type === "moov");
	const mdat = boxes.find((b) => b.type === "mdat");
	if (!moov || !mdat) return false;
	return moov.offset < mdat.offset;
}

// ---------------------------------------------------------------------------
// PNG IHDR
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function readPngDimensions(buf: Buffer): {
	isPng: boolean;
	width: number;
	height: number;
} {
	const isPng =
		buf.length >= 24 &&
		buf.subarray(0, 8).equals(PNG_SIGNATURE) &&
		buf.toString("ascii", 12, 16) === "IHDR";
	if (!isPng) return { isPng: false, width: 0, height: 0 };
	return {
		isPng: true,
		width: buf.readUInt32BE(16),
		height: buf.readUInt32BE(20),
	};
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): void {
	const failures: string[] = [];

	const masterPath = join(HERO_DIST_DIR, "master.mp4");
	if (!existsSync(masterPath)) {
		failures.push("master.mp4 missing");
	} else {
		try {
			const probe = probeVideo(masterPath);
			failures.push(...checkMaster(probe).map((e) => `[master.mp4] ${e}`));
		} catch (err) {
			failures.push(`[master.mp4] probe failed: ${(err as Error).message}`);
		}
	}

	const tourPath = join(HERO_DIST_DIR, "tour.mp4");
	if (!existsSync(tourPath)) {
		failures.push("tour.mp4 missing");
	} else {
		try {
			const probe = probeVideo(tourPath);
			const sizeBytes = statSync(tourPath).size;
			const moovBeforeMdat = isMoovBeforeMdat(readFileSync(tourPath));
			failures.push(
				...checkTour(probe, sizeBytes, moovBeforeMdat).map(
					(e) => `[tour.mp4] ${e}`,
				),
			);
		} catch (err) {
			failures.push(`[tour.mp4] probe failed: ${(err as Error).message}`);
		}
	}

	const posterPath = join(HERO_DIST_DIR, "poster.png");
	if (!existsSync(posterPath)) {
		failures.push("poster.png missing");
	} else {
		const { isPng, width, height } = readPngDimensions(
			readFileSync(posterPath),
		);
		failures.push(
			...checkPoster(width, height, isPng).map((e) => `[poster.png] ${e}`),
		);
	}

	const storyboardPath = join(HERO_DIST_DIR, "storyboard.json");
	if (!existsSync(storyboardPath)) {
		failures.push("storyboard.json missing");
	} else {
		try {
			const sb = JSON.parse(
				readFileSync(storyboardPath, "utf8"),
			) as AsExecutedStoryboard;
			const expected = {
				events: [...FLEET_TIGHT.events],
				markers: FLEET_TIGHT.events
					.filter((e) => e.kind === "marker")
					.map((e) => e.id),
			};
			failures.push(
				...checkStoryboard(sb, expected).map((e) => `[storyboard.json] ${e}`),
			);
		} catch (err) {
			failures.push(
				`[storyboard.json] parse failed: ${(err as Error).message}`,
			);
		}
	}

	if (failures.length > 0) {
		console.error(`[hero:validate] FAIL — ${failures.length} issue(s):`);
		for (const f of failures) console.error("[hero:validate]", f);
		process.exitCode = 1;
		return;
	}
	console.log(
		"[hero:validate] PASS — all produced artifacts match the contract",
	);
}

// Import-safe: only run the CLI when this file is the process entry point,
// not when a test imports probeVideo (or anything else) from it as a
// library — otherwise every import would re-run the whole artifact scan.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}
