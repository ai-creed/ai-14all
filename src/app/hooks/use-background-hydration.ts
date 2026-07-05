import { useEffect, useRef, useState } from "react";
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
 * naturally skipped.
 *
 * A hydration that dispatches changes `appWorkspaces`, which re-runs the effect
 * and plans the next pick. But a hydration can also resolve WITHOUT dispatching
 * — use-workspace-lifecycle's mid-flight liveness bail returns `true` without
 * registering when a user activation took the workspace over. That changes no
 * state, so the effect would never re-fire and the remaining dormant workspaces
 * would stall unhydrated. A monotonically increasing `tick`, bumped in every
 * hydration's `.finally`, forces the re-plan regardless of whether the
 * hydration produced a state change. The bump is suppressed after unmount (app
 * teardown) via `unmountedRef` so no state update lands on an unmounted hook.
 */
export function useBackgroundHydration(options: Options): void {
	const { enabled, startupMode, appWorkspaces, hydrateWorkspace } = options;
	const running = useRef(false);
	const unmountedRef = useRef(false);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		return () => {
			unmountedRef.current = true;
		};
	}, []);

	useEffect(() => {
		if (!enabled || startupMode !== "ready" || running.current) return;
		const next = pickNextHydration(appWorkspaces);
		if (!next) return;
		running.current = true;
		void hydrateWorkspace(next).finally(() => {
			running.current = false;
			// Re-plan the queue even when the hydration produced no state change
			// (the no-dispatch bail), but never after teardown.
			if (unmountedRef.current) return;
			setTick((t) => t + 1);
		});
	}, [enabled, startupMode, appWorkspaces, hydrateWorkspace, tick]);
}
