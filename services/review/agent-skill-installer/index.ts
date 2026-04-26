import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { ClaudeProvider } from "./claude-provider.js";
import { CodexProvider } from "./codex-provider.js";
import { loadBundledSkill } from "./skill-asset.js";
import type { ProviderId } from "../../../shared/contracts/agent-install.js";

const exec = promisify(execFile);

async function isOnPath(cmd: string): Promise<boolean> {
	try {
		await exec(process.platform === "win32" ? "where" : "which", [cmd]);
		return true;
	} catch {
		return false;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export type ProviderRow = {
	id: ProviderId;
	displayName: string;
	cliAvailable: boolean;
	configRootDetected: boolean;
	installed: boolean;
};

type Deps = {
	home: string;
	resourcesPath: string;
	getMcpUrl: () => string | null;
};

export class AgentSkillInstaller {
	constructor(private readonly deps: Deps) {}

	async listProviders(): Promise<ProviderRow[]> {
		const home = this.deps.home;
		const claudeCli = await isOnPath("claude");
		const codexCli = await isOnPath("codex");
		const claudeRoot =
			(await exists(join(home, ".claude"))) ||
			(await exists(join(home, ".claude.json")));
		const codexRoot = await exists(join(home, ".codex"));
		const claudeInstalled = await exists(
			join(home, ".claude", "skills", "ai-14all-fix-review", "SKILL.md"),
		);
		const codexInstalled = await exists(
			join(home, ".codex", "skills", "ai-14all-fix-review", "SKILL.md"),
		);
		return [
			{
				id: "claude-code",
				displayName: "Claude Code",
				cliAvailable: claudeCli,
				configRootDetected: claudeRoot,
				installed: claudeInstalled,
			},
			{
				id: "codex",
				displayName: "Codex",
				cliAvailable: codexCli,
				configRootDetected: codexRoot,
				installed: codexInstalled,
			},
		];
	}

	async install(ids: ProviderId[]) {
		const url = this.deps.getMcpUrl();
		if (!url) {
			return ids.map((id) => ({
				id,
				ok: false,
				message: "MCP server is not running",
			}));
		}
		const skill = await loadBundledSkill(this.deps.resourcesPath);
		const results = [];
		for (const id of ids) {
			try {
				if (id === "claude-code") {
					const p = new ClaudeProvider({
						home: this.deps.home,
						cliPath: "claude",
						isCliAvailable: () => isOnPath("claude"),
					});
					await p.install({ serverName: "ai-14all", url, skill });
					results.push({ id, ok: true, message: null });
				} else if (id === "codex") {
					const p = new CodexProvider({
						home: this.deps.home,
						cliPath: "codex",
						isCliAvailable: () => isOnPath("codex"),
					});
					await p.install({ serverName: "ai-14all", url, skill });
					results.push({ id, ok: true, message: null });
				}
			} catch (e) {
				results.push({ id, ok: false, message: (e as Error).message });
			}
		}
		return results;
	}

	async uninstall(ids: ProviderId[]) {
		const results = [];
		for (const id of ids) {
			try {
				if (id === "claude-code") {
					const p = new ClaudeProvider({
						home: this.deps.home,
						cliPath: "claude",
						isCliAvailable: () => isOnPath("claude"),
					});
					await p.uninstall({ serverName: "ai-14all" });
				} else if (id === "codex") {
					const p = new CodexProvider({
						home: this.deps.home,
						cliPath: "codex",
						isCliAvailable: () => isOnPath("codex"),
					});
					await p.uninstall({ serverName: "ai-14all" });
				}
				results.push({ id, ok: true, message: null });
			} catch (e) {
				results.push({ id, ok: false, message: (e as Error).message });
			}
		}
		return results;
	}
}
