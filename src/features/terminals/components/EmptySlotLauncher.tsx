import { type AgentProvider, PROVIDER_LABEL } from "../logic/agent-launch";

type Props = {
	slotIndex: number;
	/** Detected agent providers, in PROVIDER_ORDER. Empty → only the shell CTA. */
	providers: AgentProvider[];
	/** Launch the chosen agent into THIS slot (slot-targeted, shared guard). */
	onLaunchAgent: (provider: AgentProvider, slotIndex: number) => void;
	/** Start a plain shell in THIS slot. */
	onStartShell: (slotIndex: number) => void;
};

/**
 * The empty-slot launchpad: agent chips (primary) plus a secondary
 * start-a-shell CTA, all targeting THIS specific slot. The chips reuse the
 * chrome-bar launcher classes (`shell-chip-bar__action` + `data-provider`) so an
 * empty slot becomes a one-click way to fire the wanted agent right where it
 * belongs, in the same per-provider colors.
 */
export function EmptySlotLauncher({
	slotIndex,
	providers,
	onLaunchAgent,
	onStartShell,
}: Props) {
	const hasAgents = providers.length > 0;
	return (
		<div className="shell-terminal-slot__launcher">
			{hasAgents && (
				<div
					className="shell-terminal-slot__agents"
					data-testid={`slot-agents-${slotIndex}`}
				>
					{providers.map((provider) => (
						<button
							key={provider}
							type="button"
							className="shell-chip-bar__action"
							data-provider={provider}
							data-testid={`slot-agent-${slotIndex}-${provider}`}
							aria-label={`Launch ${PROVIDER_LABEL[provider]} agent in this slot`}
							onClick={() => onLaunchAgent(provider, slotIndex)}
						>
							<span className="shell-chip-bar__action-icon" aria-hidden="true">
								▸
							</span>
							{PROVIDER_LABEL[provider]}
						</button>
					))}
				</div>
			)}
			<button
				type="button"
				className="shell-terminal-slot__cta"
				data-secondary={hasAgents ? "true" : undefined}
				data-testid={`slot-cta-${slotIndex}`}
				onClick={() => onStartShell(slotIndex)}
			>
				{hasAgents ? "or start a shell" : "＋ start a shell"}
			</button>
		</div>
	);
}
