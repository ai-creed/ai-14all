import { describe, expect, it } from "vitest";
import { PtyMirror } from "../../../../services/pty-inspect/pty-mirror";

function writeAll(m: PtyMirror, data: string): Promise<void> {
	m.write(data);
	return m.drained();
}

describe("PtyMirror core", () => {
	it("constructs at the given geometry with proposed API enabled (buffer access does not throw)", () => {
		const m = new PtyMirror({ cols: 80, rows: 24 });
		expect(m.cols).toBe(80);
		expect(m.rows).toBe(24);
		expect(m.trimmedBefore).toBe(0);
		// buffer getter throws without allowProposedApi — reading a line proves it is on.
		expect(() => m.snapshotLineText(0)).not.toThrow();
		m.dispose();
	});

	it("drained() resolves only after queued writes have parsed", async () => {
		const m = new PtyMirror({ cols: 20, rows: 5 });
		m.write("hello");
		await m.drained();
		expect(m.snapshotLineText(0)).toBe("hello");
		m.dispose();
	});

	it("RIS (\\x1bc) bumps the epoch after the carrying write has parsed, and clears the buffer", async () => {
		const m = new PtyMirror({ cols: 20, rows: 5 });
		await writeAll(m, "old-row\r\n");
		const before = m.epoch;
		await writeAll(m, "\x1bc");
		expect(m.epoch).toBeGreaterThan(before);
		expect(m.trimmedBefore).toBe(0); // re-baselined
		expect(m.snapshotLineText(0)).toBe("");
		m.dispose();
	});

	it("ED 3 (\\x1b[3J) bumps the epoch", async () => {
		const m = new PtyMirror({ cols: 20, rows: 5 });
		await writeAll(m, "a\r\nb\r\nc\r\n");
		const before = m.epoch;
		await writeAll(m, "\x1b[3J");
		expect(m.epoch).toBeGreaterThan(before);
		m.dispose();
	});

	it("resize and alt-screen enter/exit bump the epoch", async () => {
		const m = new PtyMirror({ cols: 20, rows: 5 });
		const e0 = m.epoch;
		m.resize(30, 10);
		expect(m.epoch).toBeGreaterThan(e0);
		const e1 = m.epoch;
		await writeAll(m, "\x1b[?1049h"); // alt-screen enter
		expect(m.epoch).toBeGreaterThan(e1);
		expect(m.altScreen).toBe(true);
		const e2 = m.epoch;
		await writeAll(m, "\x1b[?1049l"); // alt-screen exit
		expect(m.epoch).toBeGreaterThan(e2);
		expect(m.altScreen).toBe(false);
		m.dispose();
	});

	it("reset settling blocks ticks until the write callback re-baselines; nothing old-epoch escapes (spec §2 barrier)", async () => {
		const m = new PtyMirror({ cols: 20, rows: 5 });
		await writeAll(m, "old\r\n");
		m.tick();
		const oldEpoch = m.epoch;
		await writeAll(m, "\rchanged"); // dirty a row so the barrier tick has something to (not) stamp
		m.armResetForTest(); // same code path as the ESC-c / CSI-3J handlers
		expect(m.isResetSettling).toBe(true);
		expect(m.tick()).toBe(false); // coalescer barrier: no stamp, no hint
		let released = false;
		const gate = m.settled().then(() => {
			released = true;
		});
		await Promise.resolve();
		expect(released).toBe(false); // pulls awaiting settled() are held
		m.settleResetForTest(); // same code path as the write completion callback
		await gate;
		expect(m.epoch).toBeGreaterThan(oldEpoch); // re-baselined before any serialization
		m.dispose();
	});

	it("setEpochFloor immediately advances the epoch strictly above the floor (rebind continuity)", () => {
		const m = new PtyMirror({ cols: 20, rows: 5 });
		m.setEpochFloor(41);
		expect(m.epoch).toBe(42); // strictly greater at once — the rebind hint must already carry it
		m.setEpochFloor(10); // a lower floor never regresses the epoch
		expect(m.epoch).toBe(42);
		m.dispose();
	});
});

describe("PtyMirror trim + dirty tracking", () => {
	it("computes exact trimmedBefore past capacity and keeps absolute IDs stable (spec §6.2)", async () => {
		const m = new PtyMirror({ cols: 20, rows: 5 });
		const capacity = 10_000; // TERMINAL_SCROLLBACK_ROWS
		const total = capacity + 5 + 37; // scrolls 37 lines past saturation
		let chunk = "";
		for (let i = 0; i < total; i++) chunk += `line-${i}\r\n`;
		await writeAll(m, chunk);
		const scrolled = total - (m.rows - 1); // first rows-1 line feeds move the cursor without scrolling
		expect(m.trimmedBefore).toBe(scrolled - capacity);
		// Cross-check against buffer-length accounting (spec §2: both mechanisms agree).
		expect(m.trimmedBefore).toBe(scrolled - (m.buffer.length - m.rows));
		// Surviving row keeps its absolute ID: retained index 0 is absoluteLine trimmedBefore.
		expect(m.snapshotLineText(0)).toBe(`line-${m.trimmedBefore}`);
		m.dispose();
	}, 30_000);

	it("a 10Hz spinner dirties exactly one row per tick (spec §6.1)", async () => {
		const m = new PtyMirror({ cols: 20, rows: 5 });
		await writeAll(m, "header\r\nspinner: |");
		m.tick(); // baseline stamp
		await writeAll(m, "\rspinner: /"); // in-place redraw of the same row
		const changed = m.tick();
		expect(changed).toBe(true);
		const w = m.watermark;
		const stampedNow = [...m.takeStamps()].filter(([, wm]) => wm === w);
		expect(stampedNow).toHaveLength(1);
		m.dispose();
	});

	it("a burst larger than the viewport stamps every appended row (spec §2)", async () => {
		const m = new PtyMirror({ cols: 10, rows: 4 });
		await writeAll(m, "seed\r\n");
		m.tick();
		const before = m.watermark;
		let burst = "";
		for (let i = 0; i < 20; i++) burst += `b${i}\r\n`; // 20 rows through a 4-row viewport
		await writeAll(m, burst);
		m.tick();
		const stamped = [...m.takeStamps()].filter(([, wm]) => wm > before);
		// Every appended row is stamped, including the ones that scrolled out
		// of the viewport before this tick ran.
		expect(stamped.length).toBeGreaterThanOrEqual(20);
		m.dispose();
	});

	it("tick with no writes stamps nothing and returns false", async () => {
		const m = new PtyMirror({ cols: 20, rows: 5 });
		await writeAll(m, "x");
		m.tick();
		expect(m.tick()).toBe(false);
		m.dispose();
	});

	it("trim accounting survives an epoch bump on a saturated buffer (spec §6.2)", async () => {
		const m = new PtyMirror({ cols: 20, rows: 5 });
		const capacity = 10_000;
		// Saturate: total such that scrolled = total - (rows-1) = capacity + 10
		const total = capacity + 10 + (5 - 1);
		let chunk = "";
		for (let i = 0; i < total; i++) chunk += `line-${i}\r\n`;
		await writeAll(m, chunk);
		expect(m.trimmedBefore).toBe(10); // pre-bump sanity
		m.resize(21, 5); // epoch bump; buffer keeps its scrollback
		expect(m.trimmedBefore).toBe(0); // fresh epoch, fresh trim space
		// Buffer is still at capacity: EVERY further scrolled line is a real trim.
		await writeAll(m, "after-0\r\nafter-1\r\nafter-2\r\n");
		expect(m.trimmedBefore).toBe(3); // must count immediately, not after 10k
		// Absolute ID ground truth: retained index 0 is absoluteLine trimmedBefore.
		expect(m.snapshotLineText(0)).not.toBe(""); // sanity: buffer non-empty
		// Departed-viewport stamping must not stall across the bump: the rows
		// that scrolled out post-bump are stamped, not silently dropped.
		m.tick();
		const stampedAbs = [...m.takeStamps().keys()];
		expect(stampedAbs.length).toBeGreaterThan(0);
		m.dispose();
	}, 30_000);
});
