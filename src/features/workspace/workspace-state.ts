import type { Worktree } from "../../../shared/models/worktree";
import type {
  ReviewMode,
  TerminalTab,
  WorktreeSession,
} from "../../../shared/models/worktree-session";

export type WorkspaceState = {
  selectedWorktreeId: string | null;
  sessionsByWorktreeId: Record<string, WorktreeSession>;
  nextTerminalNumberByWorktreeId: Record<string, number>;
};

export type WorkspaceAction =
  | { type: "workspace/loadWorktrees"; worktrees: Worktree[] }
  | { type: "session/selectWorktree"; worktreeId: string }
  | { type: "session/setNote"; worktreeId: string; note: string }
  | { type: "session/setReviewMode"; worktreeId: string; reviewMode: ReviewMode }
  | { type: "session/selectFile"; worktreeId: string; relativePath: string }
  | { type: "session/selectChangedFile"; worktreeId: string; relativePath: string }
  | { type: "session/registerTerminal"; worktreeId: string; terminalSessionId: string }
  | { type: "session/selectTerminal"; worktreeId: string; terminalSessionId: string }
  | { type: "session/closeTerminal"; worktreeId: string; terminalSessionId: string };

function createSession(worktree: Worktree): WorktreeSession {
  return {
    id: worktree.id,
    worktreeId: worktree.id,
    title: worktree.label,
    note: "",
    reviewMode: "files",
    selectedFilePath: null,
    selectedChangedFilePath: null,
    activeTerminalSessionId: null,
    terminalTabs: [],
  };
}

export function createWorkspaceState(worktrees: Worktree[]): WorkspaceState {
  return {
    selectedWorktreeId: worktrees[0]?.id ?? null,
    sessionsByWorktreeId: Object.fromEntries(
      worktrees.map((worktree) => [worktree.id, createSession(worktree)]),
    ),
    nextTerminalNumberByWorktreeId: Object.fromEntries(
      worktrees.map((worktree) => [worktree.id, 1]),
    ),
  };
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  if (action.type === "workspace/loadWorktrees") {
    return createWorkspaceState(action.worktrees);
  }

  if (action.type === "session/selectWorktree") {
    return { ...state, selectedWorktreeId: action.worktreeId };
  }

  const session = state.sessionsByWorktreeId[action.worktreeId];
  if (!session) return state;

  if (action.type === "session/registerTerminal") {
    const nextNumber = state.nextTerminalNumberByWorktreeId[action.worktreeId];
    const nextTab: TerminalTab = {
      sessionId: action.terminalSessionId,
      label: `shell ${nextNumber}`,
    };
    return {
      ...state,
      nextTerminalNumberByWorktreeId: {
        ...state.nextTerminalNumberByWorktreeId,
        [action.worktreeId]: nextNumber + 1,
      },
      sessionsByWorktreeId: {
        ...state.sessionsByWorktreeId,
        [action.worktreeId]: {
          ...session,
          terminalTabs: [...session.terminalTabs, nextTab],
          activeTerminalSessionId: action.terminalSessionId,
        },
      },
    };
  }

  if (action.type === "session/closeTerminal") {
    const nextTabs = session.terminalTabs.filter(
      (tab) => tab.sessionId !== action.terminalSessionId,
    );
    return {
      ...state,
      sessionsByWorktreeId: {
        ...state.sessionsByWorktreeId,
        [action.worktreeId]: {
          ...session,
          terminalTabs: nextTabs,
          activeTerminalSessionId:
            session.activeTerminalSessionId === action.terminalSessionId
              ? nextTabs[0]?.sessionId ?? null
              : session.activeTerminalSessionId,
        },
      },
    };
  }

  const nextSession: WorktreeSession =
    action.type === "session/setNote"
      ? { ...session, note: action.note }
      : action.type === "session/setReviewMode"
        ? { ...session, reviewMode: action.reviewMode }
        : action.type === "session/selectFile"
          ? {
              ...session,
              reviewMode: "files",
              selectedFilePath: action.relativePath,
            }
          : action.type === "session/selectChangedFile"
            ? {
                ...session,
                reviewMode: "changes",
                selectedChangedFilePath: action.relativePath,
              }
            : {
                ...session,
                activeTerminalSessionId: action.terminalSessionId,
              };

  return {
    ...state,
    sessionsByWorktreeId: {
      ...state.sessionsByWorktreeId,
      [action.worktreeId]: nextSession,
    },
  };
}
