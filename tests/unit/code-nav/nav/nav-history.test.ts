import { describe, expect, it } from "vitest";
import type { CortexNavLocation } from "../../../../src/features/code-nav/nav/cortex-uri.js";
import { NavHistory } from "../../../../src/features/code-nav/nav/nav-history.js";

const loc = (file: string, line = 1): CortexNavLocation => ({
	workspaceId: "ws1",
	worktreeId: "wt1",
	file,
	line,
});

describe("NavHistory", () => {
	it("push/back/forward across one worktree", () => {
		const h = new NavHistory({ capacity: 5 });
		h.push("wt1", loc("a.ts"));
		h.push("wt1", loc("b.ts"));
		expect(h.back("wt1")?.file).toBe("a.ts");
		expect(h.forward("wt1")?.file).toBe("b.ts");
	});

	it("push clears forward stack", () => {
		const h = new NavHistory({ capacity: 5 });
		h.push("wt1", loc("a.ts"));
		h.push("wt1", loc("b.ts"));
		h.back("wt1");
		h.push("wt1", loc("c.ts"));
		expect(h.forward("wt1")).toBeNull();
	});

	it("respects ring-buffer capacity", () => {
		const h = new NavHistory({ capacity: 3 });
		for (let i = 0; i < 10; i++) h.push("wt1", loc(`f${i}.ts`));
		expect(h.size("wt1")).toBeLessThanOrEqual(3);
	});

	it("clear isolates worktrees", () => {
		const h = new NavHistory({ capacity: 5 });
		h.push("wt1", loc("a.ts"));
		h.push("wt2", loc("b.ts"));
		h.clear("wt1");
		expect(h.size("wt1")).toBe(0);
		expect(h.size("wt2")).toBe(1);
	});
});
