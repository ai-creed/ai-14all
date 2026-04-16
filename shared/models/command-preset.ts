export type CommandPreset = {
	id: string;
	label: string;
	command: string;
};

export const DEFAULT_COMMAND_PRESETS: CommandPreset[] = [
	{
		id: "preset-start-claude-yolo",
		label: "start claude (yolo)",
		command: "claude --dangerously-skip-permissions",
	},
	{
		id: "preset-start-codex-yolo",
		label: "start codex (yolo)",
		command: "codex --full-auto",
	},
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
