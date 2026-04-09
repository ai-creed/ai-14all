import type { AppWorkspace } from "../../../shared/models/app-workspace";

export type AppWorkspacesState = {
	activeWorkspaceId: string | null;
	workspaceOrder: string[];
	workspacesById: Record<string, AppWorkspace>;
};

export type AppWorkspacesAction =
	| { type: "workspace/register"; workspace: AppWorkspace }
	| { type: "workspace/select"; workspaceId: string }
	| { type: "workspace/remove"; workspaceId: string };

export function createAppWorkspacesState(): AppWorkspacesState {
	return {
		activeWorkspaceId: null,
		workspaceOrder: [],
		workspacesById: {},
	};
}

export function appWorkspacesReducer(
	state: AppWorkspacesState,
	action: AppWorkspacesAction,
): AppWorkspacesState {
	if (action.type === "workspace/register") {
		const exists = state.workspacesById[action.workspace.workspaceId];
		return {
			activeWorkspaceId: state.activeWorkspaceId ?? action.workspace.workspaceId,
			workspaceOrder: exists
				? state.workspaceOrder
				: [...state.workspaceOrder, action.workspace.workspaceId],
			workspacesById: {
				...state.workspacesById,
				[action.workspace.workspaceId]: action.workspace,
			},
		};
	}

	if (action.type === "workspace/select") {
		if (!state.workspacesById[action.workspaceId]) return state;
		const workspacesById = Object.fromEntries(
			Object.entries(state.workspacesById).map(([id, workspace]) => [
				id,
				{
					...workspace,
					hydrationState:
						id === action.workspaceId
							? ("active" as const)
							: workspace.workspaceState
								? ("inactiveLive" as const)
								: ("dormant" as const),
				},
			]),
		);
		return { ...state, activeWorkspaceId: action.workspaceId, workspacesById };
	}

	if (action.type === "workspace/remove") {
		const { [action.workspaceId]: _removed, ...rest } = state.workspacesById;
		const workspaceOrder = state.workspaceOrder.filter((id) => id !== action.workspaceId);
		return {
			activeWorkspaceId:
				state.activeWorkspaceId === action.workspaceId ? (workspaceOrder[0] ?? null) : state.activeWorkspaceId,
			workspaceOrder,
			workspacesById: rest,
		};
	}

	return state;
}
