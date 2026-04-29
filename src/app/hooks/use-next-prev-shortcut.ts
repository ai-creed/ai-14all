import { useEffect } from "react";
import { SHORTCUT_REGISTRY } from "../shortcut-registry";
import type { Platform } from "../shortcut-registry";

/**
 * Subscribe to a paired "select next" / "select prev" shortcut. The handler
 * receives the live KeyboardEvent and a direction flag so the host can run
 * its index math once and act on whichever key fired.
 *
 * Use when both shortcuts share the same state read + dispatch, like
 * worktree cycling, workspace cycling, or terminal cycling.
 */
export function useNextPrevShortcut(
	nextId: string,
	prevId: string,
	platform: Platform,
	handler: (event: KeyboardEvent, direction: "next" | "prev") => void,
	deps: ReadonlyArray<unknown>,
): void {
	useEffect(() => {
		const nextShortcut = SHORTCUT_REGISTRY.find((s) => s.id === nextId);
		const prevShortcut = SHORTCUT_REGISTRY.find((s) => s.id === prevId);
		if (!nextShortcut || !prevShortcut) return;
		const listener = (e: KeyboardEvent) => {
			const isNext = nextShortcut.predicate(e, platform);
			const isPrev = prevShortcut.predicate(e, platform);
			if (!isNext && !isPrev) return;
			handler(e, isNext ? "next" : "prev");
		};
		document.addEventListener("keydown", listener, true);
		return () => document.removeEventListener("keydown", listener, true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [nextId, prevId, platform, ...deps]);
}
