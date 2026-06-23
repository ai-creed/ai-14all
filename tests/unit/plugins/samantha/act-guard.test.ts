import { describe, expect, it, vi } from "vitest";
import { createActGuard, type PrepResult } from "../../../../services/plugins/samantha/act-guard";

function make(over: Partial<Parameters<typeof createActGuard>[0]> = {}) {
	const audit = vi.fn();
	const execute = vi.fn(async () => ({ ok: true, detail: "delivered" }));
	const deps = {
		verifyToken: () => true,
		isActingEnabled: () => true,
		execute,
		audit,
		now: () => 1000,
		...over,
	};
	return { guard: createActGuard(deps), audit, execute };
}

const okPrep: () => Promise<PrepResult> = async () => ({
	ok: true,
	worktreeId: "wt1",
	instruction: "add tests",
	decision: { kind: "send-input", sessionId: "sess_1", data: "add tests" },
});

describe("act-guard", () => {
	it("invalid token → unauthorized; prepare/execute never called; one result audit", async () => {
		const prepare = vi.fn(okPrep);
		const { guard, execute, audit } = make({ verifyToken: () => false });
		const r = await guard.run({ token: "x", prepare });
		expect(r).toEqual({ ok: false, code: "unauthorized", message: expect.any(String) });
		expect(prepare).not.toHaveBeenCalled();
		expect(execute).not.toHaveBeenCalled();
		expect(audit).toHaveBeenCalledTimes(1);
		expect(audit).toHaveBeenCalledWith(
			expect.objectContaining({ phase: "result", rejectCode: "unauthorized" }),
		);
	});

	it("acting disabled → acting-disabled; prepare/execute never called", async () => {
		const prepare = vi.fn(okPrep);
		const { guard, execute } = make({ isActingEnabled: () => false });
		const r = await guard.run({ token: "tok", prepare });
		expect(r).toEqual({ ok: false, code: "acting-disabled", message: expect.any(String) });
		expect(prepare).not.toHaveBeenCalled();
		expect(execute).not.toHaveBeenCalled();
	});

	it("prepare error (unknown-worktree) → that code; execute not called", async () => {
		const { guard, execute } = make();
		const r = await guard.run({
			token: "tok",
			prepare: async () => ({ ok: false, code: "unknown-worktree", message: "no wt" }),
		});
		expect(r).toEqual({ ok: false, code: "unknown-worktree", message: "no wt" });
		expect(execute).not.toHaveBeenCalled();
	});

	it("router reject → reject code; execute not called; one result audit", async () => {
		const { guard, execute, audit } = make();
		const r = await guard.run({
			token: "tok",
			prepare: async () => ({
				ok: true,
				worktreeId: "wt1",
				instruction: "go",
				decision: { kind: "reject", code: "session-busy", reason: "busy" },
			}),
		});
		expect(r).toEqual({ ok: false, code: "session-busy", message: "busy" });
		expect(execute).not.toHaveBeenCalled();
		expect(audit).toHaveBeenCalledWith(
			expect.objectContaining({ phase: "result", route: "reject", rejectCode: "session-busy" }),
		);
	});

	it("happy path → audits START then RESULT, executes, returns routed", async () => {
		const { guard, execute, audit } = make();
		const r = await guard.run({ token: "tok", prepare: okPrep });
		expect(r).toEqual({ ok: true, routed: "send-input" });
		expect(execute).toHaveBeenCalledWith("wt1", {
			kind: "send-input",
			sessionId: "sess_1",
			data: "add tests",
		});
		expect(audit).toHaveBeenCalledTimes(2);
		expect(audit).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ phase: "start", route: "send-input", result: null }),
		);
		expect(audit).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ phase: "result", route: "send-input", result: { ok: true, detail: "delivered" } }),
		);
	});

	it("execute fails → internal with the detail; still audits start + result", async () => {
		const { guard, audit } = make({ execute: async () => ({ ok: false, detail: "exit 1" }) });
		const r = await guard.run({ token: "tok", prepare: okPrep });
		expect(r).toEqual({ ok: false, code: "internal", message: "exit 1" });
		expect(audit).toHaveBeenCalledTimes(2);
	});

	it("execute THROWS (e.g. stale PTY session) → internal; STILL audits start + result", async () => {
		const { guard, audit } = make({
			execute: async () => {
				throw new Error("Terminal session not found: sess_1");
			},
		});
		const r = await guard.run({ token: "tok", prepare: okPrep });
		expect(r).toEqual({
			ok: false,
			code: "internal",
			message: "Terminal session not found: sess_1",
		});
		// The result audit MUST still fire — a thrown execute cannot leave a start
		// entry with no matching result entry.
		expect(audit).toHaveBeenCalledTimes(2);
		expect(audit).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ phase: "start", route: "send-input", result: null }),
		);
		expect(audit).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				phase: "result",
				route: "send-input",
				result: { ok: false, detail: "Terminal session not found: sess_1" },
			}),
		);
	});
});
