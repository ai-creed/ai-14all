import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const refreshRemote = vi.fn();
const listRemoteBranches = vi.fn();
vi.mock("../../../src/lib/desktop-client", () => ({
	repository: {
		refreshRemote: (...args: unknown[]) => refreshRemote(...args),
		listRemoteBranches: (...args: unknown[]) => listRemoteBranches(...args),
	},
}));

import { useBaseBranchOptions } from "../../../src/app/hooks/use-base-branch-options";

describe("useBaseBranchOptions", () => {
	beforeEach(() => {
		refreshRemote.mockReset();
		listRemoteBranches.mockReset();
	});

	it("fetches then loads branches and pre-selects the default on open", async () => {
		refreshRemote.mockResolvedValue({ ok: true });
		listRemoteBranches.mockResolvedValue({
			branches: ["origin/master", "origin/devel"],
			defaultBranch: "origin/master",
		});

		const { result } = renderHook(() =>
			useBaseBranchOptions({ open: true, workspaceId: "ws1" }),
		);

		await waitFor(() =>
			expect(result.current.branches).toEqual([
				"origin/master",
				"origin/devel",
			]),
		);
		expect(refreshRemote).toHaveBeenCalledWith("ws1");
		expect(result.current.selected).toBe("origin/master");
		expect(result.current.warning).toBeNull();
	});

	it("warns but still lists cached branches when the fetch fails", async () => {
		refreshRemote.mockResolvedValue({ ok: false, error: "offline" });
		listRemoteBranches.mockResolvedValue({
			branches: ["origin/master"],
			defaultBranch: "origin/master",
		});

		const { result } = renderHook(() =>
			useBaseBranchOptions({ open: true, workspaceId: "ws1" }),
		);

		await waitFor(() => expect(result.current.warning).toBeTruthy());
		expect(result.current.branches).toEqual(["origin/master"]);
		expect(result.current.selected).toBe("origin/master");
	});

	it("leaves the selection empty when there are no remote branches", async () => {
		// No origin branches → the service resolver returns the "HEAD" local-fallback
		// sentinel as defaultBranch. The hook must NOT store "HEAD" as the selection,
		// or App would pass it as an explicit baseBranch and the service would reject
		// it (not an origin/* ref). Empty selection → create path omits baseBranch →
		// service falls back to local HEAD with a note.
		refreshRemote.mockResolvedValue({ ok: true });
		listRemoteBranches.mockResolvedValue({
			branches: [],
			defaultBranch: "HEAD",
		});

		const { result } = renderHook(() =>
			useBaseBranchOptions({ open: true, workspaceId: "ws1" }),
		);

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.branches).toEqual([]);
		expect(result.current.selected).toBeNull();
	});

	it("does nothing and stays empty while closed", async () => {
		const { result } = renderHook(() =>
			useBaseBranchOptions({ open: false, workspaceId: "ws1" }),
		);
		expect(result.current.branches).toEqual([]);
		expect(result.current.selected).toBeNull();
		expect(refreshRemote).not.toHaveBeenCalled();
	});
});
