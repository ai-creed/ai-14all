import type {
	AgentCliProbes,
	WhisperWorktreeState,
} from "../../../../shared/models/ecosystem-plugin";
import {
	boundCount,
	collabStatus,
	launchCommandFor,
	type AgentProvider,
	PROVIDER_LABEL,
	visibleProviders,
} from "../logic/agent-launch";

type Props = {
	probes: AgentCliProbes | null;
	whisperHealthy: boolean;
	whisperState: WhisperWorktreeState | undefined;
	/**
	 * Shared mount-pending flag (from useMountPendingGuard, owned one level up so
	 * every launch surface shares one window). True → a collab mount is in flight,
	 * so a click resolves to a plain spawn instead of a second concurrent mount.
	 */
	mountPending: boolean;
	/** Open the shared mount-pending window after issuing a mount command. */
	beginMount: () => void;
	/** The same id-based terminal launch the collab/preset paths use. */
	launchInTerminal: (command: string) => void;
};

/**
 * Stateless agent launchers (spec §3.3). Chips are never disabled: every click
 * spawns a terminal. `mountPending` only changes what a click *resolves to* —
 * during a collab-creating mount, a rapid second click (here OR in an empty-slot
 * launcher, since the guard is shared) resolves to a plain spawn rather than a
 * second concurrent `whisper collab mount` (spec §4/§7).
 */
export function AgentLauncherBar({
	probes,
	whisperHealthy,
	whisperState,
	mountPending,
	beginMount,
	launchInTerminal,
}: Props) {
	const providers = visibleProviders(probes);
	if (providers.length === 0) return null;

	const status = collabStatus(whisperState, whisperHealthy);

	const onLaunch = (provider: AgentProvider) => {
		const command = launchCommandFor(provider, {
			whisperHealthy,
			boundCount: boundCount(whisperState),
			daemonAlive: whisperState?.daemonAlive ?? false,
			mountPending,
		});
		launchInTerminal(command);
		if (command.startsWith("whisper collab mount")) {
			beginMount();
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
					data-provider={provider}
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
