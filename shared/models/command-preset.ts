export type CommandPreset = {
	id: string;
	label: string;
	command: string;
};

export const DEFAULT_COMMAND_PRESETS: CommandPreset[] = [
	{
		id: "preset-start-claude",
		label: "start claude",
		command: "claude",
	},
	{
		id: "preset-start-codex",
		label: "start codex",
		command: "codex",
	},
];
