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
