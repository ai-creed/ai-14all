import { useCallback, useEffect, useRef, useState } from "react";
import type { WhisperWorktreeState } from "../../../../shared/models/ecosystem-plugin";
import {
	type AgentProvider,
	boundCount,
	MOUNT_PENDING_TIMEOUT_MS,
} from "./agent-launch";

type DeferredMount = {
	provider: AgentProvider;
	slot: number | undefined;
	enqueuedAt: number;
};

export type DeferredMountController = {
	/** The queued provider (for the chip badge), or null. */
	deferredProvider: AgentProvider | null;
	/** True while a deferral occupies the single queue slot (capacity accounting). */
	deferredOccupied: boolean;
	/** Queue a mount; no-op if one is already queued (FIFO, no replacement). */
	enqueue: (provider: AgentProvider, slot: number | undefined) => void;
	/** Cancel the queued mount (e.g. the user re-clicked the queued chip). */
	cancel: () => void;
};

/**
 * Single-slot deferred-mount queue. When a rapid second click is deferred while
 * the first mount settles, this fires it once the prior mount has actually bound
 * (`mountInFlight` cleared) and a real slot is free; if the collab never becomes
 * ready within the timeout it falls back to a plain vendor launch.
 */
export function useDeferredMount(opts: {
	whisperState: WhisperWorktreeState | undefined;
	mountInFlight: boolean;
	onReady: (provider: AgentProvider, slot: number | undefined) => void;
	onTimeout: (provider: AgentProvider, slot: number | undefined) => void;
}): DeferredMountController {
	const { whisperState, mountInFlight, onReady, onTimeout } = opts;
	const [deferred, setDeferred] = useState<DeferredMount | null>(null);

	// Keep callbacks fresh without re-arming the effects.
	const onReadyRef = useRef(onReady);
	const onTimeoutRef = useRef(onTimeout);
	onReadyRef.current = onReady;
	onTimeoutRef.current = onTimeout;

	const daemonAlive = whisperState?.daemonAlive ?? false;
	const liveBound = daemonAlive ? boundCount(whisperState) : 0;

	useEffect(() => {
		if (!deferred) return;
		if (daemonAlive && !mountInFlight && liveBound < 2) {
			const { provider, slot } = deferred;
			setDeferred(null);
			onReadyRef.current(provider, slot);
		}
	}, [deferred, daemonAlive, mountInFlight, liveBound]);

	useEffect(() => {
		if (!deferred) return;
		const remaining =
			MOUNT_PENDING_TIMEOUT_MS - (Date.now() - deferred.enqueuedAt);
		const timer = setTimeout(
			() => {
				setDeferred((cur) => {
					if (!cur) return null;
					onTimeoutRef.current(cur.provider, cur.slot);
					return null;
				});
			},
			Math.max(0, remaining),
		);
		return () => clearTimeout(timer);
	}, [deferred]);

	const enqueue = useCallback(
		(provider: AgentProvider, slot: number | undefined) => {
			setDeferred((cur) =>
				cur ? cur : { provider, slot, enqueuedAt: Date.now() },
			);
		},
		[],
	);
	const cancel = useCallback(() => setDeferred(null), []);

	return {
		deferredProvider: deferred?.provider ?? null,
		deferredOccupied: deferred !== null,
		enqueue,
		cancel,
	};
}
