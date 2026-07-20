import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { PtyMirror } from "../services/pty-inspect/pty-mirror.js";
import {
	serializePage,
	type PtyRowsPage,
} from "../services/pty-inspect/pty-serializer.js";

export type PtyFixtureArtifact = {
	subscribe: { cols: number; epoch: number; watermark: number };
	pages: PtyRowsPage[];
	tailPage?: PtyRowsPage;
	backwardPages?: PtyRowsPage[];
};

/**
 * Replay raw PTY bytes through the real mirror + serializer chain and emit
 * the fixture artifact the xavier smoke test consumes (reflow child spec §3,
 * umbrella §6.2). Deterministic for a given byte string + geometry.
 * `pageCap` is test-only: it lowers the serializePage cap so page chaining
 * is exercisable with small inputs.
 */
export async function generateFixture(
	bytes: string,
	cols: number,
	rows: number,
	pageCap?: number,
	tail?: number,
): Promise<PtyFixtureArtifact> {
	const mirror = new PtyMirror({ cols, rows });
	try {
		mirror.write(bytes);
		await mirror.drained();
		mirror.tick();
		const pages: PtyRowsPage[] = [];
		let cursor: string | null = null;
		let page: PtyRowsPage;
		do {
			page = serializePage(mirror, { cursor }, pageCap);
			pages.push(page);
			cursor = page.cursor;
		} while (page.more);
		const DEFAULT_TAIL = 50;
		const tailN = tail ?? DEFAULT_TAIL;
		const tailPage = serializePage(mirror, { cursor: null, tail: tailN }, pageCap);
		// No-history guard: cursorBefore === undefined means the tail already
		// reached the top. Calling serializePage with { before: undefined } would
		// dispatch to Forward and stuff a snapshot into backwardPages — emit [].
		const backwardPages: PtyRowsPage[] = [];
		let before = tailPage.cursorBefore;
		let iterations = 0;
		while (before !== undefined && iterations++ < 10_000) {
			const bp = serializePage(mirror, { cursor: null, before }, pageCap);
			backwardPages.push(bp); // sequential pull order: index 0 = nearest tail
			before = bp.cursorBefore;
		}
		return {
			subscribe: {
				cols: mirror.cols,
				epoch: mirror.epoch,
				watermark: mirror.watermark,
			},
			pages,
			tailPage,
			backwardPages,
		};
	} finally {
		mirror.dispose();
	}
}

const USAGE =
	"Usage: pnpm exec tsx --tsconfig scripts/tsconfig.tsx.json scripts/generate-pty-fixture.ts --bytes <file> --cols <n> --rows <n> --out <file>\n\n" +
	"Replays raw PTY bytes (as captured by AI14ALL_PTY_CAPTURE_DIR) through the\n" +
	"real PtyMirror + serializePage chain and writes the fixture artifact\n" +
	"{ subscribe: { cols, epoch, watermark }, pages: PtyRowsPage[] } as JSON.\n" +
	"Deterministic for a given byte file + geometry.\n\n" +
	"--tsconfig scripts/tsconfig.tsx.json is required when running this script\n" +
	"directly via tsx: it aliases @xterm/headless to its real ESM build so\n" +
	"named imports resolve outside Vite/Vitest (see that file for why).\n\n" +
	"--tail <n>";

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			bytes: { type: "string" },
			cols: { type: "string" },
			rows: { type: "string" },
			out: { type: "string" },
			tail: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	});
	if (values.help) {
		console.log(USAGE);
		return;
	}
	if (!values.bytes || !values.cols || !values.rows || !values.out) {
		console.error(USAGE);
		process.exitCode = 1;
		return;
	}
	const cols = Number(values.cols);
	const rows = Number(values.rows);
	if (
		!Number.isInteger(cols) ||
		cols <= 0 ||
		!Number.isInteger(rows) ||
		rows <= 0
	) {
		console.error("--cols and --rows must be positive integers");
		process.exitCode = 1;
		return;
	}
	const tail = values.tail ? Number(values.tail) : undefined;
	if (tail !== undefined && (!Number.isInteger(tail) || tail <= 0)) {
		console.error("--tail must be a positive integer");
		process.exitCode = 1;
		return;
	}
	const bytes = await readFile(values.bytes, "utf8");
	const artifact = await generateFixture(bytes, cols, rows, undefined, tail);
	await writeFile(
		values.out,
		JSON.stringify(artifact, null, "\t") + "\n",
		"utf8",
	);
	console.log(
		`wrote ${values.out}: ${artifact.pages.length} page(s), ` +
			`${artifact.pages.reduce((n, p) => n + p.rows.length, 0)} row(s)`,
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}
