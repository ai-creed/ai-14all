import { useEffect, useState } from "react";
import type { RemoteStatus } from "../../../shared/models/git-remote-status";
import { git } from "../../lib/desktop-client";

type Options = {
	workspaceId: string | null;
	worktreeId: string | null | undefined;
	refreshKey: number;
};

/**
 * Fetch git remote status (ahead/behind counts) for the active worktree
 * when it changes or when the explicit `refreshKey` advances.
 */
export function useRemoteStatusLoader(options: Options): RemoteStatus | null {
	const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null);
	const { workspaceId, worktreeId, refreshKey } = options;

	useEffect(() => {
		if (!worktreeId || !workspaceId) {
			setRemoteStatus(null);
			return;
		}
		let cancelled = false;
		git
			.getRemoteStatus(workspaceId, worktreeId)
			.then((status) => {
				if (!cancelled) setRemoteStatus(status);
			})
			.catch(() => {
				if (!cancelled) setRemoteStatus(null);
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, worktreeId, refreshKey]);

	return remoteStatus;
}
