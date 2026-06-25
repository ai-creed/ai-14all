import { describe, expect, it } from "vitest";
import { createReconnectBackoff } from "../../../../services/plugins/samantha/reconnect-backoff";

describe("reconnect-backoff", () => {
	it("capped exponential curve with equal jitter — random pinned to 0 gives the floor (raw/2)", () => {
		const b = createReconnectBackoff({
			baseMs: 1000,
			factor: 2,
			capMs: 30000,
			random: () => 0,
		});
		expect(b.next()).toBe(500); // raw 1000 -> 500 + 0
		expect(b.next()).toBe(1000); // raw 2000 -> 1000
		expect(b.next()).toBe(2000); // raw 4000 -> 2000
	});

	it("random pinned to 1 gives the ceiling (full raw)", () => {
		const b = createReconnectBackoff({
			baseMs: 1000,
			factor: 2,
			capMs: 30000,
			random: () => 1,
		});
		expect(b.next()).toBe(1000); // 500 + 500
		expect(b.next()).toBe(2000); // 1000 + 1000
	});

	it("jitter at random=0.5 lands at raw/2 + raw/4", () => {
		const b = createReconnectBackoff({
			baseMs: 1000,
			factor: 2,
			capMs: 30000,
			random: () => 0.5,
		});
		expect(b.next()).toBe(750); // 500 + 0.5*500
	});

	it("respects the cap at high attempt counts", () => {
		const b = createReconnectBackoff({
			baseMs: 1000,
			factor: 2,
			capMs: 4000,
			random: () => 1,
		});
		b.next(); // raw 1000
		b.next(); // raw 2000
		b.next(); // raw 4000
		expect(b.next()).toBe(4000); // raw capped at 4000 -> full 4000
		expect(b.next()).toBe(4000); // still capped
	});

	it("reset() returns to base and zeroes attempt", () => {
		const b = createReconnectBackoff({
			baseMs: 1000,
			factor: 2,
			capMs: 30000,
			random: () => 0,
		});
		b.next();
		b.next();
		expect(b.attempt).toBe(2);
		b.reset();
		expect(b.attempt).toBe(0);
		expect(b.next()).toBe(500); // back to base
	});
});
