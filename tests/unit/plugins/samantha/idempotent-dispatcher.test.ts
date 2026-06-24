import { describe, expect, it, vi } from "vitest";
import { createIdempotentDispatcher } from "../../../../services/plugins/samantha/idempotent-dispatcher";
import {
	type CommandFrame,
	type CommandResult,
	errorResult,
	okResult,
} from "../../../../services/plugins/samantha/command-types";

function frame(requestId: string, over: Partial<CommandFrame> = {}): CommandFrame {
	return {
		type: "command",
		capabilityId: "session-report",
		requestId,
		...over,
	};
}

describe("idempotent-dispatcher", () => {
	it("a fresh requestId calls inner once; a duplicate replays without re-calling inner", async () => {
		const inner = {
			dispatch: vi.fn(async (f: CommandFrame) => okResult(f.requestId, { v: 1 })),
		};
		const d = createIdempotentDispatcher(inner, { ttlMs: 1000, max: 10, now: () => 0 });
		const r1 = await d.dispatch(frame("A"));
		const r2 = await d.dispatch(frame("A"));
		expect(r1).toEqual(r2);
		expect(inner.dispatch).toHaveBeenCalledTimes(1);
	});

	it("a concurrent duplicate coalesces — inner once, both callers get the same result", async () => {
		let resolve!: (r: CommandResult) => void;
		const inner = {
			dispatch: vi.fn(
				() => new Promise<CommandResult>((res) => { resolve = res; }),
			),
		};
		const d = createIdempotentDispatcher(inner, { ttlMs: 1000, max: 10, now: () => 0 });
		const p1 = d.dispatch(frame("A"));
		const p2 = d.dispatch(frame("A"));
		expect(inner.dispatch).toHaveBeenCalledTimes(1);
		resolve(okResult("A", { v: 1 }));
		expect(await p1).toEqual(await p2);
		expect(inner.dispatch).toHaveBeenCalledTimes(1);
	});

	it("caches and replays an error result without re-calling inner", async () => {
		const inner = {
			dispatch: vi.fn(async (f: CommandFrame) =>
				errorResult(f.requestId, "no-live-agent", "none"),
			),
		};
		const d = createIdempotentDispatcher(inner, { ttlMs: 1000, max: 10, now: () => 0 });
		const r1 = await d.dispatch(frame("A"));
		const r2 = await d.dispatch(frame("A"));
		expect(r1).toEqual(r2);
		expect(r1.status === "error" && r1.error.code).toBe("no-live-agent");
		expect(inner.dispatch).toHaveBeenCalledTimes(1);
	});

	it("after ttlMs a duplicate re-executes (entry expired)", async () => {
		let t = 0;
		const inner = {
			dispatch: vi.fn(async (f: CommandFrame) => okResult(f.requestId, {})),
		};
		const d = createIdempotentDispatcher(inner, { ttlMs: 100, max: 10, now: () => t });
		await d.dispatch(frame("A")); // ts = 0
		t = 101; // 0 + 100 < 101 -> expired
		await d.dispatch(frame("A"));
		expect(inner.dispatch).toHaveBeenCalledTimes(2);
	});

	it("an expired entry is reclaimed so a new command is admitted once the cache is full", async () => {
		let t = 0;
		const inner = {
			dispatch: vi.fn(async (f: CommandFrame) => okResult(f.requestId, {})),
		};
		const d = createIdempotentDispatcher(inner, { ttlMs: 100, max: 1, now: () => t });
		await d.dispatch(frame("A")); // ts = 0, cache full (max 1)
		t = 50; // A still live -> cache full of live entries
		const refused = await d.dispatch(frame("B"));
		expect(refused.status === "error" && refused.error.code).toBe("internal");
		t = 201; // A expired
		const admitted = await d.dispatch(frame("C"));
		expect(admitted.status).toBe("ok");
		expect(inner.dispatch).toHaveBeenCalledTimes(2); // A and C only; B refused
	});

	it("exactly-once under overflow: a full-of-live cache refuses a NEW id but still replays a live id", async () => {
		const t = 0;
		const inner = {
			dispatch: vi.fn(async (f: CommandFrame) => okResult(f.requestId, { id: f.requestId })),
		};
		const d = createIdempotentDispatcher(inner, { ttlMs: 1000, max: 2, now: () => t });
		await d.dispatch(frame("A"));
		await d.dispatch(frame("B"));
		expect(inner.dispatch).toHaveBeenCalledTimes(2);
		// (a) a re-sent LIVE id replays without re-calling inner
		const replay = await d.dispatch(frame("A"));
		expect(replay).toEqual(okResult("A", { id: "A" }));
		expect(inner.dispatch).toHaveBeenCalledTimes(2);
		// (b) a NEW id is refused (retryable internal) — no live entry is evicted
		const refused = await d.dispatch(frame("C"));
		expect(refused.status === "error" && refused.error.code).toBe("internal");
		expect(inner.dispatch).toHaveBeenCalledTimes(2);
		// A and B are still resident -> still replay (never evicted)
		await d.dispatch(frame("A"));
		await d.dispatch(frame("B"));
		expect(inner.dispatch).toHaveBeenCalledTimes(2);
	});

	it("an inner rejection clears the entry (requestId stays retryable) and propagates", async () => {
		let calls = 0;
		const inner = {
			dispatch: vi.fn(async (f: CommandFrame) => {
				calls += 1;
				if (calls === 1) throw new Error("boom");
				return okResult(f.requestId, {});
			}),
		};
		const d = createIdempotentDispatcher(inner, { ttlMs: 1000, max: 10, now: () => 0 });
		await expect(d.dispatch(frame("A"))).rejects.toThrow("boom");
		// entry was cleared -> a retry of the SAME id calls inner again and succeeds
		const r = await d.dispatch(frame("A"));
		expect(r.status).toBe("ok");
		expect(calls).toBe(2);
	});
});
