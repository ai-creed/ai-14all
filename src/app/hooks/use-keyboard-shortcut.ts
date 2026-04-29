import { useEffect } from "react";
import { SHORTCUT_REGISTRY } from "../shortcut-registry";
import type { Platform } from "../shortcut-registry";

/**
 * Subscribe to a registered keyboard shortcut by id.
 *
 * The handler receives the live KeyboardEvent so it can call preventDefault
 * or stopPropagation as needed. Effect deps follow the standard React rules
 * — pass any state the handler closes over via `deps`.
 */
export function useKeyboardShortcut(
	shortcutId: string,
	platform: Platform,
	handler: (event: KeyboardEvent) => void,
	deps: ReadonlyArray<unknown>,
): void {
	useEffect(() => {
		const shortcut = SHORTCUT_REGISTRY.find((s) => s.id === shortcutId);
		if (!shortcut) return;
		const listener = (e: KeyboardEvent) => {
			if (!shortcut.predicate(e, platform)) return;
			handler(e);
		};
		document.addEventListener("keydown", listener, true);
		return () => document.removeEventListener("keydown", listener, true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [shortcutId, platform, ...deps]);
}
