import { describe, expect, it } from "vitest";
import {
	buildZoompanFilter,
	keyframesFromBeats,
	normalizeRectToAspect,
} from "../../../scripts/hero/gen-camera";

const FRAME = { x: 0, y: 0, w: 2880, h: 1520 };
const ASPECT = 1600 / 844;

describe("normalizeRectToAspect", () => {
	it("grows a tall thin rect (sidebar) to the output aspect around its center", () => {
		const sidebar = { x: 0, y: 40, w: 480, h: 1480 };
		const r = normalizeRectToAspect(sidebar, FRAME, ASPECT);
		expect(r.w / r.h).toBeCloseTo(ASPECT, 3);
		expect(r.w).toBeGreaterThan(sidebar.w); // grew, never shrank content
		expect(r.h).toBeGreaterThanOrEqual(sidebar.h);
	});

	it("clamps inside the frame (rect near an edge shifts, not crops)", () => {
		const r = normalizeRectToAspect(
			{ x: 2700, y: 100, w: 150, h: 900 },
			FRAME,
			ASPECT,
		);
		expect(r.x).toBeGreaterThanOrEqual(0);
		expect(r.y).toBeGreaterThanOrEqual(0);
		expect(r.x + r.w).toBeLessThanOrEqual(FRAME.w);
		expect(r.y + r.h).toBeLessThanOrEqual(FRAME.h);
	});

	it("adds the margin fraction", () => {
		const tight = { x: 1000, y: 500, w: 800, h: 800 / ASPECT };
		const r = normalizeRectToAspect(tight, FRAME, ASPECT, 0.06);
		expect(r.w).toBeCloseTo(800 * 1.06, 0);
	});
});

describe("keyframesFromBeats", () => {
	it("emits settle and settle+hold keyframes per beat, full frame for null rects", () => {
		const kf = keyframesFromBeats(
			[
				{ beat: "establish", settle: 0, hold: 2.5, rect: null },
				{
					beat: "sidebar",
					settle: 4.5,
					hold: 3,
					rect: { x: 0, y: 40, w: 480, h: 1480 },
				},
			],
			FRAME,
		);
		expect(kf).toHaveLength(4);
		expect(kf[0]).toMatchObject({ t: 0, rect: FRAME });
		expect(kf[1]).toMatchObject({ t: 2.5, rect: FRAME });
		expect(kf[2].t).toBe(4.5);
		expect(kf[3].t).toBe(7.5);
		expect(kf[2].rect.w / kf[2].rect.h).toBeCloseTo(1600 / 844, 3);
	});
});

describe("buildZoompanFilter", () => {
	it("golden: the COMPLETE filter string for a known two-beat storyboard", () => {
		// One full-frame beat + one non-saturating rect beat (small enough that
		// normalizeRectToAspect does NOT grow it to the full frame) so the
		// smoothstep glide, x/y interpolation, and width interpolation all
		// genuinely appear (not collapse to constants) in the string.
		const kf = keyframesFromBeats(
			[
				{ beat: "establish", settle: 0, hold: 2, rect: null },
				{
					beat: "sidebar",
					settle: 4,
					hold: 2,
					rect: { x: 1200, y: 300, w: 600, h: 400 },
				},
			],
			FRAME,
		);
		const filter = buildZoompanFilter(kf, {
			iw: 2880,
			ih: 1520,
			ow: 1600,
			oh: 844,
			fps: 60,
		});
		// TRUE golden (spec §8): the complete normalized string. Vitest
		// materializes the snapshot on the first run; commit it with this test.
		// Any change to interpolation branches, x/y expressions, or keyframe
		// boundaries then fails until the snapshot is deliberately updated.
		expect(filter).toMatchInlineSnapshot(
			"\"zoompan=z='2880/(if(lt((in/60),2),2880,if(lt((in/60),4),(2880+-2076.208530805687*clip(((in/60)-2)/(2),0,1)*clip(((in/60)-2)/(2),0,1)*(3-2*clip(((in/60)-2)/(2),0,1))),if(lt((in/60),6),803.7914691943129,803.7914691943129))))':x='if(lt((in/60),2),0,if(lt((in/60),4),(0+1098.1042654028436*clip(((in/60)-2)/(2),0,1)*clip(((in/60)-2)/(2),0,1)*(3-2*clip(((in/60)-2)/(2),0,1))),if(lt((in/60),6),1098.1042654028436,1098.1042654028436)))':y='if(lt((in/60),2),0,if(lt((in/60),4),(0+288*clip(((in/60)-2)/(2),0,1)*clip(((in/60)-2)/(2),0,1)*(3-2*clip(((in/60)-2)/(2),0,1))),if(lt((in/60),6),288,288)))':d=1:s=1600x844:fps=60,format=yuv420p\"",
		);
		// Structural invariants on top (guard the snapshot-update path too):
		expect(filter.startsWith("zoompan=z='2880/(")).toBe(true);
		expect(filter.endsWith(":d=1:s=1600x844:fps=60,format=yuv420p")).toBe(true);
		expect(filter).toContain("*(3-2*"); // smoothstep present in the glide
		expect(
			(filter.match(/if\(lt\(\(in\/60\)/g) ?? []).length,
		).toBeGreaterThanOrEqual(6); // piecewise segments in z, x, and y
	});

	it("guards zero-length segments (adjacent keyframes sharing a timestamp) against division by zero", () => {
		// beat2.settle === beat1.settle + beat1.hold: the hold-end of beat1 and
		// the settle-start of beat2 land on the same timestamp, producing a
		// zero-length segment between two keyframes with different rects.
		const kf = keyframesFromBeats(
			[
				{ beat: "establish", settle: 0, hold: 2, rect: null },
				{
					beat: "sidebar",
					settle: 2,
					hold: 2,
					rect: { x: 1200, y: 300, w: 600, h: 400 },
				},
			],
			FRAME,
		);
		const filter = buildZoompanFilter(kf, {
			iw: 2880,
			ih: 1520,
			ow: 1600,
			oh: 844,
			fps: 60,
		});
		expect(filter).not.toContain("/(0)");
	});
});
