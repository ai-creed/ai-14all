import { describe, it, expect } from "vitest";
import { detectAttentionEvents } from "../../../services/xbp/push-wake-attention-detector";
import type { PushWakeAttentionSeenState } from "../../../services/xbp/push-wake-state-store";

const s = (worktreeId: string, attention: string) => ({
	worktreeId,
	attention,
});
const seen = (
	sessions: Record<string, "waiting" | "failed">,
): PushWakeAttentionSeenState => ({ sessions });

describe("detectAttentionEvents", () => {
	it("null baseline: records trigger-set members without firing", () => {
		const { events, next } = detectAttentionEvents(null, [
			s("a", "waiting"),
			s("b", "failed"),
			s("c", "active"),
		]);
		expect(events).toEqual([]);
		expect(next).toEqual(seen({ a: "waiting", b: "failed" }));
	});

	it("established-empty seen-state fires first-sight for the same snapshot", () => {
		const { events } = detectAttentionEvents(seen({}), [s("a", "waiting")]);
		expect(events).toEqual([{ trigger: "attention-waiting", worktreeId: "a" }]);
	});

	it("non-member -> waiting fires; non-member -> failed fires", () => {
		expect(detectAttentionEvents(seen({}), [s("a", "waiting")]).events).toEqual(
			[{ trigger: "attention-waiting", worktreeId: "a" }],
		);
		expect(detectAttentionEvents(seen({}), [s("a", "failed")]).events).toEqual([
			{ trigger: "attention-failed", worktreeId: "a" },
		]);
	});

	it("changed value inside the set fires, both directions", () => {
		expect(
			detectAttentionEvents(seen({ a: "waiting" }), [s("a", "failed")]).events,
		).toEqual([{ trigger: "attention-failed", worktreeId: "a" }]);
		expect(
			detectAttentionEvents(seen({ a: "failed" }), [s("a", "waiting")]).events,
		).toEqual([{ trigger: "attention-waiting", worktreeId: "a" }]);
	});

	it("unchanged member never re-fires", () => {
		expect(
			detectAttentionEvents(seen({ a: "waiting" }), [s("a", "waiting")]).events,
		).toEqual([]);
		expect(
			detectAttentionEvents(seen({ a: "failed" }), [s("a", "failed")]).events,
		).toEqual([]);
	});

	it("member -> non-member re-arms (drops from next) without firing", () => {
		const { events, next } = detectAttentionEvents(seen({ a: "waiting" }), [
			s("a", "active"),
		]);
		expect(events).toEqual([]);
		expect(next).toEqual(seen({}));
	});

	it("re-armed session fires again on re-entry", () => {
		const step1 = detectAttentionEvents(seen({ a: "waiting" }), [
			s("a", "active"),
		]);
		const step2 = detectAttentionEvents(step1.next, [s("a", "waiting")]);
		expect(step2.events).toEqual([
			{ trigger: "attention-waiting", worktreeId: "a" },
		]);
	});

	it("unknown attention values are ignored (treated as non-member)", () => {
		const { events, next } = detectAttentionEvents(seen({ a: "waiting" }), [
			s("a", "definitely-not-a-state"),
		]);
		expect(events).toEqual([]);
		expect(next).toEqual(seen({}));
	});

	it("ready is excluded by operator decision", () => {
		expect(detectAttentionEvents(seen({}), [s("a", "ready")]).events).toEqual(
			[],
		);
	});

	it("last-session-disappears/reappears: valid empty report prunes, reappearance fires as first sight", () => {
		const pruned = detectAttentionEvents(seen({ a: "waiting" }), []);
		expect(pruned.events).toEqual([]);
		expect(pruned.next).toEqual(seen({}));
		const back = detectAttentionEvents(pruned.next, [s("a", "waiting")]);
		expect(back.events).toEqual([
			{ trigger: "attention-waiting", worktreeId: "a" },
		]);
	});

	it("multiple sessions produce one event each, report order", () => {
		const { events } = detectAttentionEvents(seen({}), [
			s("a", "waiting"),
			s("b", "failed"),
		]);
		expect(events).toEqual([
			{ trigger: "attention-waiting", worktreeId: "a" },
			{ trigger: "attention-failed", worktreeId: "b" },
		]);
	});
});
