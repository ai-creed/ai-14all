// Single source of truth for coding-agent identity. Discovery, launcher chips,
// branding, and launch-command construction all derive from this registry, so a
// new agent is added in exactly one place. `binary` is the CLI used to probe and
// to launch (it may differ from `id`); `whisperCapable` gates whether the agent
// can be mounted into a whisper collab.
export type AgentProviderId = "claude" | "codex" | "ezio";

export type AgentProviderDef = {
	id: AgentProviderId;
	label: string;
	binary: string;
	whisperCapable: boolean;
	/** CSS color token for this provider's branding (chip + sidebar badge). */
	brand: string;
};

// Stable left-to-right order of the launcher chips.
export const AGENT_PROVIDERS: readonly AgentProviderDef[] = [
	{
		id: "claude",
		label: "Claude",
		binary: "claude",
		whisperCapable: true,
		brand: "var(--provider-claude)",
	},
	{
		id: "codex",
		label: "Codex",
		binary: "codex",
		whisperCapable: true,
		brand: "var(--provider-codex)",
	},
	{
		id: "ezio",
		label: "Ezio",
		binary: "ezio",
		whisperCapable: true,
		brand: "var(--provider-ezio)",
	},
] as const;

export const AGENT_PROVIDER_IDS: readonly AgentProviderId[] =
	AGENT_PROVIDERS.map((p) => p.id);

export const PROVIDER_LABEL = Object.fromEntries(
	AGENT_PROVIDERS.map((p) => [p.id, p.label]),
) as Record<AgentProviderId, string>;

export function providerDef(id: AgentProviderId): AgentProviderDef {
	const def = AGENT_PROVIDERS.find((p) => p.id === id);
	if (!def) throw new Error(`Unknown agent provider: ${id}`);
	return def;
}
