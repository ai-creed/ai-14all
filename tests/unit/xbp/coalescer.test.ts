// tests/unit/xbp/coalescer.test.ts
import { describe, it, expect, vi } from "vitest";
import { createCoalescer } from "../../../services/xbp/coalescer";

describe("createCoalescer", () => {
	it("collapses N rapid triggers into a single trailing call", () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const c = createCoalescer(fn, 250);
		c.trigger();
		c.trigger();
		c.trigger();
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(250);
		expect(fn).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});
});
