import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const {
	listMock,
	createMock,
	markMock,
	reopenMock,
	deleteMock,
	onChangedMock,
	updateMock,
	bulkRemoveAddressedMock,
} = vi.hoisted(() => ({
	listMock: vi.fn(),
	createMock: vi.fn(),
	markMock: vi.fn(),
	reopenMock: vi.fn(),
	deleteMock: vi.fn(),
	onChangedMock: vi.fn(),
	updateMock: vi.fn(),
	bulkRemoveAddressedMock: vi.fn(),
}));

vi.mock("../../../src/lib/desktop-client", () => ({
	reviewComments: {
		list: listMock,
		create: createMock,
		markAddressed: markMock,
		reopen: reopenMock,
		delete: deleteMock,
		onChanged: onChangedMock,
		update: updateMock,
		bulkRemoveAddressed: bulkRemoveAddressedMock,
	},
}));

import { useReviewComments } from "../../../src/features/review/hooks/use-review-comments";
import { reviewComments } from "../../../src/lib/desktop-client";
import type { ReviewComment } from "../../../shared/models/review-comment";

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
		updateMock.mockReset();
		bulkRemoveAddressedMock.mockReset();
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

	it("update() calls reviewComments.update and refreshes on 'updated' event", async () => {
		const handlers: Array<(evt: { kind: string }) => void> = [];
		(reviewComments.onChanged as ReturnType<typeof vi.fn>).mockImplementation((h: (e: { kind: string }) => void) => {
			handlers.push(h);
			return () => {};
		});
		(reviewComments.list as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ comments: [] })
			.mockResolvedValueOnce({ comments: [{ id: "1", body: "new" } as ReviewComment] });
		(reviewComments.update as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			comment: { id: "1", body: "new" },
		});

		const { result } = renderHook(() => useReviewComments("w1"));
		await waitFor(() => expect(result.current.comments).toEqual([]));

		await act(async () => {
			await result.current.update("1", "new");
		});

		expect(reviewComments.update).toHaveBeenCalledWith("1", "new");

		await act(async () => {
			handlers[0]?.({ kind: "updated" });
		});
		await waitFor(() => expect(result.current.comments).toEqual([{ id: "1", body: "new" }]));
	});

	it("clearAddressed() forwards to bulkRemoveAddressed with the addressed ids", async () => {
		(reviewComments.list as ReturnType<typeof vi.fn>).mockResolvedValue({
			comments: [
				{ id: "a", status: "addressed" },
				{ id: "b", status: "open" },
				{ id: "c", status: "addressed" },
			] as ReviewComment[],
		});
		(reviewComments.bulkRemoveAddressed as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			removed: 2,
		});

		const { result } = renderHook(() => useReviewComments("w1"));
		await waitFor(() => expect(result.current.comments).toHaveLength(3));

		await act(async () => {
			await result.current.clearAddressed();
		});

		expect(reviewComments.bulkRemoveAddressed).toHaveBeenCalledWith("w1", ["a", "c"]);
	});
});
