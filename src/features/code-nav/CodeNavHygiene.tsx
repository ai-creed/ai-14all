import { useEffect } from "react";
import { codeNavClient } from "./ipc/client.js";
import { setActiveWorktreeRef } from "./nav/active-worktree-ref.js";

export interface CodeNavHygieneProps {
	workspaceId: string;
	worktreeId: string;
	worktreeRoot: string;
}

export function CodeNavHygiene({
	workspaceId,
	worktreeId,
	worktreeRoot,
}: CodeNavHygieneProps) {
	useEffect(() => {
		setActiveWorktreeRef({ workspaceId, worktreeId, worktreeRoot });
		void codeNavClient.watchWorktree({ workspaceId, worktreeId });
		return () => {
			void codeNavClient.unwatchWorktree({ workspaceId, worktreeId });
			setActiveWorktreeRef(null);
		};
	}, [workspaceId, worktreeId, worktreeRoot]);
	return null;
}
