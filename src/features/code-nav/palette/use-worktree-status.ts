import { useEffect, useState } from "react";
import { codeNavClient, type WorktreeRef } from "../ipc/client.js";
import {
	subscribeWorktreeIndexRefreshed,
	subscribeWorktreeUnavailable,
	subscribeAvailabilityChanged,
} from "../ipc/events.js";
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
		if (
			!(window as unknown as { ai14all?: { codeNav?: unknown } }).ai14all
				?.codeNav
		)
			return;
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
			if (e.workspaceId === ref.workspaceId && e.worktreeId === ref.worktreeId)
				void load();
		});
		const unsubUnavailable = subscribeWorktreeUnavailable((e) => {
			if (e.workspaceId === ref.workspaceId && e.worktreeId === ref.worktreeId)
				void load();
		});
		const unsubAvail = subscribeAvailabilityChanged(() => {
			void load();
		});
		return () => {
			cancelled = true;
			unsub();
			unsubUnavailable();
			unsubAvail();
		};
	}, [ref?.workspaceId, ref?.worktreeId]);

	return status;
}
