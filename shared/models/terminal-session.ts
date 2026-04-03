export type TerminalSession = {
  id: string;
  worktreeId: string;
  cwd: string;
  status: "idle" | "running" | "exited" | "error";
  exitCode: number | null;
};
