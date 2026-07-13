// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execMock = vi.fn();
vi.mock("node:child_process", () => ({
	execFile: (cmd: string, args: string[], cb: (...rest: unknown[]) => void) =>
		execMock(cmd, args, cb),
}));

import { CodexProvider } from "../../../services/review/agent-skill-installer/codex-provider.js";
import type { BundledSkill } from "../../../services/review/agent-skill-installer/skill-asset.js";

const SKILLS: BundledSkill[] = [
	{ id: "ai-14all-fix-review", content: "skill body" },
];

describe("CodexProvider", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "codex-prov-"));
		execMock.mockReset();
	});

	it("installSkills runs `codex mcp add` with correct args when CLI is available", async () => {
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "ok", stderr: "" }),
		);
		const provider = new CodexProvider({
			home: dir,
			cliPath: "codex",
			isCliAvailable: async () => true,
		});
		await provider.installSkills({
			serverName: "ai-14all",
			url: "http://127.0.0.1:51234",
			skills: SKILLS,
		});
		// installSkills is idempotent: first call is `mcp remove` (swallowed), then `mcp add`.
		expect(execMock.mock.calls[0]?.[1]).toEqual(["mcp", "remove", "ai-14all"]);
		expect(execMock.mock.calls[1]?.[1]).toEqual([
			"mcp",
			"add",
			"--url",
			"http://127.0.0.1:51234",
			"ai-14all",
		]);
		// MCP registration is server-level, runs exactly once regardless of skill count.
		expect(execMock.mock.calls.length).toBe(2);
		const skill = await readFile(
			join(dir, ".codex", "skills", "ai-14all-fix-review", "SKILL.md"),
			"utf-8",
		);
		expect(skill).toBe("skill body");
	});

	it("installSkills throws when the CLI is absent and writes nothing", async () => {
		const provider = new CodexProvider({
			home: dir,
			cliPath: "codex",
			isCliAvailable: async () => false,
		});
		await expect(
			provider.installSkills({
				serverName: "ai-14all",
				url: "http://127.0.0.1:51234",
				skills: SKILLS,
			}),
		).rejects.toThrow(/codex CLI is not available/);
		await expect(
			access(join(dir, ".codex", "skills", "ai-14all-fix-review", "SKILL.md")),
		).rejects.toBeTruthy();
	});

	it("uninstall removes SKILL.md, preserves evals, still runs mcp remove", async () => {
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "", stderr: "" }),
		);
		const provider = new CodexProvider({
			home: dir,
			cliPath: "codex",
			isCliAvailable: async () => true,
		});
		const skillDir = join(dir, ".codex", "skills", "ai-14all-fix-review");
		await mkdir(join(skillDir, "evals"), { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "x", "utf-8");
		await writeFile(join(skillDir, "evals", "evals.json"), "{}", "utf-8");
		await provider.uninstall({ serverName: "ai-14all" });
		const callArgs = execMock.mock.calls.at(-1)?.[1];
		expect(callArgs).toEqual(["mcp", "remove", "ai-14all"]);
		await expect(access(join(skillDir, "SKILL.md"))).rejects.toBeTruthy();
		expect(await readFile(join(skillDir, "evals", "evals.json"), "utf-8")).toBe(
			"{}",
		);
	});

	it("uninstall removes the whole dir when it only held SKILL.md", async () => {
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "", stderr: "" }),
		);
		const provider = new CodexProvider({
			home: dir,
			cliPath: "codex",
			isCliAvailable: async () => true,
		});
		await provider.installSkills({
			serverName: "ai-14all",
			url: "http://127.0.0.1:51234",
			skills: [{ id: "ai-14all-fix-review", content: "x" }],
		});
		await provider.uninstall({ serverName: "ai-14all" });
		await expect(
			access(join(dir, ".codex", "skills", "ai-14all-fix-review")),
		).rejects.toBeTruthy();
	});

	it("uninstall succeeds when the skill directories are missing", async () => {
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "", stderr: "" }),
		);
		const provider = new CodexProvider({
			home: dir,
			cliPath: "codex",
			isCliAvailable: async () => true,
		});
		// Nothing was ever installed under this temp HOME.
		await expect(
			provider.uninstall({ serverName: "ai-14all" }),
		).resolves.toBeUndefined();
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});
});
