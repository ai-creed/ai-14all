import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { AppWorkspacesState } from "../../features/workspace/app-workspaces-state";
import type { WorkspaceState } from "../../features/workspace/workspace-state";
import { logRendererShellEvent } from "../../features/terminals/shell-event-logger";

type Options = {
	setWindowFocused: (focused: boolean) => void;
	appWorkspacesRef: MutableRefObject<AppWorkspacesState>;
	activeWorkspaceStateRef: MutableRefObject<WorkspaceState>;
};

export function useWindowFocus({
	setWindowFocused,
	appWorkspacesRef,
	activeWorkspaceStateRef,
}: Options): void {
	useEffect(() => {
		const handleFocus = () => {
			setWindowFocused(true);
			const data = {
				activeWorkspaceId: appWorkspacesRef.current.activeWorkspaceId,
				activeWorktreeId: activeWorkspaceStateRef.current.selectedWorktreeId,
			};
			void logRendererShellEvent({
				event: "renderer-window-focus",
				windowId: null,
				reasonKind: "window_lifecycle",
				reason: "app_focus",
				data,
			});
			void logRendererShellEvent({
				event: "app-became-active",
				windowId: null,
				reasonKind: "window_lifecycle",
				reason: "app_focus",
				data,
			});
		};
		const handleBlur = () => {
			setWindowFocused(false);
			const data = {
				activeWorkspaceId: appWorkspacesRef.current.activeWorkspaceId,
				activeWorktreeId: activeWorkspaceStateRef.current.selectedWorktreeId,
			};
			void logRendererShellEvent({
				event: "renderer-window-blur",
				windowId: null,
				reasonKind: "window_lifecycle",
				reason: "app_blur",
				data,
			});
			void logRendererShellEvent({
				event: "app-became-inactive",
				windowId: null,
				reasonKind: "window_lifecycle",
				reason: "app_blur",
				data,
			});
		};
		window.addEventListener("focus", handleFocus);
		window.addEventListener("blur", handleBlur);
		return () => {
			window.removeEventListener("focus", handleFocus);
			window.removeEventListener("blur", handleBlur);
		};
	}, [setWindowFocused, appWorkspacesRef, activeWorkspaceStateRef]);
}
