import { useEffect } from "react";
import { events } from "../../lib/desktop-client";

/**
 * Listen for the main process's "open install modal" event and invoke
 * `onOpen` to surface the install/onboarding modal.
 */
export function useInstallModalListener(onOpen: () => void): void {
	useEffect(() => {
		const off = events.onOpenInstallModal(() => onOpen());
		return off;
	}, [onOpen]);
}
