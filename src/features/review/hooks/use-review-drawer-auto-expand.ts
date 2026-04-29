import { useEffect, useRef } from "react";

export type AutoExpandInputs = {
	activeWorktreeId: string | null;
	changedCount: number; // active worktree's changedFiles.length; 0 if summary not ready
	summaryReady: boolean; // true after first successful summary for this worktreeId
	currentlyOpen: boolean; // activeSession.reviewDrawerOpen
	open: (worktreeId: string) => void;
};

export function useReviewDrawerAutoExpand({
	activeWorktreeId,
	changedCount,
	summaryReady,
	currentlyOpen,
	open,
}: AutoExpandInputs) {
	const lastCountByWtid = useRef<Map<string, number>>(new Map());
	const suppressedWtids = useRef<Set<string>>(new Set());
	const prevActiveWtid = useRef<string | null>(null);

	// Clear suppression on session switch-away
	useEffect(() => {
		if (prevActiveWtid.current && prevActiveWtid.current !== activeWorktreeId) {
			suppressedWtids.current.delete(prevActiveWtid.current);
		}
		prevActiveWtid.current = activeWorktreeId;
	}, [activeWorktreeId]);

	useEffect(() => {
		if (!activeWorktreeId || !summaryReady) return;
		const prev = lastCountByWtid.current.get(activeWorktreeId);
		lastCountByWtid.current.set(activeWorktreeId, changedCount);

		if (prev === undefined) return; // first sample — do not auto-expand on restore
		if (
			prev === 0 &&
			changedCount > 0 &&
			!currentlyOpen &&
			!suppressedWtids.current.has(activeWorktreeId)
		) {
			open(activeWorktreeId);
		}
	}, [activeWorktreeId, changedCount, summaryReady, currentlyOpen, open]);

	return {
		noteUserCollapse(worktreeId: string) {
			suppressedWtids.current.add(worktreeId);
		},
		noteUserExpand(worktreeId: string) {
			suppressedWtids.current.delete(worktreeId);
		},
	};
}
