import { useEffect, useState } from "react";
import type {
	AgentCliProbes,
	WhisperWorktreeState,
} from "../../../../shared/models/ecosystem-plugin";
import {
	advanceMountPending,
	beginMountPending,
	boundCount,
	collabStatus,
	launchCommandFor,
	MOUNT_PENDING_TIMEOUT_MS,
	type AgentProvider,
	type MountPendingState,
	visibleProviders,
} from "../logic/agent-launch";

const PROVIDER_LABEL: Record<AgentProvider, string> = {
	claude: "Claude",
	codex: "Codex",
	ezio: "Ezio",
};

type Props = {
	probes: AgentCliProbes | null;
	whisperHealthy: boolean;
	whisperState: WhisperWorktreeState | undefined;
	/** The same id-based terminal launch the collab/preset paths use. */
	launchInTerminal: (command: string) => void;
};

/**
 * Stateless agent launchers (spec §3.3). Chips are never disabled: every click
 * spawns a terminal. `pendingMount` only changes what a click *resolves to* —
 * during a collab-creating mount, a rapid second click resolves to a plain
 * spawn rather than a second concurrent `whisper collab mount` (spec §4/§7).
 */
export function AgentLauncherBar({
	probes,
	whisperHealthy,
	whisperState,
	launchInTerminal,
}: Props) {
	const [pending, setPending] = useState<MountPendingState>({ kind: "idle" });

	// Clear the pending window when the lens snapshot advances.
	useEffect(() => {
		setPending((current) =>
			advanceMountPending(current, whisperState, Date.now()),
		);
	}, [whisperState]);

	// Timeout fallback so a never-binding mount cannot wedge the chips.
	useEffect(() => {
		if (pending.kind !== "pending") return;
		const timer = setTimeout(() => {
			setPending((current) =>
				advanceMountPending(current, whisperState, Date.now()),
			);
		}, MOUNT_PENDING_TIMEOUT_MS + 50);
		return () => clearTimeout(timer);
	}, [pending, whisperState]);

	const providers = visibleProviders(probes);
	if (providers.length === 0) return null;

	const status = collabStatus(whisperState, whisperHealthy);

	const onLaunch = (provider: AgentProvider) => {
		const command = launchCommandFor(provider, {
			whisperHealthy,
			boundCount: boundCount(whisperState),
			mountPending: pending.kind === "pending",
		});
		launchInTerminal(command);
		if (command.startsWith("whisper collab mount")) {
			setPending(beginMountPending(whisperState, Date.now()));
		}
	};

	return (
		<div
			className="shell-chip-bar__terminal-group"
			data-testid="agent-launcher-bar"
		>
			<span className="agent-launcher-bar__label" aria-hidden="true">
				Agents
			</span>
			{providers.map((provider) => (
				<button
					key={provider}
					type="button"
					className="shell-chip-bar__action"
					data-testid={`agent-launch-${provider}`}
					aria-label={`Launch ${PROVIDER_LABEL[provider]} agent`}
					onClick={() => onLaunch(provider)}
				>
					<span className="shell-chip-bar__action-icon" aria-hidden="true">
						▸
					</span>
					{PROVIDER_LABEL[provider]}
				</button>
			))}
			{status && (
				<span
					className="agent-launcher-bar__status"
					data-tone={status.tone}
					data-testid="collab-status-pill"
				>
					{status.label}
				</span>
			)}
		</div>
	);
}
