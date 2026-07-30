import { describe, expect, it } from "vitest";
import { calibrateClock, cdpToWallMs } from "../../../scripts/hero/clock";

const sample = (cdp: number, wall: number) => ({
	cdpTimestamp: cdp,
	wallClockAtReceipt: wall,
});

describe("calibrateClock", () => {
	it("recovers a constant offset from clean samples (monotonic-origin CDP clock)", () => {
		// CDP clock origin ~arbitrary: cdp seconds small, wall ms huge.
		const offset = 1_700_000_000_000;
		const samples = [0.1, 0.2, 0.3, 0.4, 0.5].map(
			(t) => sample(t, t * 1000 + offset + 2), // +2ms receipt latency
		);
		const cal = calibrateClock(samples);
		expect(cal.offsetMs).toBeCloseTo(offset + 2, 6);
		expect(cal.residualSpreadMs).toBeLessThan(1);
		expect(cdpToWallMs(0.6, cal)).toBeCloseTo(600 + offset + 2, 6);
	});

	it("is ≈0-offset when CDP already emits epoch seconds", () => {
		const samples = [1, 2, 3, 4, 5].map((t) =>
			sample(1_700_000_000 + t, (1_700_000_000 + t) * 1000 + 3),
		);
		expect(calibrateClock(samples).offsetMs).toBeCloseTo(3, 6);
	});

	it("median rejects outlier receipt latencies", () => {
		const clean = [0.1, 0.2, 0.3, 0.4].map((t) => sample(t, t * 1000 + 5));
		const outlier = sample(0.5, 500 + 400); // one 400ms-late receipt
		const cal = calibrateClock([...clean, outlier]);
		expect(cal.offsetMs).toBeCloseTo(5, 6);
		expect(cal.residualSpreadMs).toBeCloseTo(395, 6);
	});

	it("throws below 5 samples", () => {
		expect(() => calibrateClock([sample(1, 1000)])).toThrow(/>=5/);
	});
});
