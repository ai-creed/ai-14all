export type PresetLaunchTarget = "pinned" | "throwaway";

export type CommandPreset = {
	id: string;
	label: string;
	command: string;
	/** Where Launch sends the preset: a pinned grid terminal or a throwaway shell. */
	target: PresetLaunchTarget;
};

export const DEFAULT_COMMAND_PRESETS: CommandPreset[] = [
	{
		id: "preset-start-claude-yolo",
		label: "start claude (yolo)",
		command: "claude --dangerously-skip-permissions",
		target: "pinned",
	},
	{
		id: "preset-start-codex-yolo",
		label: "start codex (yolo)",
		command: "codex --yolo",
		target: "pinned",
	},
];

// Plain claude/codex presets retired in slice 2 — redundant with quick-launch
// (AgentLauncherBar). Pruned from a hydrated workspace only when still untouched
// (both id and command match the original seed), so an edited preset survives.
export const RETIRED_DEFAULT_PRESETS: { id: string; command: string }[] = [
	{ id: "preset-start-claude", command: "claude" },
	{ id: "preset-start-codex", command: "codex" },
];

export function pruneRetiredDefaults(
	presets: CommandPreset[],
): CommandPreset[] {
	return presets.filter(
		(p) =>
			!RETIRED_DEFAULT_PRESETS.some(
				(r) => r.id === p.id && r.command === p.command,
			),
	);
}
