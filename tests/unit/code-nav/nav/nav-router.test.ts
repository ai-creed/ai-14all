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

function setup() {
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
		expect(toast).toHaveBeenCalledWith(expect.stringMatching(/cross-worktree/i));
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
