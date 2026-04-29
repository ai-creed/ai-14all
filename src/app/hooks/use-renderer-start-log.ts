import { useEffect } from "react";
import { logRendererShellEvent } from "../../features/terminals/logic/shell-event-logger";

/**
 * Emit a single `renderer-start` shell event when the renderer mounts. Used
 * by the diagnostics log to mark each renderer process boot.
 */
export function useRendererStartLog(activeWorkspaceId: string | null): void {
	useEffect(() => {
		void logRendererShellEvent({
			event: "renderer-start",
			windowId: null,
			data: { activeWorkspaceId },
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only log
	}, []);
}
