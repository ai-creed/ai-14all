import { describe, expect, it, vi } from "vitest";
import { WorktreeWatcher } from "../../../electron/code-nav/watch/worktree-watcher.js";

function makeFakeChokidar() {
	const handlers = new Map<string, Array<(p: string) => void>>();
	const close = vi.fn();
	return {
		emit(ev: string, p: string) {
			(handlers.get(ev) ?? []).forEach((h) => h(p));
		},
		watch() {
			return this;
		},
		on(ev: string, cb: (p: string) => void) {
			const arr = handlers.get(ev) ?? [];
			arr.push(cb);
			handlers.set(ev, arr);
			return this;
		},
		close,
	};
}

describe("WorktreeWatcher", () => {
	it("debounces events to a single batch", async () => {
		vi.useFakeTimers();
		const onBatch = vi.fn();
		const fakeChokidar = makeFakeChokidar();
		const w = new WorktreeWatcher({
			chokidar: fakeChokidar as never,
			debounceMs: 500,
			onBatch,
		});
		w.watch({ worktreePath: "/wt" });
		fakeChokidar.emit("change", "/wt/a.ts");
		fakeChokidar.emit("change", "/wt/b.ts");
		await vi.advanceTimersByTimeAsync(499);
		expect(onBatch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(2);
		expect(onBatch).toHaveBeenCalledTimes(1);
		expect(onBatch.mock.calls[0][0].changedFiles).toEqual(
			expect.arrayContaining(["/wt/a.ts", "/wt/b.ts"]),
		);
		vi.useRealTimers();
	});

	it("filters by extension and ignored dirs", async () => {
		const onBatch = vi.fn();
		const fakeChokidar = makeFakeChokidar();
		const w = new WorktreeWatcher({
			chokidar: fakeChokidar as never,
			debounceMs: 1,
			onBatch,
		});
		w.watch({ worktreePath: "/wt" });
		fakeChokidar.emit("change", "/wt/node_modules/x.ts");
		fakeChokidar.emit("change", "/wt/a.png");
		fakeChokidar.emit("change", "/wt/keep.ts");
		await new Promise((r) => setTimeout(r, 5));
		expect(onBatch).toHaveBeenCalledTimes(1);
		expect(onBatch.mock.calls[0][0].changedFiles).toEqual(["/wt/keep.ts"]);
	});
});
