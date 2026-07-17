import { describe, expect, it } from "vitest";
import { PtyMirror } from "../../../../services/pty-inspect/pty-mirror";
import { serializePage } from "../../../../services/pty-inspect/pty-serializer";
import {
	decodeCursor,
	encodeCursor,
} from "../../../../services/pty-inspect/pty-cursor";

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
		const page = serializePage(m, null);
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
		const [wide, combining] = serializePage(m, null).rows;
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
		const page = serializePage(m, forged);
		expect(page.rows.length).toBeGreaterThan(0); // full snapshot, never an empty "tail"
		expect(page.rows.map((r) => r.text)).toContain("a");
		m.dispose();
	});

	it("tail cursor after a burst larger than the viewport returns every appended row (spec §2)", async () => {
		const m = await mirrorWith("seed\r\n", 10, 4);
		const tail = serializePage(m, null);
		expect(tail.more).toBe(false);
		let burst = "";
		for (let i = 0; i < 20; i++) burst += `b${i}\r\n`; // 20 rows, 4-row viewport
		m.write(burst);
		await m.drained();
		m.tick();
		const delta = serializePage(m, tail.cursor);
		const texts = delta.rows.map((r) => r.text);
		for (let i = 0; i < 20; i++) expect(texts).toContain(`b${i}`);
		m.dispose();
	});

	it("caps pages and continues via cursor with more:true (spec §2 pagination)", async () => {
		let data = "";
		for (let i = 0; i < 12; i++) data += `r${i}\r\n`;
		const m = await mirrorWith(data, 10, 4);
		const p1 = serializePage(m, null, 5);
		expect(p1.rows).toHaveLength(5);
		expect(p1.more).toBe(true);
		const p2 = serializePage(m, p1.cursor, 500);
		expect(p2.more).toBe(false);
		const seen = [...p1.rows, ...p2.rows].map((r) => r.line);
		expect(new Set(seen).size).toBe(seen.length); // no duplicates
		m.dispose();
	});

	it("tail cursor returns exactly the delta after new output (spec §7 cursor durability)", async () => {
		const m = await mirrorWith("a\r\nb\r\n", 10, 4);
		const replay = serializePage(m, null);
		expect(replay.more).toBe(false);
		m.write("c\r\n");
		await m.drained();
		m.tick();
		const delta = serializePage(m, replay.cursor);
		expect(delta.rows.map((r) => r.text).filter(Boolean)).toContain("c");
		expect(delta.rows.map((r) => r.text)).not.toContain("a");
		m.dispose();
	});

	it("stale epoch cursor answers as a fresh snapshot (spec §2)", async () => {
		const m = await mirrorWith("x\r\n", 10, 4);
		const old = serializePage(m, null);
		m.resize(12, 4); // epoch bump
		m.tick();
		const page = serializePage(m, old.cursor);
		expect(page.epoch).toBeGreaterThan(old.epoch);
		expect(page.rows.length).toBeGreaterThan(0); // full snapshot, not an error
		m.dispose();
	});

	it("pre-trim cursor never returns dropped lines and reports trimmedBefore (spec §6.2)", async () => {
		const m = await mirrorWith("seed\r\n", 10, 4);
		const early = serializePage(m, null);
		const total = 10_000 + 4 + 9;
		let chunk = "";
		for (let i = 0; i < total; i++) chunk += `l${i}\r\n`;
		m.write(chunk);
		await m.drained();
		m.tick();
		const page = serializePage(m, early.cursor);
		expect(page.trimmedBefore).toBe(m.trimmedBefore);
		for (const row of page.rows)
			expect(row.line).toBeGreaterThanOrEqual(page.trimmedBefore);
		m.dispose();
	}, 30_000);
});
