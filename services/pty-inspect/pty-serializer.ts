import type { PtyMirror } from "./pty-mirror.js";
import { decodeCursor, encodeCursor } from "./pty-cursor.js";

export type StyleRun = {
	start: number;
	len: number;
	fg?: number | { r: number; g: number; b: number };
	bg?: number | { r: number; g: number; b: number };
	bold?: true;
	dim?: true;
	italic?: true;
	underline?: true;
	inverse?: true;
};
export type PtyRow = {
	line: number;
	text: string;
	runs: StyleRun[];
	wrapped?: true;
};
export type PtyRowsPage = {
	epoch: number;
	cols: number;
	altScreen: boolean;
	watermark: number;
	trimmedBefore: number;
	rows: PtyRow[];
	cursor: string;
	more: boolean;
	cursorBefore?: string;
	moreBefore?: boolean;
};

const DEFAULT_CAP = 500;

type CellAttrs = Omit<StyleRun, "start" | "len">;

function cellColor(
	mode: "default" | "palette" | "rgb",
	color: number,
): number | { r: number; g: number; b: number } | undefined {
	if (mode === "default") return undefined;
	if (mode === "palette") return color;
	return { r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff };
}

function sameAttrs(a: CellAttrs, b: CellAttrs): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

// Attribute-only view of a run: start/len must never participate in the
// adjacent-merge comparison (a full-run compare would defeat merging).
function runAttrs(run: StyleRun): CellAttrs {
	const { start: _start, len: _len, ...attrs } = run;
	return attrs;
}

// Serialize one retained row into text + runs. Run offsets are UTF-16 code
// units into `text` (umbrella §5): a wide glyph contributes its full UTF-16
// length to one run; zero-width cells merge into the preceding glyph's run.
function serializeRow(
	mirror: PtyMirror,
	retainedIndex: number,
	absoluteLine: number,
): PtyRow {
	const buffer = mirror.buffer;
	const line = buffer.getLine(retainedIndex);
	if (!line) return { line: absoluteLine, text: "", runs: [] };
	const text = line.translateToString(true);
	const runs: StyleRun[] = [];
	const cell = buffer.getNullCell();
	let off = 0;
	for (let x = 0; x < line.length && off < text.length; x++) {
		line.getCell(x, cell);
		if (cell.getWidth() === 0) continue; // zero-width joins previous run
		const chars = cell.getChars();
		let attrs: CellAttrs;
		let len: number;
		if (chars.length === 0) {
			// Interior gap (tab stop, cursor jump past written content):
			// translateToString(true) fills the gap with a literal space in
			// `text` (it only trims trailing blanks), but the cell itself
			// carries no glyph — treat it as one default-attrs space so a
			// later write's color never bleeds backward onto the gap
			// (review fix: interior empty cells must not mis-attribute).
			attrs = {};
			len = 1;
		} else {
			attrs = {};
			const fg = cellColor(
				cell.isFgDefault() ? "default" : cell.isFgPalette() ? "palette" : "rgb",
				cell.getFgColor(),
			);
			const bg = cellColor(
				cell.isBgDefault() ? "default" : cell.isBgPalette() ? "palette" : "rgb",
				cell.getBgColor(),
			);
			if (fg !== undefined) attrs.fg = fg;
			if (bg !== undefined) attrs.bg = bg;
			if (cell.isBold()) attrs.bold = true;
			if (cell.isDim()) attrs.dim = true;
			if (cell.isItalic()) attrs.italic = true;
			if (cell.isUnderline()) attrs.underline = true;
			if (cell.isInverse()) attrs.inverse = true;
			len = Math.min(chars.length, text.length - off);
		}
		const prev = runs.at(-1);
		if (prev && sameAttrs(runAttrs(prev), attrs)) {
			prev.len += len; // adjacent cells with identical attrs merge (spec §2)
		} else {
			runs.push({ start: off, len, ...attrs });
		}
		off += len;
	}
	if (off < text.length) {
		// Trailing cells collapsed by trimRight never emitted runs; pad with
		// a default run so runs always tile text exactly.
		const prev = runs.at(-1);
		if (prev && sameAttrs(runAttrs(prev), {})) prev.len += text.length - off;
		else runs.push({ start: off, len: text.length - off });
	}
	const row: PtyRow = { line: absoluteLine, text, runs };
	if (line.isWrapped) row.wrapped = true;
	return row;
}

export type SerializePageArgs = {
	cursor: string | null;
	tail?: number;
	before?: string;
};

export function serializePage(
	mirror: PtyMirror,
	args: SerializePageArgs,
	cap: number = DEFAULT_CAP,
): PtyRowsPage {
	const stamps = mirror.takeStamps();
	const first = mirror.trimmedBefore;
	const last = mirror.trimmedBefore + mirror.buffer.length - 1;

	let rows: PtyRow[];
	let cursor: string;
	let more: boolean;

	if (args.before !== undefined) {
		// Backward: rows strictly older than the token, ascending within window.
		const tok = decodeCursor(args.before);
		if (
			tok === null ||
			tok.epoch !== mirror.epoch ||
			!Number.isInteger(tok.line) ||
			tok.line <= first ||
			tok.line > last
		) {
			rows = []; // stale / foreign / non-integer / out-of-window — never phantom rows
		} else {
			const startAbs = Math.max(first, tok.line - cap);
			const endAbs = tok.line - 1; // ≤ last − 1, so every line is a real row
			rows = [];
			for (let abs = startAbs; abs <= endAbs; abs++) {
				rows.push(serializeRow(mirror, abs - first, abs));
			}
		}
		cursor = encodeCursor({
			epoch: mirror.epoch,
			watermark: mirror.watermark,
			line: last,
		}); // ignored by the phone; satisfies the non-null contract
		more = false;
	} else if (args.cursor === null && args.tail !== undefined) {
		// Tail-first: newest min(tail, cap) rows; forward-resume cursor from now.
		const n = Math.min(args.tail, cap);
		const startAbs = Math.max(first, last - n + 1); // empty buffer ⇒ no rows
		rows = [];
		for (let abs = startAbs; abs <= last; abs++) {
			rows.push(serializeRow(mirror, abs - first, abs));
		}
		cursor = encodeCursor({
			epoch: mirror.epoch,
			watermark: mirror.watermark,
			line: last,
		});
		more = false;
	} else {
		// Forward (existing selection verbatim).
		const c = decodeCursor(args.cursor);
		// Stale OR unknown → fresh snapshot (spec §2): wrong epoch, pre-trim
		// line, or a forged/foreign token pointing beyond the current
		// watermark or the retained range. Never an error, and never an
		// empty "tail" page.
		const fresh =
			c === null ||
			c.epoch !== mirror.epoch ||
			c.line < first ||
			c.line > last ||
			c.watermark > mirror.watermark;
		const candidates: number[] = [];
		if (fresh) {
			for (let abs = first; abs <= last; abs++) candidates.push(abs);
		} else {
			for (let abs = first; abs <= last; abs++) {
				const wm = stamps.get(abs) ?? 0;
				if (wm > c.watermark || (wm === c.watermark && abs > c.line)) {
					candidates.push(abs);
				}
			}
		}
		// Order by (stamp, line) so the cursor's lexicographic resume is stable.
		candidates.sort((a, b) => {
			const wa = stamps.get(a) ?? 0;
			const wb = stamps.get(b) ?? 0;
			return wa - wb || a - b;
		});
		const emit = candidates.slice(0, cap);
		rows = emit.map((abs) =>
			serializeRow(mirror, abs - mirror.trimmedBefore, abs),
		);
		const tailLine = emit.at(-1);
		cursor = encodeCursor({
			epoch: mirror.epoch,
			watermark:
				tailLine !== undefined
					? (stamps.get(tailLine) ?? 0)
					: fresh
						? 0
						: c.watermark,
			line: tailLine !== undefined ? tailLine : fresh ? first - 1 : c.line,
		});
		more = candidates.length > emit.length;
	}

	// Uniform backward channel — computed from emitted rows for EVERY mode.
	let moreBefore: boolean;
	let cursorBefore: string | undefined;
	if (mirror.altScreen || rows.length === 0) {
		moreBefore = false;
		cursorBefore = undefined;
	} else {
		const oldest = Math.min(...rows.map((r) => r.line)); // rows.length ≤ cap
		moreBefore = oldest > first;
		cursorBefore = moreBefore
			? encodeCursor({ epoch: mirror.epoch, watermark: 0, line: oldest })
			: undefined;
	}

	const page: PtyRowsPage = {
		epoch: mirror.epoch,
		cols: mirror.cols,
		altScreen: mirror.altScreen,
		watermark: mirror.watermark,
		trimmedBefore: mirror.trimmedBefore,
		rows,
		cursor,
		more,
		moreBefore,
	};
	if (cursorBefore !== undefined) page.cursorBefore = cursorBefore;
	return page;
}
