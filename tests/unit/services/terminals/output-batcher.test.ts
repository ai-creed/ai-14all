// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutputBatcher } from "../../../../services/terminals/output-batcher.js";

describe("OutputBatcher", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("aggregates chunks pushed within the time window into one flush call", () => {
		const flush = vi.fn();
		const batcher = new OutputBatcher(16, flush);
		batcher.push("hello ");
		batcher.push("world");
		expect(flush).not.toHaveBeenCalled();
		vi.advanceTimersByTime(16);
		expect(flush).toHaveBeenCalledTimes(1);
		expect(flush).toHaveBeenCalledWith("hello world");
	});

	it("forces a drain when buffered output exceeds the hard cap", () => {
		const flush = vi.fn();
		const batcher = new OutputBatcher(16, flush);
		const big = "x".repeat(300_000);
		batcher.push(big);
		expect(flush).toHaveBeenCalledTimes(1);
		expect(flush).toHaveBeenCalledWith(big);
	});

	it("drain() flushes immediately and clears the timer", () => {
		const flush = vi.fn();
		const batcher = new OutputBatcher(16, flush);
		batcher.push("pending");
		batcher.drain();
		expect(flush).toHaveBeenCalledWith("pending");
		vi.advanceTimersByTime(100);
		expect(flush).toHaveBeenCalledTimes(1);
	});

	it("drain() with no pending content is a no-op", () => {
		const flush = vi.fn();
		const batcher = new OutputBatcher(16, flush);
		batcher.drain();
		expect(flush).not.toHaveBeenCalled();
	});
});
