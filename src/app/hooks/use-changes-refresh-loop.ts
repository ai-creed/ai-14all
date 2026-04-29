import { useEffect, useRef } from "react";
import type { Worktree } from "../../../shared/models/worktree";

const REFRESH_INTERVAL_MS = 15_000;

type Options = {
	startupMode: string;
	repository: { rootPath: string } | null;
	activeWorktree: Worktree | null | undefined;
	windowFocused: boolean;
	onRefresh: () => Promise<void> | void;
};

/**
 * Drive periodic + on-focus refresh of changed-file inventory.
 *
 * Runs `onRefresh` on a 15s interval while the app is focused with a ready
 * worktree, and once when the window regains focus after being blurred.
 */
export function useChangesRefreshLoop(options: Options): void {
	const previousFocusedRef = useRef(options.windowFocused);
	const onRefreshRef = useRef(options.onRefresh);
	onRefreshRef.current = options.onRefresh;

	const ready =
		options.startupMode === "ready" &&
		!!options.repository &&
		!!options.activeWorktree;

	// Periodic refresh while focused.
	useEffect(() => {
		if (!ready || !options.windowFocused) return;
		const interval = window.setInterval(() => {
			void onRefreshRef.current();
		}, REFRESH_INTERVAL_MS);
		return () => window.clearInterval(interval);
	}, [
		ready,
		options.windowFocused,
		options.repository?.rootPath,
		options.activeWorktree?.id,
	]);

	// One-shot refresh when window regains focus.
	useEffect(() => {
		const wasFocused = previousFocusedRef.current;
		previousFocusedRef.current = options.windowFocused;
		if (!wasFocused && options.windowFocused && ready) {
			void onRefreshRef.current();
		}
	}, [
		options.windowFocused,
		ready,
		options.repository?.rootPath,
		options.activeWorktree?.id,
	]);
}
