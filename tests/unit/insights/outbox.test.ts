import { describe, expect, it, vi } from "vitest";
import { Outbox, type OutboxEvent } from "../../../services/insights/outbox.js";
import type { ObservationInput } from "../../../services/insights/store/observations.js";

const ev = (id: string): OutboxEvent => ({
	eventId: id,
	observation: { eventId: id } as unknown as ObservationInput,
});

describe("Outbox", () => {
	it("buffers on add, removes on ack, and lists what still needs replay", () => {
		const o = new Outbox();
		o.add(ev("a"));
		o.add(ev("b"));
		expect(o.pending().map((e) => e.eventId)).toEqual(["a", "b"]);
		o.ack("a");
		expect(o.pending().map((e) => e.eventId)).toEqual(["b"]);
		expect(o.size).toBe(1);
	});

	it("ack of an unknown id is a no-op; re-adding the same id does not duplicate", () => {
		const o = new Outbox();
		o.add(ev("a"));
		o.ack("zzz");
		o.add(ev("a"));
		expect(o.pending().map((e) => e.eventId)).toEqual(["a"]);
	});

	it("bounds at the cap, dropping the OLDEST and reporting the drop", () => {
		const onDrop = vi.fn();
		const o = new Outbox(3, onDrop);
		o.add(ev("a"));
		o.add(ev("b"));
		o.add(ev("c"));
		o.add(ev("d")); // overflow → "a" drops
		expect(o.pending().map((e) => e.eventId)).toEqual(["b", "c", "d"]);
		expect(o.size).toBe(3);
		expect(o.droppedCount).toBe(1);
		expect(onDrop).toHaveBeenCalledWith(1, "a");
	});

	it("re-adding an existing unacked event keeps its original FIFO slot, including for eviction order", () => {
		const onDrop = vi.fn();
		const o = new Outbox(3, onDrop);
		o.add(ev("a"));
		o.add(ev("b"));
		o.add(ev("c"));
		o.add(ev("a")); // re-add — must not jump to the back
		expect(o.pending().map((e) => e.eventId)).toEqual(["a", "b", "c"]);

		o.add(ev("d")); // overflow at cap 3 → oldest is still "a"
		expect(onDrop).toHaveBeenCalledWith(1, "a");
		expect(o.pending().map((e) => e.eventId)).toEqual(["b", "c", "d"]);
	});

	it("droppedCount accumulates across separate overflow events, and onDrop reports the cumulative total", () => {
		const onDrop = vi.fn();
		const o = new Outbox(3, onDrop);
		o.add(ev("a"));
		o.add(ev("b"));
		o.add(ev("c"));
		o.add(ev("d")); // first, separate overflow → "a" drops
		expect(onDrop).toHaveBeenLastCalledWith(1, "a");
		expect(o.droppedCount).toBe(1);

		o.add(ev("e")); // second, separate overflow → "b" drops
		expect(onDrop).toHaveBeenLastCalledWith(2, "b");
		expect(o.droppedCount).toBe(2);
		expect(o.pending().map((e) => e.eventId)).toEqual(["c", "d", "e"]);
	});

	it("clear() discards everything (the delete-all path)", () => {
		const o = new Outbox();
		o.add(ev("a"));
		o.add(ev("b"));
		o.clear();
		expect(o.pending()).toEqual([]);
		expect(o.size).toBe(0);
	});
});
