import { describe, expect, it, vi } from "vitest";
import {
	commandToArgv,
	createWhisperCommandRunner,
} from "../../../services/plugins/whisper/whisper-command-runner";

const REF = { workspaceId: "ws-1", worktreeId: "wt-1" } as const;

describe("commandToArgv", () => {
	it.each([
		[
			{ kind: "workflow-pause", workflowId: "wf1", ...REF },
			["workflow", "pause", "wf1"],
		],
		[
			{
				kind: "workflow-resume",
				workflowId: "wf1",
				message: "fixed it",
				...REF,
			},
			["workflow", "resume", "wf1", "--message", "fixed it"],
		],
		[
			{ kind: "workflow-resume", workflowId: "wf1", message: null, ...REF },
			["workflow", "resume", "wf1"],
		],
		[
			{ kind: "workflow-cancel", workflowId: "wf1", ...REF },
			["workflow", "cancel", "wf1"],
		],
		[
			{
				kind: "collab-tell",
				target: "codex",
				instruction: "run the tests; $(rm -rf /)",
				...REF,
			},
			["collab", "tell", "--target", "codex", "run the tests; $(rm -rf /)"],
		],
		[{ kind: "collab-recover", ...REF }, ["collab", "recover"]],
	] as const)("maps %j", (command, argv) => {
		expect(commandToArgv(command)).toEqual(argv);
	});
});

describe("createWhisperCommandRunner", () => {
	it("spawns the resolved binary with prefix args + cwd, captures result, audits", async () => {
		const execFile = vi.fn(
			(
				_cmd: string,
				_args: string[],
				_opts: unknown,
				cb: (e: Error | null, stdout: string, stderr: string) => void,
			) => cb(null, "ok\n", ""),
		);
		const audit = { append: vi.fn() };
		const runner = createWhisperCommandRunner({
			getBinary: async () => ({ command: "/bin/whisper", prefixArgs: [] }),
			audit: audit as never,
			execFileImpl: execFile as never,
			now: () => 1000,
		});
		const result = await runner.run(
			{ kind: "workflow-pause", workflowId: "wf1", ...REF },
			"/resolved/w1",
		);
		expect(execFile).toHaveBeenCalledWith(
			"/bin/whisper",
			["workflow", "pause", "wf1"],
			expect.objectContaining({ cwd: "/resolved/w1" }),
			expect.any(Function),
		);
		expect(result).toEqual({
			ok: true,
			exitCode: 0,
			stdout: "ok\n",
			stderr: "",
		});
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({
				argv: ["workflow", "pause", "wf1"],
				exitCode: 0,
			}),
		);
	});

	it("captures non-zero exit with stderr and audits the failure", async () => {
		const execFile = vi.fn(
			(
				_cmd: string,
				_args: string[],
				_opts: unknown,
				cb: (
					e: (Error & { code?: number }) | null,
					stdout: string,
					stderr: string,
				) => void,
			) => {
				const err = new Error("exit 1") as Error & { code?: number };
				err.code = 1;
				cb(err, "", "no collab found for cwd");
			},
		);
		const audit = { append: vi.fn() };
		const runner = createWhisperCommandRunner({
			getBinary: async () => ({ command: "/bin/whisper", prefixArgs: [] }),
			audit: audit as never,
			execFileImpl: execFile as never,
			now: () => 1000,
		});
		const result = await runner.run(
			{ kind: "collab-recover", ...REF },
			"/resolved/w1",
		);
		expect(result).toEqual({
			ok: false,
			exitCode: 1,
			stdout: "",
			stderr: "no collab found for cwd",
		});
	});

	it("fails cleanly when no binary resolves", async () => {
		const runner = createWhisperCommandRunner({
			getBinary: async () => null,
			audit: { append: vi.fn() } as never,
			execFileImpl: vi.fn() as never,
			now: () => 1000,
		});
		const result = await runner.run(
			{ kind: "collab-recover", ...REF },
			"/resolved/w1",
		);
		expect(result.ok).toBe(false);
		expect(result.stderr).toMatch(/not resolved/i);
	});
});
