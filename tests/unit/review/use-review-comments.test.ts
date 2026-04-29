import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const listMock = vi.fn();
const createMock = vi.fn();
const markMock = vi.fn();
const reopenMock = vi.fn();
const deleteMock = vi.fn();
const onChangedMock = vi.fn();

vi.mock("../../../src/lib/desktop-client", () => ({
	reviewComments: {
		list: (...a: unknown[]) => listMock(...a),
		create: (...a: unknown[]) => createMock(...a),
		markAddressed: (...a: unknown[]) => markMock(...a),
		reopen: (...a: unknown[]) => reopenMock(...a),
		delete: (...a: unknown[]) => deleteMock(...a),
		onChanged: (...a: unknown[]) => onChangedMock(...a),
	},
}));

import { useReviewComments } from "../../../src/features/review/hooks/use-review-comments";

const c = {
	id: "c1",
	worktreeId: "/repo",
	filePath: "src/foo.ts",
	startLine: 1,
	endLine: 1,
	snippet: "",
	body: "x",
	status: "open" as const,
	source: "working-tree" as const,
	commitSha: null,
	createdAt: "2026-04-26T00:00:00.000Z",
	addressedAt: null,
};

describe("useReviewComments", () => {
	beforeEach(() => {
		listMock.mockReset();
		onChangedMock.mockReset();
		onChangedMock.mockReturnValue(() => {});
	});

	it("loads comments for the given worktree on mount", async () => {
		listMock.mockResolvedValue({ comments: [c] });
		const { result } = renderHook(() => useReviewComments("/repo"));
		await waitFor(() => expect(result.current.comments).toEqual([c]));
		expect(listMock).toHaveBeenCalledWith("/repo");
	});

	it("re-fetches when a change event fires", async () => {
		listMock.mockResolvedValue({ comments: [] });
		let trigger: (e: { kind: string }) => void = () => {};
		onChangedMock.mockImplementation((h: (e: { kind: string }) => void) => {
			trigger = h;
			return () => {};
		});
		renderHook(() => useReviewComments("/repo"));
		await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
		await act(async () => {
			trigger({ kind: "created" });
		});
		await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
	});
});
