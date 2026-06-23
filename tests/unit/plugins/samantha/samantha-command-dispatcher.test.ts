import { describe, expect, it, vi } from "vitest";
import { createSamanthaCommandDispatcher } from "../../../../services/plugins/samantha/samantha-command-dispatcher";
import type { CommandFrame } from "../../../../services/plugins/samantha/command-types";
import type { ResolveResult } from "../../../../services/plugins/samantha/samantha-command-capabilities";

function frame(over: Partial<CommandFrame> = {}): CommandFrame {
	return {
		type: "command",
		capabilityId: "session-report",
		requestId: "req_1",
		...over,
	};
}

function make(
	over: Partial<Parameters<typeof createSamanthaCommandDispatcher>[0]> = {},
) {
	const focusWorktree = vi.fn();
	const cb = {
		buildReport: vi.fn(async () => "the report"),
		resolveWorktree: vi.fn(
			async (): Promise<ResolveResult> => ({
				kind: "found",
				worktreeId: "wt1",
			}),
		),
		focusWorktree,
		...over,
	};
	return { dispatcher: createSamanthaCommandDispatcher(cb), cb, focusWorktree };
}

describe("samantha-command-dispatcher", () => {
	it("routes session-report to buildReport and returns ok", async () => {
		const { dispatcher } = make();
		expect(
			await dispatcher.dispatch(frame({ capabilityId: "session-report" })),
		).toEqual({
			type: "commandResult",
			requestId: "req_1",
			status: "ok",
			result: { report: "the report" },
		});
	});

	it("focus-worktree found → focuses and returns ok { focused }", async () => {
		const { dispatcher, focusWorktree } = make();
		const r = await dispatcher.dispatch(
			frame({
				capabilityId: "focus-worktree",
				args: { worktree: "ai-14all/main" },
			}),
		);
		expect(focusWorktree).toHaveBeenCalledWith("wt1");
		expect(r).toEqual({
			type: "commandResult",
			requestId: "req_1",
			status: "ok",
			result: { focused: "ai-14all/main" },
		});
	});

	it("focus-worktree none → unknown-worktree, focus not called", async () => {
		const { dispatcher, focusWorktree } = make({
			resolveWorktree: async (): Promise<ResolveResult> => ({ kind: "none" }),
		});
		const r = await dispatcher.dispatch(
			frame({ capabilityId: "focus-worktree", args: { worktree: "x/y" } }),
		);
		expect(focusWorktree).not.toHaveBeenCalled();
		expect(r.status === "error" && r.error.code).toBe("unknown-worktree");
	});

	it("focus-worktree ambiguous → ambiguous-worktree, focus not called", async () => {
		const { dispatcher, focusWorktree } = make({
			resolveWorktree: async (): Promise<ResolveResult> => ({
				kind: "ambiguous",
				candidates: ["/a", "/b"],
			}),
		});
		const r = await dispatcher.dispatch(
			frame({
				capabilityId: "focus-worktree",
				args: { worktree: "ai-14all/main" },
			}),
		);
		expect(focusWorktree).not.toHaveBeenCalled();
		expect(r.status === "error" && r.error.code).toBe("ambiguous-worktree");
	});

	it("focus-worktree missing worktree arg → invalid-args", async () => {
		const { dispatcher } = make();
		const r = await dispatcher.dispatch(
			frame({ capabilityId: "focus-worktree", args: {} }),
		);
		expect(r.status === "error" && r.error.code).toBe("invalid-args");
	});

	it("unknown capability → unknown-capability", async () => {
		const { dispatcher } = make();
		const r = await dispatcher.dispatch(frame({ capabilityId: "nope" }));
		expect(r.status === "error" && r.error.code).toBe("unknown-capability");
	});

	it("a callback that throws → internal (exactly one result, no throw out)", async () => {
		const { dispatcher } = make({
			buildReport: async () => {
				throw new Error("boom");
			},
		});
		const r = await dispatcher.dispatch(
			frame({ capabilityId: "session-report" }),
		);
		expect(r).toEqual({
			type: "commandResult",
			requestId: "req_1",
			status: "error",
			error: { code: "internal", message: expect.any(String) },
		});
	});
});
