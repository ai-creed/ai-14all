import { useCallback, useEffect, useState } from "react";
import type { WhisperWorktreeState } from "../../../../shared/models/ecosystem-plugin";
import {
	advanceMountPending,
	beginMountPending,
	MOUNT_PENDING_TIMEOUT_MS,
	type MountPendingState,
} from "./agent-launch";

export type MountPendingGuard = {
	/**
	 * True while a collab-creating `whisper collab mount` is in flight. Every
	 * agent-launch surface reads this and resolves a rapid second click to a
	 * plain spawn instead of a second concurrent mount.
	 */
	mountPending: boolean;
	/** Open the pending window right after a mount command is issued. */
	beginMount: () => void;
};

/**
 * Single owner of the mount-pending guard, lifted out of AgentLauncherBar so it
 * can be shared across every launch surface (the chrome bar AND each empty-slot
 * launcher). With one shared window, a rapid second click *anywhere* cannot fire
 * a second concurrent collab mount. The window clears when the lens advances
 * (a binding landed or the daemon came alive) or after a generous timeout, so a
 * never-binding mount cannot wedge the chips.
 */
export function useMountPendingGuard(
	whisperState: WhisperWorktreeState | undefined,
): MountPendingGuard {
	const [pending, setPending] = useState<MountPendingState>({ kind: "idle" });

	useEffect(() => {
		setPending((current) =>
			advanceMountPending(current, whisperState, Date.now()),
		);
	}, [whisperState]);

	useEffect(() => {
		if (pending.kind !== "pending") return;
		const timer = setTimeout(() => {
			setPending((current) =>
				advanceMountPending(current, whisperState, Date.now()),
			);
		}, MOUNT_PENDING_TIMEOUT_MS + 50);
		return () => clearTimeout(timer);
	}, [pending, whisperState]);

	const beginMount = useCallback(() => {
		setPending(beginMountPending(whisperState, Date.now()));
	}, [whisperState]);

	return { mountPending: pending.kind === "pending", beginMount };
}
