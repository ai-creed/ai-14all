export type TerminalSession = {
	id: string;
	workspaceId: string;
	worktreeId: string;
	cwd: string;
	status: "idle" | "running" | "exited" | "error";
	exitCode: number | null;
};
