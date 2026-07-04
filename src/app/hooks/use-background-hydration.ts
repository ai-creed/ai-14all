import { useEffect, useRef } from "react";
import { pickNextHydration } from "../../features/workspace/logic/background-hydration";
import type { AppWorkspacesState } from "../../features/workspace/logic/app-workspaces-state";

type Options = {
	enabled: boolean; // settings.restoreDepth === "stateEagerTerminalsLazy"
	startupMode: string; // queue starts only once "ready"
	appWorkspaces: AppWorkspacesState;
	hydrateWorkspace: (workspaceId: string) => Promise<boolean>;
};

/**
 * Sequential background hydration: one workspace at a time, re-planned from
 * fresh state after each completion so user-driven activations mid-queue are
 * naturally skipped. Cancelled on unmount (app teardown).
 */
export function useBackgroundHydration(options: Options): void {
	const { enabled, startupMode, appWorkspaces, hydrateWorkspace } = options;
	const running = useRef(false);

	useEffect(() => {
		if (!enabled || startupMode !== "ready" || running.current) return;
		const next = pickNextHydration(appWorkspaces);
		if (!next) return;
		running.current = true;
		let cancelled = false;
		void hydrateWorkspace(next).finally(() => {
			running.current = false;
			// State change re-runs the effect, which plans the next pick.
			if (cancelled) return;
		});
		return () => {
			cancelled = true;
		};
	}, [enabled, startupMode, appWorkspaces, hydrateWorkspace]);
}
