import { Icon } from "@/components/ui/icon";
import type {
	AgentCliProbes,
	WhisperWorktreeState,
} from "../../../../shared/models/ecosystem-plugin";
import {
	collabStatus,
	type AgentProvider,
	PROVIDER_LABEL,
	visibleProviders,
} from "../logic/agent-launch";

type Props = {
	probes: AgentCliProbes | null;
	whisperHealthy: boolean;
	whisperState: WhisperWorktreeState | undefined;
	/** The provider currently queued for a deferred mount, or null. */
	deferredProvider: AgentProvider | null;
	/** Owner-supplied launch handler (decision + dispatch live in App). */
	onLaunch: (provider: AgentProvider) => void;
};

/**
 * Stateless agent launchers (spec §3.3). Chips are never disabled: every click
 * calls `onLaunch(provider)`. The launch decision (mount / defer / vendor) and
 * the shared mount-pending window are owned one level up in App, so this bar is
 * purely presentational; it only reflects the queued provider via a badge.
 */
export function AgentLauncherBar({
	probes,
	whisperHealthy,
	whisperState,
	deferredProvider,
	onLaunch,
}: Props) {
	const providers = visibleProviders(probes);
	if (providers.length === 0) return null;

	const status = collabStatus(whisperState, whisperHealthy);

	return (
		<div
			className="shell-chip-bar__terminal-group"
			data-testid="agent-launcher-bar"
		>
			<span className="agent-launcher-bar__label" aria-hidden="true">
				Agents
			</span>
			{providers.map((provider) => {
				const queued = provider === deferredProvider;
				return (
					<button
						key={provider}
						type="button"
						className="shell-chip-bar__action"
						data-provider={provider}
						data-testid={`agent-launch-${provider}`}
						data-queued={queued ? "true" : undefined}
						aria-label={`Launch ${PROVIDER_LABEL[provider]} agent`}
						onClick={() => onLaunch(provider)}
					>
						<span className="shell-chip-bar__action-icon" aria-hidden="true">
							<Icon name="plus" />
						</span>
						{PROVIDER_LABEL[provider]}
						{queued && (
							<span
								className="agent-launcher-bar__queued"
								data-testid={`agent-queued-${provider}`}
							>
								queued
							</span>
						)}
					</button>
				);
			})}
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
