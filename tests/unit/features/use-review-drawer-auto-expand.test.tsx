import { renderHook, act } from "@testing-library/react";
import { useReviewDrawerAutoExpand } from "../../../src/features/review/use-review-drawer-auto-expand";

describe("useReviewDrawerAutoExpand", () => {
	it("does not auto-expand on first summary even if dirty (restore case)", () => {
		const open = vi.fn();
		renderHook(() =>
			useReviewDrawerAutoExpand({
				activeWorktreeId: "/repo",
				changedCount: 3,
				summaryReady: true,
				currentlyOpen: false,
				open,
			}),
		);
		expect(open).not.toHaveBeenCalled();
	});

	it("auto-expands on a 0 → 2 transition", () => {
		const open = vi.fn();
		const { rerender } = renderHook((p) => useReviewDrawerAutoExpand(p), {
			initialProps: {
				activeWorktreeId: "/repo",
				changedCount: 0,
				summaryReady: true,
				currentlyOpen: false,
				open,
			},
		});
		rerender({
			activeWorktreeId: "/repo",
			changedCount: 2,
			summaryReady: true,
			currentlyOpen: false,
			open,
		});
		expect(open).toHaveBeenCalledTimes(1);
		expect(open).toHaveBeenCalledWith("/repo");
	});

	it("does not auto-expand when already open", () => {
		const open = vi.fn();
		const { rerender } = renderHook((p) => useReviewDrawerAutoExpand(p), {
			initialProps: {
				activeWorktreeId: "/repo",
				changedCount: 0,
				summaryReady: true,
				currentlyOpen: true,
				open,
			},
		});
		rerender({
			activeWorktreeId: "/repo",
			changedCount: 2,
			summaryReady: true,
			currentlyOpen: true,
			open,
		});
		expect(open).not.toHaveBeenCalled();
	});

	it("does not auto-expand when worktree is suppressed", () => {
		const open = vi.fn();
		const { rerender, result } = renderHook(
			(p) => useReviewDrawerAutoExpand(p),
			{
				initialProps: {
					activeWorktreeId: "/repo",
					changedCount: 0,
					summaryReady: true,
					currentlyOpen: false,
					open,
				},
			},
		);
		act(() => result.current.noteUserCollapse("/repo"));
		rerender({
			activeWorktreeId: "/repo",
			changedCount: 2,
			summaryReady: true,
			currentlyOpen: false,
			open,
		});
		expect(open).not.toHaveBeenCalled();
	});

	it("clears suppression when session is switched away and back", () => {
		const open = vi.fn();
		const { rerender, result } = renderHook(
			(p) => useReviewDrawerAutoExpand(p),
			{
				initialProps: {
					activeWorktreeId: "/repo",
					changedCount: 0,
					summaryReady: true,
					currentlyOpen: false,
					open,
				},
			},
		);
		act(() => result.current.noteUserCollapse("/repo"));
		rerender({
			activeWorktreeId: "/other",
			changedCount: 0,
			summaryReady: true,
			currentlyOpen: false,
			open,
		});
		rerender({
			activeWorktreeId: "/repo",
			changedCount: 0,
			summaryReady: true,
			currentlyOpen: false,
			open,
		});
		rerender({
			activeWorktreeId: "/repo",
			changedCount: 2,
			summaryReady: true,
			currentlyOpen: false,
			open,
		});
		expect(open).toHaveBeenCalledTimes(1);
	});
});
