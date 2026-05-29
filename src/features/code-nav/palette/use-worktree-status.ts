import { useEffect, useState } from "react";
import { codeNavClient, type WorktreeRef } from "../ipc/client.js";
import { subscribeWorktreeIndexRefreshed } from "../ipc/events.js";
import type { WorktreeStatusPayload } from "../../../../shared/contracts/commands.js";

export function useWorktreeStatus(
	ref: WorktreeRef | null,
): WorktreeStatusPayload | null {
	const [status, setStatus] = useState<WorktreeStatusPayload | null>(null);

	useEffect(() => {
		if (!ref) {
			setStatus(null);
			return;
		}
		let cancelled = false;
		const load = async () => {
			try {
				const s = await codeNavClient.getWorktreeStatus(ref);
				if (!cancelled) setStatus(s);
			} catch {
				if (!cancelled) setStatus(null);
			}
		};
		void load();
		const unsub = subscribeWorktreeIndexRefreshed((e) => {
			if (
				e.workspaceId === ref.workspaceId &&
				e.worktreeId === ref.worktreeId
			)
				void load();
		});
		return () => {
			cancelled = true;
			unsub();
		};
	}, [ref?.workspaceId, ref?.worktreeId]);

	return status;
}
