// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { EzioProvider } from "../../../services/review/agent-skill-installer/ezio-provider.js";
import type { BundledSkill } from "../../../services/review/agent-skill-installer/skill-asset.js";

const SKILLS: BundledSkill[] = [
	{ id: "ai-14all-fix-review", content: "fix body" },
	{ id: "ai-14all-session-status", content: "status body" },
];
const URL = "http://127.0.0.1:51266/mcp";

type McpFile = {
	mcpServers: Record<string, { command: string; args?: string[] }>;
	toolPolicy?: Record<string, string>;
	hostPrivateTools?: string[];
};

describe("EzioProvider", () => {
	let configDir: string;
	beforeEach(async () => {
		configDir = await mkdtemp(join(tmpdir(), "ezio-cfg-"));
	});
	afterEach(async () => {
		await rm(configDir, { recursive: true, force: true });
	});

	function newProvider(cliAvailable = true) {
		return new EzioProvider({
			configDir,
			isCliAvailable: async () => cliAvailable,
		});
	}

	async function readMcp(): Promise<McpFile> {
		return JSON.parse(await readFile(join(configDir, "mcp.json"), "utf-8"));
	}

	it("writes every bundled skill into <configDir>/skills/<id>/SKILL.md", async () => {
		await newProvider().installSkills({
			serverName: "ai-14all",
			url: URL,
			skills: SKILLS,
		});
		expect(
			await readFile(
				join(configDir, "skills", "ai-14all-fix-review", "SKILL.md"),
				"utf-8",
			),
		).toBe("fix body");
		expect(
			await readFile(
				join(configDir, "skills", "ai-14all-session-status", "SKILL.md"),
				"utf-8",
			),
		).toBe("status body");
	});

	it("registers the stdio->HTTP mcp-remote bridge entry in mcp.json", async () => {
		await newProvider().installSkills({
			serverName: "ai-14all",
			url: URL,
			skills: SKILLS,
		});
		const mcp = await readMcp();
		expect(mcp.mcpServers["ai-14all"]).toEqual({
			command: "npx",
			args: ["-y", "mcp-remote", URL],
		});
	});

	it("merges into an existing mcp.json, preserving other servers and ezio keys", async () => {
		await writeFile(
			join(configDir, "mcp.json"),
			JSON.stringify({
				mcpServers: { cortex: { command: "ai-cortex", args: ["mcp"] } },
				toolPolicy: { cortex__purge_memory: "deny" },
				hostPrivateTools: ["cortex__capture_session"],
			}),
			"utf-8",
		);
		await newProvider().installSkills({
			serverName: "ai-14all",
			url: URL,
			skills: SKILLS,
		});
		const mcp = await readMcp();
		expect(mcp.mcpServers.cortex).toEqual({
			command: "ai-cortex",
			args: ["mcp"],
		});
		expect(mcp.mcpServers["ai-14all"]).toEqual({
			command: "npx",
			args: ["-y", "mcp-remote", URL],
		});
		expect(mcp.toolPolicy).toEqual({ cortex__purge_memory: "deny" });
		expect(mcp.hostPrivateTools).toEqual(["cortex__capture_session"]);
	});

	it("is idempotent — re-install overwrites the same entry, no duplication", async () => {
		const p = newProvider();
		await p.installSkills({ serverName: "ai-14all", url: URL, skills: SKILLS });
		await p.installSkills({ serverName: "ai-14all", url: URL, skills: SKILLS });
		const mcp = await readMcp();
		expect(Object.keys(mcp.mcpServers)).toEqual(["ai-14all"]);
	});

	it("backs up a malformed mcp.json and writes a fresh one", async () => {
		await writeFile(join(configDir, "mcp.json"), "{ not json", "utf-8");
		await newProvider().installSkills({
			serverName: "ai-14all",
			url: URL,
			skills: SKILLS,
		});
		const mcp = await readMcp();
		expect(mcp.mcpServers["ai-14all"]).toBeDefined();
		expect(await readFile(join(configDir, "mcp.json.bak"), "utf-8")).toBe(
			"{ not json",
		);
	});

	it("throws when ezio CLI is unavailable and writes nothing", async () => {
		await expect(
			newProvider(false).installSkills({
				serverName: "ai-14all",
				url: URL,
				skills: SKILLS,
			}),
		).rejects.toThrow(/ezio CLI is not available/i);
		await expect(access(join(configDir, "mcp.json"))).rejects.toBeTruthy();
		await expect(
			access(join(configDir, "skills", "ai-14all-fix-review", "SKILL.md")),
		).rejects.toBeTruthy();
	});

	it("uninstall removes skill dirs' SKILL.md and the ai-14all entry, preserving other servers and evals", async () => {
		await writeFile(
			join(configDir, "mcp.json"),
			JSON.stringify({
				mcpServers: { cortex: { command: "ai-cortex", args: ["mcp"] } },
			}),
			"utf-8",
		);
		const p = newProvider();
		await p.installSkills({ serverName: "ai-14all", url: URL, skills: SKILLS });
		const evalsDir = join(configDir, "skills", "ai-14all-fix-review", "evals");
		await mkdir(evalsDir, { recursive: true });
		await writeFile(join(evalsDir, "evals.json"), "{}", "utf-8");
		await p.uninstall({ serverName: "ai-14all" });
		const mcp = await readMcp();
		expect(mcp.mcpServers["ai-14all"]).toBeUndefined();
		expect(mcp.mcpServers.cortex).toEqual({
			command: "ai-cortex",
			args: ["mcp"],
		});
		await expect(
			access(join(configDir, "skills", "ai-14all-fix-review", "SKILL.md")),
		).rejects.toBeTruthy();
		expect(await readFile(join(evalsDir, "evals.json"), "utf-8")).toBe("{}");
		// The second skill dir held only SKILL.md → fully removed.
		await expect(
			access(join(configDir, "skills", "ai-14all-session-status")),
		).rejects.toBeTruthy();
	});

	it("uninstall succeeds when the skill directories are missing", async () => {
		// Fresh configDir: no skills, no mcp.json.
		await expect(
			newProvider().uninstall({ serverName: "ai-14all" }),
		).resolves.toBeUndefined();
	});
});
