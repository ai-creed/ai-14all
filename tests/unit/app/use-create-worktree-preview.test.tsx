import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const previewCreateWorktree = vi.fn();
vi.mock("../../../src/lib/desktop-client", () => ({
	repository: {
		previewCreateWorktree: (...args: unknown[]) =>
			previewCreateWorktree(...args),
	},
}));

import { useCreateWorktreePreview } from "../../../src/app/hooks/use-create-worktree-preview";

describe("useCreateWorktreePreview", () => {
	beforeEach(() => {
		previewCreateWorktree.mockReset();
	});

	it("recomputes the preview with the new base when baseBranch changes", async () => {
		previewCreateWorktree.mockImplementation(
			async (_ws: string, _name: string, baseBranch?: string) => ({
				name: "feature-x",
				branchName: "feature-x",
				path: "/repo/.worktrees/feature-x",
				baseRef: baseBranch ?? "origin/master",
				baseCommit: {
					sha: baseBranch === "origin/devel" ? "devel00" : "master00",
					shortSha: baseBranch === "origin/devel" ? "devel00" : "master00",
					subject:
						baseBranch === "origin/devel"
							? "devel-only commit"
							: "initial commit",
				},
			}),
		);

		const { result, rerender } = renderHook(
			(props: { baseBranch: string | null }) =>
				useCreateWorktreePreview({
					open: true,
					name: "feature-x",
					workspaceId: "ws1",
					baseBranch: props.baseBranch,
				}),
			{ initialProps: { baseBranch: "origin/master" } },
		);

		await waitFor(() =>
			expect(result.current.preview?.baseRef).toBe("origin/master"),
		);

		rerender({ baseBranch: "origin/devel" });

		await waitFor(() =>
			expect(result.current.preview?.baseRef).toBe("origin/devel"),
		);
		expect(result.current.preview?.baseCommit.subject).toBe(
			"devel-only commit",
		);
		expect(previewCreateWorktree).toHaveBeenLastCalledWith(
			"ws1",
			"feature-x",
			"origin/devel",
		);
	});
});
