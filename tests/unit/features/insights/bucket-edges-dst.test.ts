import { afterAll, describe, expect, it } from "vitest";
import {
	dayEdges,
	startOfLocalDayMs,
} from "../../../../src/features/insights/bucketEdges";

// This file pins process.env.TZ to a zone that actually observes DST
// (America/New_York) so the DST-safety constraint has a guard that CAN fail:
// a fixed `+= 86_400_000` implementation would emit a wrong-length day (23h
// on spring-forward, 25h on fall-back) instead of tracking the real elapsed
// span. Node/V8 (this repo runs Node 24) re-resolve process.env.TZ on every
// Date/Intl call rather than caching it at process start, so mutating it here
// — before any Date is constructed by this file's own test bodies — is
// sufficient; no restart is required. This lives in its own file (never
// imported elsewhere) so the mutation can't bleed into other suites that
// share the same worker/fork, and it is restored in `afterAll` as a second
// safety net regardless.
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = "America/New_York";

afterAll(() => {
	if (ORIGINAL_TZ === undefined) delete process.env.TZ;
	else process.env.TZ = ORIGINAL_TZ;
});

// 2026 US DST: spring-forward Mar 8 (2:00am -> 3:00am, a 23h local day);
// fall-back Nov 1 (2:00am -> 1:00am, a 25h local day).
const SPRING_FORWARD = { y: 2026, m: 2, d: 8 }; // month is 0-based: 2 = March
const FALL_BACK = { y: 2026, m: 10, d: 1 }; // 10 = November

function edgeIndexForDate(
	edges: number[],
	y: number,
	m: number,
	d: number,
): number {
	return edges.findIndex((v) => {
		const dt = new Date(v);
		return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
	});
}

describe("dayEdges — real DST regression guard (America/New_York, TZ-pinned)", () => {
	it("sanity: the TZ pin actually took effect (America/New_York observes DST)", () => {
		// January (EST, UTC-5) vs July (EDT, UTC-4) must differ by an hour; if
		// the pin silently failed (e.g. a TZ that never observes DST, or a
		// cached ambient offset), these would be equal and every assertion
		// below would be vacuous.
		const janOffset = new Date(2026, 0, 1).getTimezoneOffset();
		const julOffset = new Date(2026, 6, 1).getTimezoneOffset();
		expect(janOffset).toBe(300); // EST = UTC-5
		expect(julOffset).toBe(240); // EDT = UTC-4
		expect(janOffset).not.toBe(julOffset);
	});

	it("spring-forward (2026-03-08) produces exactly one 23-hour consecutive-edge span, in REAL elapsed ms", () => {
		const edges = dayEdges(new Date(2026, 2, 10, 12, 0).getTime(), 7);
		const idx = edgeIndexForDate(
			edges,
			SPRING_FORWARD.y,
			SPRING_FORWARD.m,
			SPRING_FORWARD.d,
		);
		expect(idx).toBeGreaterThanOrEqual(0);
		expect(idx + 1).toBeLessThan(edges.length);
		const elapsedHours = (edges[idx + 1] - edges[idx]) / 3_600_000;
		expect(elapsedHours).toBe(23);
	});

	it("fall-back (2026-11-01) produces exactly one 25-hour consecutive-edge span, in REAL elapsed ms", () => {
		const edges = dayEdges(new Date(2026, 10, 4, 12, 0).getTime(), 7);
		const idx = edgeIndexForDate(edges, FALL_BACK.y, FALL_BACK.m, FALL_BACK.d);
		expect(idx).toBeGreaterThanOrEqual(0);
		expect(idx + 1).toBeLessThan(edges.length);
		const elapsedHours = (edges[idx + 1] - edges[idx]) / 3_600_000;
		expect(elapsedHours).toBe(25);
	});

	it("every emitted edge across both transitions is self-normalized (equals startOfLocalDayMs of itself)", () => {
		const edges = [
			...dayEdges(new Date(2026, 2, 10, 12, 0).getTime(), 10),
			...dayEdges(new Date(2026, 10, 4, 12, 0).getTime(), 10),
		];
		expect(edges.length).toBeGreaterThan(0);
		for (const v of edges) {
			expect(v).toBe(startOfLocalDayMs(v));
			expect(new Date(v).getHours()).toBe(0);
		}
	});

	it("a fixed 86,400,000ms step would fail: consecutive non-transition days ARE exactly 24h (control case)", () => {
		// Control: away from either transition, every consecutive pair IS a
		// plain 24h span — the 23h/25h spans above are specific to the
		// transition dates, not a general property of dayEdges' output.
		const edges = dayEdges(new Date(2026, 5, 15, 12, 0).getTime(), 7); // mid-June, no transition nearby
		for (let i = 1; i < edges.length; i++) {
			expect(edges[i] - edges[i - 1]).toBe(24 * 3_600_000);
		}
	});
});
