import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BundledSkill } from "./skill-asset.js";
import { BUNDLED_SKILL_IDS } from "./skill-asset.js";
import {
	guardedWriteSkill,
	type SkillInstallOutcome,
} from "./skill-version.js";

export type Deps = {
	/** The `ai-ezio` config root, e.g. `${XDG_CONFIG_HOME:-~/.config}/ai-ezio`. */
	configDir: string;
	isCliAvailable: () => Promise<boolean>;
};

export type InstallSkillsInput = {
	serverName: string;
	url: string;
	skills: BundledSkill[];
};

/** A single stdio MCP server entry as stored in ezio's `mcp.json`. */
type StdioServer = {
	command: string;
	args?: string[];
	env?: Record<string, string>;
};
type McpJson = {
	mcpServers?: Record<string, StdioServer>;
	[key: string]: unknown;
};

/**
 * Installs ai-14all's bundled skills + registers its MCP server for ezio.
 *
 * ezio differs from claude/codex in two ways that shape this provider:
 *  - It has no `mcp add` CLI, so registration is a direct edit of
 *    `<configDir>/mcp.json` rather than a shell-out.
 *  - Its MCP host is stdio-only (`{command, args, env}` spawned over stdio),
 *    while ai-14all serves MCP over HTTP. So the entry can't point at the HTTP
 *    URL directly; it spawns the standard `mcp-remote` stdio→HTTP bridge:
 *    `npx -y mcp-remote <url>`.
 *
 * The merge preserves every other key ezio owns (`toolPolicy`,
 * `hostPrivateTools`, other servers) and is idempotent — re-running overwrites
 * the single `ai-14all` entry in place.
 */
export class EzioProvider {
	constructor(private readonly deps: Deps) {}

	private skillDir(skillId: string): string {
		return join(this.deps.configDir, "skills", skillId);
	}

	private mcpPath(): string {
		return join(this.deps.configDir, "mcp.json");
	}

	async installSkills(
		input: InstallSkillsInput,
	): Promise<SkillInstallOutcome[]> {
		if (!(await this.deps.isCliAvailable())) {
			throw new Error(
				"ai-ezio CLI is not available on PATH; install ezio or use the manual-setup snippet.",
			);
		}
		const outcomes: SkillInstallOutcome[] = [];
		for (const skill of input.skills) {
			const action = await guardedWriteSkill(this.skillDir(skill.id), skill);
			outcomes.push({ id: skill.id, action });
		}
		const config = await this.readMcpJson();
		const servers = config.mcpServers ?? {};
		servers[input.serverName] = {
			command: "npx",
			args: ["-y", "mcp-remote", input.url],
		};
		config.mcpServers = servers;
		await this.writeMcpJson(config);
		return outcomes;
	}

	async uninstall(input: { serverName: string }): Promise<void> {
		for (const id of BUNDLED_SKILL_IDS) {
			await rm(this.skillDir(id), { recursive: true, force: true });
		}
		const raw = await tryReadFile(this.mcpPath());
		if (raw === null) return;
		let config: McpJson;
		try {
			config = JSON.parse(raw) as McpJson;
		} catch {
			// Malformed config — nothing we can safely deregister. Leave it alone.
			return;
		}
		if (config.mcpServers) {
			delete config.mcpServers[input.serverName];
			await this.writeMcpJson(config);
		}
	}

	/**
	 * Read and parse the existing mcp.json. A missing file yields an empty config.
	 * A malformed file is backed up (so we never silently clobber a hand-edited
	 * config we couldn't understand) and treated as empty.
	 */
	private async readMcpJson(): Promise<McpJson> {
		const path = this.mcpPath();
		const raw = await tryReadFile(path);
		if (raw === null) return {};
		try {
			return JSON.parse(raw) as McpJson;
		} catch {
			await rename(path, await nextBackupPath(path));
			return {};
		}
	}

	private async writeMcpJson(config: McpJson): Promise<void> {
		const path = this.mcpPath();
		await mkdir(this.deps.configDir, { recursive: true });
		const tmp = `${path}.ai-14all.tmp`;
		await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
		await rename(tmp, path);
	}
}

async function tryReadFile(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf-8");
	} catch (err) {
		if ((err as { code?: string }).code === "ENOENT") return null;
		throw err;
	}
}

/** `<path>.bak`, or `<path>.bak.2`, `.bak.3`… if earlier backups exist. */
async function nextBackupPath(path: string): Promise<string> {
	const first = `${path}.bak`;
	if ((await tryReadFile(first)) === null) return first;
	for (let n = 2; ; n++) {
		const candidate = `${path}.bak.${n}`;
		if ((await tryReadFile(candidate)) === null) return candidate;
	}
}
