import { useEffect } from "react";
import { codeNavClient } from "./ipc/client.js";
import { setActiveWorktreeRef } from "./nav/active-worktree-ref.js";

export interface CodeNavHygieneProps {
	workspaceId: string;
	worktreeId: string;
	worktreeRoot: string;
}

function hasBridge(): boolean {
	return Boolean(
		(window as unknown as { ai14all?: { codeNav?: unknown } }).ai14all?.codeNav,
	);
}

export function CodeNavHygiene({
	workspaceId,
	worktreeId,
	worktreeRoot,
}: CodeNavHygieneProps) {
	useEffect(() => {
		setActiveWorktreeRef({ workspaceId, worktreeId, worktreeRoot });
		// E2E hook: expose the active code-nav ref on window so Playwright can
		// drive IPC + UI flows with the real ids the app sees. Harmless in prod.
		(
			window as unknown as {
				__codeNavTestRef?: {
					workspaceId: string;
					worktreeId: string;
					worktreeRoot: string;
				};
			}
		).__codeNavTestRef = { workspaceId, worktreeId, worktreeRoot };
		if (!hasBridge()) return () => setActiveWorktreeRef(null);
		void codeNavClient
			.watchWorktree({ workspaceId, worktreeId })
			.catch(() => {});
		return () => {
			if (hasBridge())
				void codeNavClient
					.unwatchWorktree({ workspaceId, worktreeId })
					.catch(() => {});
			setActiveWorktreeRef(null);
			delete (
				window as unknown as {
					__codeNavTestRef?: unknown;
				}
			).__codeNavTestRef;
		};
	}, [workspaceId, worktreeId, worktreeRoot]);
	return null;
}
