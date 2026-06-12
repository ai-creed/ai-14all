import { execFile as nodeExecFile } from "node:child_process";
import type {
	WhisperCommand,
	WhisperCommandResult,
} from "../../../shared/contracts/plugins.js";
import type { PluginCommandLogger } from "../../diagnostics/plugin-command-logger.js";
import type { ResolvedBinary } from "../binary-resolver.js";

export function commandToArgv(command: WhisperCommand): string[] {
	switch (command.kind) {
		case "workflow-pause":
			return ["workflow", "pause", command.workflowId];
		case "workflow-resume":
			return command.message === null
				? ["workflow", "resume", command.workflowId]
				: [
						"workflow",
						"resume",
						command.workflowId,
						"--message",
						command.message,
					];
		case "workflow-cancel":
			return ["workflow", "cancel", command.workflowId];
		case "collab-tell":
			return [
				"collab",
				"tell",
				"--target",
				command.target,
				command.instruction,
			];
		case "collab-recover":
			return ["collab", "recover"];
	}
}

export type WhisperCommandRunner = {
	/**
	 * `cwd` is the SERVER-SIDE-RESOLVED worktree path (resolved from
	 * workspaceId/worktreeId in plugin-ipc per the Privileged IPC Trust
	 * Boundary). The runner never sees renderer-supplied paths.
	 */
	run(command: WhisperCommand, cwd: string): Promise<WhisperCommandResult>;
};

export function createWhisperCommandRunner(options: {
	getBinary: () => Promise<ResolvedBinary | null>;
	audit: PluginCommandLogger;
	execFileImpl?: typeof nodeExecFile;
	now?: () => number;
	timeoutMs?: number;
}): WhisperCommandRunner {
	const execFile = options.execFileImpl ?? nodeExecFile;
	const now = options.now ?? (() => Date.now());
	// `collab tell` blocks until the target agent replies (waitForReply in
	// whisper's tell.ts), so the timeout must be generous.
	const timeoutMs = options.timeoutMs ?? 10 * 60_000;

	return {
		run(command, cwd) {
			return new Promise((resolve) => {
				void (async () => {
					const binary = await options.getBinary();
					const argv = commandToArgv(command);
					const startedAt = now();
					if (binary === null) {
						options.audit.append({
							ts: startedAt,
							plugin: "whisper",
							argv,
							cwd,
							exitCode: null,
							durationMs: 0,
							stderrSample: "binary not resolved",
						});
						resolve({
							ok: false,
							exitCode: null,
							stdout: "",
							stderr: "whisper binary not resolved",
						});
						return;
					}
					execFile(
						binary.command,
						[...binary.prefixArgs, ...argv],
						{ cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
						(error, stdout, stderr) => {
							const exitCode = error
								? typeof (error as { code?: unknown }).code === "number"
									? ((error as { code?: number }).code ?? null)
									: null
								: 0;
							options.audit.append({
								ts: startedAt,
								plugin: "whisper",
								argv,
								cwd,
								exitCode,
								durationMs: now() - startedAt,
								stderrSample: String(stderr).slice(0, 500),
							});
							resolve({
								ok: error == null,
								exitCode,
								stdout: String(stdout),
								stderr: String(stderr),
							});
						},
					);
				})();
			});
		},
	};
}
