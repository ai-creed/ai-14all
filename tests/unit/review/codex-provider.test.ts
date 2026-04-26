// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execMock = vi.fn();
vi.mock("node:child_process", () => ({
	execFile: (cmd: string, args: string[], cb: any) => execMock(cmd, args, cb),
}));

import { CodexProvider } from "../../../services/review/agent-skill-installer/codex-provider.js";

describe("CodexProvider", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "codex-prov-"));
		execMock.mockReset();
	});

	it("install runs `codex mcp add` with correct args when CLI is available", async () => {
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "ok", stderr: "" }),
		);
		const provider = new CodexProvider({
			home: dir,
			cliPath: "codex",
			isCliAvailable: async () => true,
		});
		await provider.install({
			serverName: "ai-14all",
			url: "http://127.0.0.1:51234",
			skill: { content: "skill body" },
		});
		const callArgs = execMock.mock.calls[0]?.[1];
		expect(callArgs).toEqual(["mcp", "add", "--url", "http://127.0.0.1:51234", "ai-14all"]);
		const skill = await readFile(
			join(dir, ".codex", "skills", "ai-14all-fix-review", "SKILL.md"),
			"utf-8",
		);
		expect(skill).toBe("skill body");
	});

	it("install throws when the CLI is absent and writes nothing", async () => {
		const provider = new CodexProvider({
			home: dir,
			cliPath: "codex",
			isCliAvailable: async () => false,
		});
		await expect(
			provider.install({
				serverName: "ai-14all",
				url: "http://127.0.0.1:51234",
				skill: { content: "skill body" },
			}),
		).rejects.toThrow(/codex CLI is not available/);
		await expect(
			access(join(dir, ".codex", "skills", "ai-14all-fix-review", "SKILL.md")),
		).rejects.toBeTruthy();
	});

	it("uninstall runs `codex mcp remove` and deletes the skill folder", async () => {
		execMock.mockImplementation((_cmd, _args, cb) => cb(null, { stdout: "", stderr: "" }));
		const provider = new CodexProvider({
			home: dir,
			cliPath: "codex",
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
