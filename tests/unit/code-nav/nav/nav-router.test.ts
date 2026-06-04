import { describe, expect, it, vi } from "vitest";
import { NavHistory } from "../../../../src/features/code-nav/nav/nav-history.js";
import { NavRouter } from "../../../../src/features/code-nav/nav/nav-router.js";

const target = {
	workspaceId: "ws1",
	worktreeId: "wt1",
	file: "src/u.ts",
	line: 5,
	source: "definition" as const,
};

function setup(opts: { paneTransient?: boolean } = {}) {
	const history = new NavHistory({ capacity: 5 });
	const dispatch = vi.fn();
	const toast = vi.fn();
	const getActive = vi.fn().mockReturnValue({
		workspaceId: "ws1",
		worktreeId: "wt1",
		sessionId: "sess1",
		currentLocation: {
			workspaceId: "ws1",
			worktreeId: "wt1",
			file: "src/p.ts",
			line: 1,
		},
		paneTransient: opts.paneTransient ?? false,
	});
	const router = new NavRouter({ history, dispatch, toast, getActive });
	return { router, history, dispatch, toast, getActive };
}

describe("NavRouter", () => {
	it("dispatches selectFileAtLocation with transient=true for definition source", async () => {
		const { router, dispatch } = setup();
		await router.navigate(target);
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "session/selectFileAtLocation",
				worktreeId: "wt1",
				relativePath: "src/u.ts",
				revealLine: 5,
				transient: true,
			}),
		);
	});

	it("refuses cross-worktree navigation with a toast", async () => {
		const { router, dispatch, toast } = setup();
		await router.navigate({ ...target, worktreeId: "other" });
		expect(dispatch).not.toHaveBeenCalled();
		expect(toast).toHaveBeenCalledWith(
			expect.stringMatching(/cross-worktree/i),
		);
	});

	it("pushes the current location onto history on a normal jump", async () => {
		const { router, history } = setup();
		const pushSpy = vi.spyOn(history, "push");
		await router.navigate(target);
		expect(pushSpy).toHaveBeenCalledTimes(1);
		expect(pushSpy).toHaveBeenCalledWith(
			"wt1",
			expect.objectContaining({ file: "src/p.ts", line: 1 }),
		);
	});

	it("skips the history push when the current pane is transient (preview replace-in-place)", async () => {
		const { router, history } = setup({ paneTransient: true });
		const pushSpy = vi.spyOn(history, "push");
		await router.navigate(target);
		expect(pushSpy).not.toHaveBeenCalled();
	});

	it("back pops history and dispatches", async () => {
		const { router, history, dispatch } = setup();
		history.push("wt1", {
			workspaceId: "ws1",
			worktreeId: "wt1",
			file: "src/p.ts",
			line: 1,
		});
		history.push("wt1", target);
		dispatch.mockClear();
		await router.back("wt1");
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ relativePath: "src/p.ts" }),
		);
	});
});
