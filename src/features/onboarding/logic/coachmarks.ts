export interface Coachmark {
	id: string;
	anchorId: string;
	title: string;
	body: string;
}

export const COACHMARKS: readonly Coachmark[] = [
	{
		id: "plugins",
		anchorId: "plugins",
		title: "Built-in power tools",
		body: "Built-in, app-powered tools — memory, history, collab — that make agents work better. Set them up here.",
	},
	{
		id: "telemetry",
		anchorId: "telemetry",
		title: "Token & cost usage",
		body: "Click for the token and cost breakdown; toggle week or month.",
	},
	{
		id: "settings-footer",
		anchorId: "settings-footer",
		title: "Themes & settings",
		body: "Themes and preferences live here.",
	},
	{
		id: "command-palette",
		anchorId: "command-palette",
		title: "Find everything",
		body: "⌘⇧K opens the command palette to run any action; ? opens the shortcuts overlay.",
	},
];
