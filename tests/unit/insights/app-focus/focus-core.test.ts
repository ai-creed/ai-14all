import { describe, expect, it } from "vitest";
import {
	createFocusCore,
	type AppSpan,
} from "../../../../services/insights/app-focus/focus-core.js";

const S = 1000; // seconds → ms
const of = (spans: AppSpan[], kind: string): AppSpan[] =>
	spans.filter((s) => s.kind === kind);
const bounds = (spans: AppSpan[]): Array<[number, number]> =>
	spans.map((s) => [s.startMs, s.endMs]);

describe("focus-core", () => {
	it("segments focused spans at each poll; contiguous segments sum to the total", () => {
		const c = createFocusCore();
		c.start(0);
		c.focus(0);
		const p1 = c.idlePoll(15 * S, 0);
		const p2 = c.idlePoll(30 * S, 0);
		const b = c.blur(40 * S);
		expect(bounds(of(p1, "app.focused"))).toEqual([[0, 15 * S]]);
		expect(bounds(of(p2, "app.focused"))).toEqual([[15 * S, 30 * S]]);
		expect(bounds(of(b, "app.focused"))).toEqual([[30 * S, 40 * S]]);
		expect(of(b, "app.focused")[0].reason).toBe("blur");
		expect(of(p1, "app.focused")[0].reason).toBe("poll");
		const total = [...p1, ...p2, ...b]
			.filter((s) => s.kind === "app.focused")
			.reduce((n, s) => n + (s.endMs - s.startMs), 0);
		expect(total).toBe(40 * S);
	});

	it("engaged opens at focusTime: focus(0) then idle(0) at t=15 emits [0,15]", () => {
		const c = createFocusCore();
		c.start(0);
		c.focus(0);
		const p = c.idlePoll(15 * S, 0);
		expect(bounds(of(p, "app.engaged"))).toEqual([[0, 15 * S]]);
	});

	it("engaged ends at lastInput, not poll time: focus(0) then idle(5) at t=15 emits [0,10]", () => {
		const c = createFocusCore();
		c.start(0);
		c.focus(0);
		const p = c.idlePoll(15 * S, 5);
		expect(bounds(of(p, "app.engaged"))).toEqual([[0, 10 * S]]);
	});

	it("a later threshold-crossing poll adds no engaged duration past the true last input", () => {
		const c = createFocusCore();
		c.start(0);
		c.focus(0);
		c.idlePoll(15 * S, 5); // lastInput = 10s → engaged [0,10]
		const crossed = c.idlePoll(75 * S, 65); // lastInput = 10s → nothing to add
		expect(of(crossed, "app.engaged")).toEqual([]);
	});

	it("initial idle>=60 at focus emits no engaged segment (uniform guard)", () => {
		const c = createFocusCore();
		c.start(0);
		c.focus(0);
		const p = c.idlePoll(15 * S, 65); // lastInput = -50s <= engagedBoundary(0)
		expect(of(p, "app.engaged")).toEqual([]);
		// A later below-threshold poll reopens and subsequent polls accumulate.
		const reopen = c.idlePoll(90 * S, 1); // lastInput = 89s → reopen, emits nothing
		expect(of(reopen, "app.engaged")).toEqual([]);
		const after = c.idlePoll(105 * S, 1); // lastInput = 104s
		expect(bounds(of(after, "app.engaged"))).toEqual([[89 * S, 104 * S]]);
	});

	it("engaged never exists outside a focused span; blur with no focus is ignored", () => {
		const c = createFocusCore();
		c.start(0);
		expect(c.idlePoll(15 * S, 0)).toEqual([]); // no poll effect while blurred
		expect(c.blur(20 * S)).toEqual([]); // spurious blur → nothing
	});

	it("suspend closes focused + uptime; resume opens a new uptime interval", () => {
		const c = createFocusCore();
		c.start(0);
		c.focus(0);
		const s = c.suspend(30 * S);
		expect(bounds(of(s, "app.focused"))).toEqual([[0, 30 * S]]);
		expect(bounds(of(s, "app.uptime"))).toEqual([[0, 30 * S]]);
		expect(of(s, "app.uptime")[0].reason).toBe("suspend");
		c.resume(100 * S, false);
		const q = c.flush(160 * S);
		expect(bounds(of(q, "app.uptime"))).toEqual([[100 * S, 160 * S]]);
		expect(of(q, "app.uptime")[0].reason).toBe("quit");
	});

	it("stop (disable) drops open engagement but finalizes uptime", () => {
		const c = createFocusCore();
		c.start(0);
		c.focus(0);
		c.idlePoll(15 * S, 0);
		const stopped = c.stop(20 * S);
		expect(of(stopped, "app.focused")).toEqual([]);
		expect(of(stopped, "app.engaged")).toEqual([]);
		expect(bounds(of(stopped, "app.uptime"))).toEqual([[0, 20 * S]]);
		expect(of(stopped, "app.uptime")[0].reason).toBe("disabled");
	});

	it("clamps a backward clock jump to zero duration (never negative, never persisted)", () => {
		const c = createFocusCore();
		c.start(0);
		c.focus(10 * S);
		const b = c.blur(5 * S); // end < start
		expect(b).toEqual([]);
	});
});
