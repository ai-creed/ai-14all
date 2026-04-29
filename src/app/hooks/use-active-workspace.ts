import { useCallback, useReducer, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type { AppWorkspace } from "../../../shared/models/app-workspace";
import type { Repository } from "../../../shared/models/repository";
import type { Worktree } from "../../../shared/models/worktree";
import {
	appWorkspacesReducer,
	createAppWorkspacesState,
	type AppWorkspacesAction,
	type AppWorkspacesState,
} from "../../features/workspace/logic/app-workspaces-state";
import {
	createWorkspaceState,
	workspaceReducer,
	type WorkspaceAction,
	type WorkspaceState,
} from "../../features/workspace/logic/workspace-state";

export type UseActiveWorkspace = {
	// Reducer state + raw dispatch
	appWorkspaces: AppWorkspacesState;
	dispatchAppWorkspaces: Dispatch<AppWorkspacesAction>;

	// Derived view of the active workspace
	activeWorkspace: AppWorkspace | null;
	activeWorkspaceId: string | null;
	repository: Repository | null;
	worktrees: Worktree[];
	workspaceState: WorkspaceState;

	// Dispatch helpers
	dispatch: (action: WorkspaceAction) => void;
	createScopedWorkspaceDispatch: (
		workspaceId: string,
	) => (action: WorkspaceAction) => void;
	getWorkspaceStateById: (workspaceId: string) => WorkspaceState | null;

	// Shadow refs (exposed because other hooks read from them across renders)
	appWorkspacesRef: MutableRefObject<AppWorkspacesState>;
	activeWorkspaceStateRef: MutableRefObject<WorkspaceState>;
	inactiveWorkspaceStatesRef: MutableRefObject<Map<string, WorkspaceState>>;
	prevActiveWorkspaceIdRef: MutableRefObject<string | null>;
	worktreesRef: MutableRefObject<Worktree[]>;
	workspaceStateRef: MutableRefObject<WorkspaceState>;
};

/**
 * Owns the multi-workspace reducer and the per-workspace shadow state used by
 * background PTY events. Returns the full surface the renderer needs:
 * derived view of the active workspace, a stable `dispatch` for sequential
 * async updates, and refs for cross-effect coordination.
 *
 * Shadow ref behavior: the active workspace's `WorkspaceState` is mirrored
 * synchronously in `activeWorkspaceStateRef` so multiple sequential dispatch
 * calls in async handlers each see the accumulated state. Inactive workspaces
 * keep their own shadow in `inactiveWorkspaceStatesRef` so high-rate PTY
 * events for background workspaces don't lose updates between renders.
 */
export function useActiveWorkspace(): UseActiveWorkspace {
	const [appWorkspaces, dispatchAppWorkspaces] = useReducer(
		appWorkspacesReducer,
		createAppWorkspacesState(),
	);

	// Derive active workspace data
	const activeWorkspace = appWorkspaces.activeWorkspaceId
		? (appWorkspaces.workspacesById[appWorkspaces.activeWorkspaceId] ?? null)
		: null;
	const repository = activeWorkspace?.repository ?? null;
	const worktrees = activeWorkspace?.worktrees ?? [];
	const activeWorkspaceId = appWorkspaces.activeWorkspaceId;
	const workspaceState =
		activeWorkspace?.workspaceState ?? createWorkspaceState([]);

	// Stable ref to the full multi-workspace state — used by onOutput/onExit to
	// route events from inactive workspaces without depending on the render cycle.
	const appWorkspacesRef = useRef(appWorkspaces);
	appWorkspacesRef.current = appWorkspaces;

	// Keep a "shadow" ref for the active workspace's workspaceState that is
	// updated synchronously when dispatch is called, so that multiple sequential
	// dispatch calls in async code each see the accumulated state rather than
	// a stale render snapshot.
	const activeWorkspaceStateRef = useRef(workspaceState);
	// Per-workspace shadow state for inactive workspaces. Mirrors the role of
	// activeWorkspaceStateRef for background PTY events: updated synchronously in
	// the onOutput/onExit else branches so burst events accumulate rather than
	// overwriting each other before the next React render.
	const inactiveWorkspaceStatesRef = useRef<Map<string, WorkspaceState>>(
		new Map(),
	);
	// Reset the shadow ref whenever the active workspace changes (e.g. workspace
	// switch or initial register). The workspaceState derived from the render is
	// authoritative at render time.
	const prevActiveWorkspaceIdRef = useRef<string | null>(null);
	if (prevActiveWorkspaceIdRef.current !== appWorkspaces.activeWorkspaceId) {
		prevActiveWorkspaceIdRef.current = appWorkspaces.activeWorkspaceId;
		activeWorkspaceStateRef.current = workspaceState;
		// Drop the inactive shadow for the workspace that just became active — the
		// active shadow ref now owns accumulation for it.
		if (appWorkspaces.activeWorkspaceId) {
			inactiveWorkspaceStatesRef.current.delete(
				appWorkspaces.activeWorkspaceId,
			);
		}
	}

	// Stable dispatch wrapper — always applies to the shadow ref so sequential
	// async calls accumulate correctly without waiting for React to re-render.
	const dispatch = useCallback(
		(action: WorkspaceAction) => {
			const wsId = prevActiveWorkspaceIdRef.current;
			if (!wsId) return;
			const nextState = workspaceReducer(
				activeWorkspaceStateRef.current,
				action,
			);
			activeWorkspaceStateRef.current = nextState;
			dispatchAppWorkspaces({
				type: "workspace/updateWorkspaceState",
				workspaceId: wsId,
				workspaceState: nextState,
			});
		},
		// dispatchAppWorkspaces is stable (from useReducer); no deps needed
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);

	const getWorkspaceStateById = useCallback(
		(workspaceId: string): WorkspaceState | null => {
			if (workspaceId === appWorkspacesRef.current.activeWorkspaceId) {
				return activeWorkspaceStateRef.current;
			}
			return (
				inactiveWorkspaceStatesRef.current.get(workspaceId) ??
				appWorkspacesRef.current.workspacesById[workspaceId]?.workspaceState ??
				null
			);
		},
		[],
	);

	const createScopedWorkspaceDispatch = useCallback(
		(workspaceId: string) => {
			const localShadow = { current: getWorkspaceStateById(workspaceId) };
			return (action: WorkspaceAction) => {
				const baseState =
					localShadow.current ?? getWorkspaceStateById(workspaceId);
				if (!baseState) return;
				const nextState = workspaceReducer(baseState, action);
				localShadow.current = nextState;
				if (workspaceId === appWorkspacesRef.current.activeWorkspaceId) {
					prevActiveWorkspaceIdRef.current = workspaceId;
					activeWorkspaceStateRef.current = nextState;
					inactiveWorkspaceStatesRef.current.delete(workspaceId);
				} else {
					inactiveWorkspaceStatesRef.current.set(workspaceId, nextState);
				}
				dispatchAppWorkspaces({
					type: "workspace/updateWorkspaceState",
					workspaceId,
					workspaceState: nextState,
				});
			};
		},
		[getWorkspaceStateById],
	);

	const worktreesRef = useRef(worktrees);
	worktreesRef.current = worktrees;
	const workspaceStateRef = useRef(workspaceState);
	workspaceStateRef.current = workspaceState;

	return {
		appWorkspaces,
		dispatchAppWorkspaces,
		activeWorkspace,
		activeWorkspaceId,
		repository,
		worktrees,
		workspaceState,
		dispatch,
		createScopedWorkspaceDispatch,
		getWorkspaceStateById,
		appWorkspacesRef,
		activeWorkspaceStateRef,
		inactiveWorkspaceStatesRef,
		prevActiveWorkspaceIdRef,
		worktreesRef,
		workspaceStateRef,
	};
}
