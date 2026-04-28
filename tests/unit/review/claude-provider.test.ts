// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execMock = vi.fn();
vi.mock("node:child_process", () => ({
	execFile: (cmd: string, args: string[], cb: (...rest: unknown[]) => void) =>
		execMock(cmd, args, cb),
}));

import { ClaudeProvider } from "../../../services/review/agent-skill-installer/claude-provider.js";

describe("ClaudeProvider", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "claude-prov-"));
		execMock.mockReset();
	});

	it("install runs `claude mcp add` with correct args when CLI is available", async () => {
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "ok", stderr: "" }),
		);
		const provider = new ClaudeProvider({
			home: dir,
			cliPath: "claude",
			isCliAvailable: async () => true,
		});
		await provider.install({
			serverName: "ai-14all",
			url: "http://127.0.0.1:51234",
			skill: { content: "skill body" },
		});
		// install is idempotent: first call is `mcp remove` (swallowed), then `mcp add`.
		expect(execMock.mock.calls[0]?.[1]).toEqual(["mcp", "remove", "ai-14all"]);
		expect(execMock.mock.calls[1]?.[1]).toEqual([
			"mcp",
			"add",
			"--transport",
			"http",
			"--scope",
			"user",
			"ai-14all",
			"http://127.0.0.1:51234",
		]);
		const skill = await readFile(
			join(dir, ".claude", "skills", "ai-14all-fix-review", "SKILL.md"),
			"utf-8",
		);
		expect(skill).toBe("skill body");
	});

	it("install throws when the CLI is absent and writes nothing", async () => {
		const provider = new ClaudeProvider({
			home: dir,
			cliPath: "claude",
			isCliAvailable: async () => false,
		});
		await expect(
			provider.install({
				serverName: "ai-14all",
				url: "http://127.0.0.1:51234",
				skill: { content: "skill body" },
			}),
		).rejects.toThrow(/claude CLI is not available/);
		await expect(
			access(join(dir, ".claude", "skills", "ai-14all-fix-review", "SKILL.md")),
		).rejects.toBeTruthy();
	});

	it("uninstall runs `claude mcp remove` and deletes the skill folder", async () => {
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "", stderr: "" }),
		);
		const provider = new ClaudeProvider({
			home: dir,
			cliPath: "claude",
			isCliAvailable: async () => true,
		});
		await provider.install({
			serverName: "ai-14all",
			url: "http://127.0.0.1:51234",
			skill: { content: "x" },
		});
		await provider.uninstall({ serverName: "ai-14all" });
		const callArgs = execMock.mock.calls.at(-1)?.[1];
		expect(callArgs).toEqual(["mcp", "remove", "ai-14all"]);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});
});
