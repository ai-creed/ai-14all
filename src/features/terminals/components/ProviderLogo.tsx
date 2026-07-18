import type { ReactNode } from "react";
import {
	providerDef,
	type AgentProviderId,
} from "../../../../shared/models/agent-provider";

/**
 * Monochrome stroke-based provider marks, tinted with the provider's brand
 * token (terminal-ux-hardening spec §3). Paths are simplified tracings kept
 * deliberately minimal at 13px; ezio wears the 14all pyramid mark. All paths
 * inherit currentColor — never hardcode fills (TUI aesthetic constraint).
 */
const PROVIDER_PATHS: Record<AgentProviderId, ReactNode> = {
	claude: <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />,
	codex: (
		<>
			<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" />
			<circle cx="12" cy="12" r="2.4" />
		</>
	),
	ezio: (
		<>
			<path d="M12 3l9 16-9-2.5L3 19z" />
			<path d="M14 9.5l-4 2v3l3.5 2" />
		</>
	),
	cursor: (
		<>
			<path d="M12 4l6.9 4v8L12 20l-6.9-4V8z" />
			<path d="M12 12V4M12 12l-6.9 4M12 12l6.9 4" />
		</>
	),
	antigravity: (
		<>
			<path d="M12 4l8 16H4z" />
			<path d="M12 11v5" />
		</>
	),
};

export function ProviderLogo({ provider }: { provider: AgentProviderId }) {
	const def = providerDef(provider);
	return (
		<span
			className="shell-provider-logo"
			style={{ color: def.brand }}
			title={def.label}
			data-testid={`provider-logo-${provider}`}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				{PROVIDER_PATHS[provider]}
			</svg>
		</span>
	);
}
