import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitCommandFailure =
	| { kind: "timeout" }
	| { kind: "max-buffer-exceeded" }
	| { kind: "not-a-repo" }
	| { kind: "missing-ref"; ref: string }
	| { kind: "command-failed"; exitCode: number | null }
	| { kind: "aborted" };

export type GitCommandResult =
	| { ok: true; stdout: string; durationMs: number }
	| {
			ok: false;
			reason: GitCommandFailure;
			durationMs: number;
			stderr?: string;
	  };

export type GitCommandOptions = {
	args: string[];
	cwd: string;
	timeoutMs?: number;
	maxBufferBytes?: number;
	signal?: AbortSignal;
	expectExitCodes?: number[];
	label: string;
	env?: NodeJS.ProcessEnv;
};

export class GitCommandRunner {
	constructor(
		private readonly opts: {
			binary: string;
			defaultTimeoutMs?: number;
			defaultMaxBuffer?: number;
		} = { binary: "git" },
	) {}

	async run(options: GitCommandOptions): Promise<GitCommandResult> {
		const start = performance.now();
		const expect = options.expectExitCodes ?? [0];
		const env = {
			...process.env,
			LANG: "C",
			GIT_TERMINAL_PROMPT: "0",
			...(options.env ?? {}),
		};
		try {
			const { stdout } = await execFileAsync(this.opts.binary, options.args, {
				cwd: options.cwd,
				timeout: options.timeoutMs ?? this.opts.defaultTimeoutMs ?? 30_000,
				maxBuffer:
					options.maxBufferBytes ??
					this.opts.defaultMaxBuffer ??
					16 * 1024 * 1024,
				signal: options.signal,
				env,
			});
			const durationMs = Math.round(performance.now() - start);
			console.info(`[git] ${options.label} ok ${durationMs}ms`);
			return { ok: true, stdout, durationMs };
		} catch (err: unknown) {
			const durationMs = Math.round(performance.now() - start);
			const reason = classifyError(err);
			const stderr =
				typeof err === "object" && err !== null && "stderr" in err
					? String((err as { stderr?: string }).stderr ?? "")
					: undefined;

			// Allowed exit code → treat as ok with whatever stdout was captured.
			if (
				reason.kind === "command-failed" &&
				typeof reason.exitCode === "number" &&
				expect.includes(reason.exitCode)
			) {
				const stdout =
					typeof err === "object" && err !== null && "stdout" in err
						? String((err as { stdout?: string }).stdout ?? "")
						: "";
				console.info(
					`[git] ${options.label} ok ${durationMs}ms (exit ${reason.exitCode})`,
				);
				return { ok: true, stdout, durationMs };
			}

			console.info(`[git] ${options.label} ${reason.kind} ${durationMs}ms`);
			return { ok: false, reason, durationMs, stderr };
		}
	}
}

function classifyError(err: unknown): GitCommandFailure {
	if (typeof err !== "object" || err === null) {
		return { kind: "command-failed", exitCode: null };
	}
	const e = err as {
		code?: number | string;
		signal?: string;
		killed?: boolean;
		stderr?: string;
		message?: string;
		name?: string;
	};

	if (
		e.name === "AbortError" ||
		e.code === "ABORT_ERR" ||
		e.message === "The operation was aborted"
	) {
		return { kind: "aborted" };
	}
	if (e.killed && e.signal === "SIGTERM") return { kind: "timeout" };
	if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
		return { kind: "max-buffer-exceeded" };

	const stderr = e.stderr ?? "";
	if (/not a git repository/i.test(stderr)) return { kind: "not-a-repo" };
	const refMatch = stderr.match(/(?:unknown revision|bad revision) '([^']+)'/);
	if (refMatch) return { kind: "missing-ref", ref: refMatch[1] };

	const exitCode = typeof e.code === "number" ? e.code : null;
	return { kind: "command-failed", exitCode };
}
