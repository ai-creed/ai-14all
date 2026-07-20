import { describe, expect, it } from "vitest";
import { PtyMirror } from "../../../../services/pty-inspect/pty-mirror";
import { serializePage } from "../../../../services/pty-inspect/pty-serializer";
import {
	decodeCursor,
	encodeCursor,
} from "../../../../services/pty-inspect/pty-cursor";
import { PtyRowsResult } from "@ai-creed/command-contract";
import { V4PtyRowsResult } from "./fixtures/v4-pty-rows-schema";

async function mirrorWith(
	data: string,
	cols = 40,
	rows = 6,
): Promise<PtyMirror> {
	const m = new PtyMirror({ cols, rows });
	m.write(data);
	await m.drained();
	m.tick();
	return m;
}

describe("cursor token", () => {
	it("round-trips and treats garbage as null (fresh snapshot)", () => {
		const c = { epoch: 3, watermark: 7, line: 42 };
		expect(decodeCursor(encodeCursor(c))).toEqual(c);
		expect(decodeCursor(null)).toBeNull();
		expect(decodeCursor("not-a-cursor")).toBeNull();
	});
});

describe("serializePage", () => {
	it("replay returns rows with tiling UTF-16 runs and a non-null cursor (spec §2)", async () => {
		const m = await mirrorWith(
			"\x1b[31mred\x1b[0m plain \x1b[1mbold\x1b[0m\r\n",
		);
		const page = serializePage(m, { cursor: null });
		expect(page.cursor).toBeTypeOf("string");
		const row = page.rows[0];
		expect(row.text).toBe("red plain bold");
		// Runs tile the text exactly.
		let off = 0;
		for (const run of row.runs) {
			expect(run.start).toBe(off);
			off += run.len;
		}
		expect(off).toBe(row.text.length);
		expect(row.runs[0]).toMatchObject({ start: 0, len: 3, fg: 1 });
		expect(row.runs.at(-1)).toMatchObject({ bold: true });
		m.dispose();
	});

	it("interior empty cells (tab stop) attribute as default-space runs, not the following color (review fix)", async () => {
		const m = await mirrorWith("a\t\x1b[31mred\x1b[0m\r\n");
		const row = serializePage(m, { cursor: null }).rows[0];
		expect(row.text).toBe("a       red");
		// Runs tile the text exactly.
		let off = 0;
		for (const run of row.runs) {
			expect(run.start).toBe(off);
			off += run.len;
		}
		expect(off).toBe(row.text.length);
		// The run covering the tab-filled gap (offsets 0..7) must carry no
		// fg — the interior empty cells are NOT the red that comes later.
		for (const run of row.runs) {
			if (run.start + run.len <= 8) expect(run.fg).toBeUndefined();
		}
		// The run covering "red" (offsets 8..10) carries the red fg.
		const redRun = row.runs.find((r) => r.start <= 8 && r.start + r.len > 8);
		expect(redRun).toMatchObject({ fg: 1 });
		m.dispose();
	});

	it("CJK + surrogate-pair emoji + combining marks: UTF-16 tiling, wcwidth budget, combining exceeds columns (spec §7)", async () => {
		// Local wcwidth approximation covering exactly this fixture's ranges:
		// combining marks = 0, CJK unified + emoji = 2, everything else = 1.
		const wcwidthSum = (text: string): number => {
			let w = 0;
			for (const ch of text) {
				const cp = ch.codePointAt(0) ?? 0;
				if (cp >= 0x0300 && cp <= 0x036f) continue;
				const wide =
					(cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x1f300 && cp <= 0x1faff);
				w += wide ? 2 : 1;
			}
			return w;
		};
		const m = await mirrorWith("漢字🚀!\r\né̂ok\r\n");
		const [wide, combining] = serializePage(m, { cursor: null }).rows;
		expect(wide.text).toBe("漢字🚀!");
		// 漢(1 unit) 字(1) 🚀(surrogate pair, 2) !(1) → 5 UTF-16 units over 7 columns.
		expect(wide.text.length).toBe(5);
		expect(combining.text).toBe("é̂ok");
		// Combining marks ride along in text: UTF-16 length EXCEEDS occupied columns.
		expect(combining.text.length).toBeGreaterThan(wcwidthSum(combining.text));
		for (const row of [wide, combining]) {
			let off = 0;
			for (const run of row.runs) {
				expect(run.start).toBe(off);
				off += run.len;
			}
			expect(off).toBe(row.text.length);
			expect(wcwidthSum(row.text)).toBeLessThanOrEqual(m.cols);
		}
		m.dispose();
	});

	it("syntactically valid but unknown cursor answers as a fresh snapshot (spec §2)", async () => {
		const m = await mirrorWith("a\r\nb\r\n", 10, 4);
		const forged = encodeCursor({
			epoch: m.epoch,
			watermark: m.watermark + 50,
			line: 999,
		});
		const page = serializePage(m, { cursor: forged });
		expect(page.rows.length).toBeGreaterThan(0); // full snapshot, never an empty "tail"
		expect(page.rows.map((r) => r.text)).toContain("a");
		m.dispose();
	});

	it("tail cursor after a burst larger than the viewport returns every appended row (spec §2)", async () => {
		const m = await mirrorWith("seed\r\n", 10, 4);
		const tail = serializePage(m, { cursor: null });
		expect(tail.more).toBe(false);
		let burst = "";
		for (let i = 0; i < 20; i++) burst += `b${i}\r\n`; // 20 rows, 4-row viewport
		m.write(burst);
		await m.drained();
		m.tick();
		const delta = serializePage(m, { cursor: tail.cursor });
		const texts = delta.rows.map((r) => r.text);
		for (let i = 0; i < 20; i++) expect(texts).toContain(`b${i}`);
		m.dispose();
	});

	it("caps pages and continues via cursor with more:true (spec §2 pagination)", async () => {
		let data = "";
		for (let i = 0; i < 12; i++) data += `r${i}\r\n`;
		const m = await mirrorWith(data, 10, 4);
		const p1 = serializePage(m, { cursor: null }, 5);
		expect(p1.rows).toHaveLength(5);
		expect(p1.more).toBe(true);
		const p2 = serializePage(m, { cursor: p1.cursor }, 500);
		expect(p2.more).toBe(false);
		const seen = [...p1.rows, ...p2.rows].map((r) => r.line);
		expect(new Set(seen).size).toBe(seen.length); // no duplicates
		const texts = [...p1.rows, ...p2.rows].map((r) => r.text);
		for (let i = 0; i < 12; i++) expect(texts).toContain(`r${i}`); // union covers every written line — a dropped page 2 must fail
		m.dispose();
	});

	it("tail cursor returns exactly the delta after new output (spec §7 cursor durability)", async () => {
		const m = await mirrorWith("a\r\nb\r\n", 10, 4);
		const replay = serializePage(m, { cursor: null });
		expect(replay.more).toBe(false);
		m.write("c\r\n");
		await m.drained();
		m.tick();
		const delta = serializePage(m, { cursor: replay.cursor });
		expect(delta.rows.map((r) => r.text).filter(Boolean)).toContain("c");
		expect(delta.rows.map((r) => r.text)).not.toContain("a");
		m.dispose();
	});

	it("stale epoch cursor answers as a fresh snapshot (spec §2)", async () => {
		const m = await mirrorWith("x\r\n", 10, 4);
		const old = serializePage(m, { cursor: null });
		m.resize(12, 4); // epoch bump
		m.tick();
		const page = serializePage(m, { cursor: old.cursor });
		expect(page.epoch).toBeGreaterThan(old.epoch);
		expect(page.rows.length).toBeGreaterThan(0); // full snapshot, not an error
		m.dispose();
	});

	it("pre-trim cursor never returns dropped lines and reports trimmedBefore (spec §6.2)", async () => {
		const m = await mirrorWith("seed\r\n", 10, 4);
		const early = serializePage(m, { cursor: null });
		const total = 10_000 + 4 + 9;
		let chunk = "";
		for (let i = 0; i < total; i++) chunk += `l${i}\r\n`;
		m.write(chunk);
		await m.drained();
		m.tick();
		const page = serializePage(m, { cursor: early.cursor });
		expect(page.trimmedBefore).toBe(m.trimmedBefore);
		for (const row of page.rows)
			expect(row.line).toBeGreaterThanOrEqual(page.trimmedBefore);
		m.dispose();
	}, 30_000);

	it("soft-wrapped long line: row 0 unwrapped, continuation rows carry wrapped: true (reflow spec §1.1)", async () => {
		const m = await mirrorWith("a".repeat(200), 80, 6);
		const rows = serializePage(m, { cursor: null }).rows;
		// 200 chars at 80 cols wraps into 3 content rows; the mirror reports the
		// full 6-row viewport, so 3 blank unwrapped rows pad the tail (observed
		// xterm behavior — serializePage never trims trailing blank rows).
		expect(rows.length).toBe(6);
		expect(rows[0].wrapped).toBeUndefined();
		expect(rows[1].wrapped).toBe(true);
		expect(rows[2].wrapped).toBe(true);
		for (const row of rows.slice(3)) expect(row.wrapped).toBeUndefined();
		m.dispose();
	});

	it("explicit newlines never carry wrapped (reflow spec §1.2)", async () => {
		const m = await mirrorWith("one\r\ntwo\r\nthree\r\n");
		for (const row of serializePage(m, { cursor: null }).rows) {
			expect(row.wrapped).toBeUndefined();
		}
		m.dispose();
	});

	it("wrapped chain spanning a page boundary keeps correct flags on both pages (reflow spec §1.3)", async () => {
		const m = await mirrorWith("b".repeat(200), 40, 8); // 5 wrapped-chain rows at 40 cols
		const p1 = serializePage(m, { cursor: null }, 2);
		expect(p1.more).toBe(true);
		const p2 = serializePage(m, { cursor: p1.cursor });
		const all = [...p1.rows, ...p2.rows].sort((a, b) => a.line - b.line);
		// The 8-row viewport carries the 5-row wrap chain plus 3 blank unwrapped
		// padding rows (observed xterm behavior, same as reflow spec §1.1).
		expect(all.length).toBe(8);
		const chain = all.slice(0, 5);
		expect(chain[0].wrapped).toBeUndefined();
		for (const row of chain.slice(1)) expect(row.wrapped).toBe(true);
		for (const row of all.slice(5)) expect(row.wrapped).toBeUndefined();
		m.dispose();
	});

	it("styled soft-wrapped content: runs still tile each row's text; the flag adds no run motion (reflow spec §1.4)", async () => {
		const m = await mirrorWith("\x1b[31m" + "r".repeat(100) + "\x1b[0m", 40, 6);
		const rows = serializePage(m, { cursor: null }).rows;
		// 100 chars at 40 cols wraps into 3 content rows; the mirror reports the
		// full 6-row viewport, so 3 blank unwrapped rows pad the tail (same
		// observed xterm behavior as reflow spec §1.1).
		expect(rows.length).toBe(6);
		for (const row of rows) {
			let off = 0;
			for (const run of row.runs) {
				expect(run.start).toBe(off);
				off += run.len;
			}
			expect(off).toBe(row.text.length);
		}
		expect(rows[0].wrapped).toBeUndefined();
		expect(rows[1].wrapped).toBe(true);
		expect(rows[2].wrapped).toBe(true);
		for (const row of rows.slice(3)) expect(row.wrapped).toBeUndefined();
		m.dispose();
	});

	it("after resize(), flags match the new geometry's per-line isWrapped — no hardcoded layout (reflow spec §1.5)", async () => {
		const m = await mirrorWith("c".repeat(30), 20, 6);
		m.resize(12, 4); // epoch bump; xterm reflows the buffer
		const page = serializePage(m, { cursor: null });
		expect(page.rows.length).toBeGreaterThan(0);
		for (const row of page.rows) {
			const expected =
				m.buffer.getLine(row.line - m.trimmedBefore)?.isWrapped ?? false;
			expect(row.wrapped ?? false).toBe(expected);
		}
		m.dispose();
	});

	it("alt-screen rows report their own isWrapped — no cross-buffer leakage (reflow spec §1.6)", async () => {
		const m = await mirrorWith(
			"d".repeat(100) + "\r\n" + "\x1b[?1049h" + "alt line\r\nsecond\r\n",
			40,
			6,
		);
		const page = serializePage(m, { cursor: null });
		expect(page.altScreen).toBe(true);
		for (const row of page.rows) {
			expect(row.wrapped).toBeUndefined();
		}
		m.dispose();
	});

	it("tail-first returns the newest `tail` rows with a backward channel (case 1)", async () => {
		const m = await mirrorWith("x\r\n".repeat(60), 40, 6);
		const full = serializePage(m, { cursor: null }); // oldest-first snapshot
		const first = full.rows[0].line;
		const last = full.rows.at(-1)!.line;
		const tail = serializePage(m, { cursor: null, tail: 20 });
		expect(tail.rows.length).toBe(20);
		expect(tail.rows[0].line).toBe(last - 19);
		expect(tail.rows.at(-1)!.line).toBe(last);
		expect(tail.more).toBe(false);
		expect(tail.moreBefore).toBe(last - 19 > first);
		if (last - 19 > first) {
			expect(decodeCursor(tail.cursorBefore!)!.line).toBe(last - 19);
		}
		m.dispose();
	});

	it("tail clamps to cap (case 2)", async () => {
		const m = await mirrorWith("x\r\n".repeat(60), 40, 6);
		const full = serializePage(m, { cursor: null });
		const last = full.rows.at(-1)!.line;
		const tail = serializePage(m, { cursor: null, tail: 10_000 }, 5);
		expect(tail.rows.length).toBe(5);
		expect(tail.rows.at(-1)!.line).toBe(last);
		expect(tail.rows[0].line).toBe(last - 4);
		expect(tail.moreBefore).toBe(true);
		m.dispose();
	});

	it("tail reaching the top clears the backward channel (case 3)", async () => {
		const m = await mirrorWith("a\r\nb\r\nc\r\n", 40, 6); // tiny, nothing trimmed
		const full = serializePage(m, { cursor: null });
		expect(full.rows[0].line).toBe(0); // first === 0
		const tail = serializePage(m, { cursor: null, tail: 500 });
		expect(tail.rows[0].line).toBe(0);
		expect(tail.moreBefore).toBe(false);
		expect(tail.cursorBefore).toBeUndefined();
		m.dispose();
	});

	it("tail forward cursor resumes live output, never a re-replay of the tail window (case 4)", async () => {
		// The tail cursor is { epoch, watermark, line: last } — a forward cursor.
		// The next { cursor } pull runs the existing (stamp, line) delta branch.
		// `PtyMirror.tick()` re-stamps rows that DEPART the viewport since the last
		// tick ("dirty by construction", services/pty-inspect/pty-mirror.ts:231-238),
		// so a resume is a keyed-by-line delta: the genuinely new rows PLUS the
		// bounded set of rows that scrolled out (one line written ⇒ ~one departed
		// row). That is idempotent for the phone (it keys by absolute line) and is
		// NOT a re-replay of the whole tail window — which is exactly what case 4
		// must prove. Asserting "exactly one row" is wrong (it ignores the departed
		// row); asserting merely ">= 1" is too weak (a full re-replay would pass).
		const m = await mirrorWith("x\r\n".repeat(30), 40, 6);
		const tail = serializePage(m, { cursor: null, tail: 10 });
		m.write("brand-new\r\n");
		await m.drained();
		m.tick();
		const resume = serializePage(m, { cursor: tail.cursor });
		// The genuinely new line is delivered.
		expect(resume.rows.some((r) => r.text === "brand-new")).toBe(true);
		// It is a small delta, not a full-window resend.
		expect(resume.rows.length).toBeLessThan(tail.rows.length);
		// The load-bearing assertion: no tail row is re-sent with UNCHANGED content
		// except the (bounded) rows that physically scrolled out. A re-replay of the
		// tail window would re-send many byte-identical rows and blow this bound.
		const tailByLine = new Map(tail.rows.map((r) => [r.line, r.text]));
		const identicalReplay = resume.rows.filter(
			(r) => tailByLine.get(r.line) === r.text,
		).length;
		expect(identicalReplay).toBeLessThanOrEqual(1);
		m.dispose();
	});

	it("altScreen forces the backward channel off for tail-first (case 8-tail)", async () => {
		const m = await mirrorWith("\x1b[?1049h" + "alt\r\n".repeat(10), 40, 6);
		const tail = serializePage(m, { cursor: null, tail: 3 });
		expect(tail.altScreen).toBe(true);
		expect(tail.moreBefore).toBe(false);
		expect(tail.cursorBefore).toBeUndefined();
		m.dispose();
	});

	it("forward path is unchanged and now carries moreBefore (cases 9 + 10)", async () => {
		const m = await mirrorWith("x\r\n".repeat(12), 40, 6);
		const snap = serializePage(m, { cursor: null });
		expect(typeof snap.moreBefore).toBe("boolean"); // handshake key present
		expect(snap.rows[0].line).toBeLessThan(snap.rows.at(-1)!.line); // oldest-first
		m.write("later\r\n");
		await m.drained();
		m.tick();
		const delta = serializePage(m, { cursor: snap.cursor });
		// Not "exactly one row": the initial full snapshot already includes the
		// trailing blank cursor row, and writing one more line always dirties
		// at least two rows (that blank row filling in with "later", plus a
		// fresh blank row created after it) — a structural property of the
		// buffer, not something this task's restructuring changed. With a
		// saturated 6-row viewport this write also departs one row (dirty by
		// construction, pty-mirror.ts:231-238, same burst-safety as case 4).
		// The regression-safety invariant is: new content is delivered and the
		// delta is small, never a full re-replay of the snapshot.
		expect(delta.rows.some((r) => r.text === "later")).toBe(true);
		expect(delta.rows.length).toBeLessThan(snap.rows.length);
		expect(typeof delta.moreBefore).toBe("boolean");
		m.dispose();
	});
});

describe("v4/v5 contract compatibility (umbrella §3)", () => {
	it("old host → new phone: a page with no wrapped key parses against the v5 schema with wrapped absent (reflow spec §1.7)", async () => {
		const m = await mirrorWith("plain\r\nlines\r\n");
		const page = serializePage(m, { cursor: null });
		expect(JSON.stringify(page)).not.toContain("wrapped");
		const parsed = PtyRowsResult.parse({ ok: true, ...page });
		if (!parsed.ok) throw new Error("expected success arm");
		for (const row of parsed.rows) expect(row.wrapped).toBeUndefined();
		m.dispose();
	});

	it("new host → old phone: the frozen v4 schema parses an unmodified v5 page and strips wrapped (reflow spec §1.8)", async () => {
		const m = await mirrorWith("e".repeat(100), 40, 6);
		const page = serializePage(m, { cursor: null });
		expect(page.rows.some((r) => r.wrapped === true)).toBe(true);
		const parsed = V4PtyRowsResult.parse({ ok: true, ...page });
		if (!parsed.ok) throw new Error("expected success arm");
		for (const row of parsed.rows) {
			expect("wrapped" in row).toBe(false);
		}
		m.dispose();
	});
});
