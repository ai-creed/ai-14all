// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GitCommandRunner } from "../../../../services/git/git-command-runner.js";

const SHELL = process.platform === "win32" ? "cmd" : "/bin/sh";
const sleepArgs = (sec: number) =>
	process.platform === "win32"
		? ["/c", `timeout ${sec}`]
		: ["-c", `sleep ${sec}`];

describe("GitCommandRunner", () => {
	it("returns ok with stdout and durationMs on success", async () => {
		const runner = new GitCommandRunner({ binary: SHELL });
		const result = await runner.run({
			args:
				process.platform === "win32"
					? ["/c", "echo hello"]
					: ["-c", "echo hello"],
			cwd: process.cwd(),
			label: "test.echo",
			timeoutMs: 5_000,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.stdout.trim()).toBe("hello");
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		}
	});

	it("returns timeout when the command exceeds timeoutMs", async () => {
		const runner = new GitCommandRunner({ binary: SHELL });
		const result = await runner.run({
			args: sleepArgs(2),
			cwd: process.cwd(),
			label: "test.sleep",
			timeoutMs: 100,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason.kind).toBe("timeout");
	}, 10_000);

	it("returns aborted when AbortSignal fires", async () => {
		const runner = new GitCommandRunner({ binary: SHELL });
		const ctrl = new AbortController();
		setTimeout(() => ctrl.abort(), 50);
		const result = await runner.run({
			args: sleepArgs(2),
			cwd: process.cwd(),
			label: "test.abort",
			timeoutMs: 5_000,
			signal: ctrl.signal,
		});
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(["aborted", "timeout"]).toContain(result.reason.kind);
	}, 10_000);

	it("treats listed expectExitCodes as success", async () => {
		const runner = new GitCommandRunner({ binary: SHELL });
		const result = await runner.run({
			args: process.platform === "win32" ? ["/c", "exit 1"] : ["-c", "exit 1"],
			cwd: process.cwd(),
			label: "test.exit1",
			timeoutMs: 5_000,
			expectExitCodes: [0, 1],
		});
		expect(result.ok).toBe(true);
	});

	it("returns command-failed for unexpected non-zero exit", async () => {
		const runner = new GitCommandRunner({ binary: SHELL });
		const result = await runner.run({
			args: process.platform === "win32" ? ["/c", "exit 2"] : ["-c", "exit 2"],
			cwd: process.cwd(),
			label: "test.exit2",
			timeoutMs: 5_000,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason.kind).toBe("command-failed");
	});
});
