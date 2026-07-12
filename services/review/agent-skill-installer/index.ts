import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { ClaudeProvider } from "./claude-provider.js";
import { CodexProvider } from "./codex-provider.js";
import { EzioProvider } from "./ezio-provider.js";
import { CliOverrideStore } from "./cli-override-store.js";
import {
	detectCliPath,
	type CliCmd,
	type CliSource,
	type Detection,
} from "./cli-detection.js";
import { loadBundledSkills, REVIEW_SKILL_ID } from "./skill-asset.js";
import {
	composeInstallMessage,
	type SkillInstallOutcome,
} from "./skill-version.js";
import type { ProviderId } from "../../../shared/contracts/agent-install.js";

const exec = promisify(execFile);

async function fileExists(path: string): Promise<boolean> {
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
	cliPath: string | null;
	cliSource: CliSource | "none";
};

type Deps = {
	home: string;
	resourcesPath: string;
	userDataPath: string;
	getMcpUrl: () => string | null;
	/** Override `fs.access` for testing; defaults to the real implementation. */
	_access?: (path: string) => Promise<void>;
};

const PROVIDER_CMD: Record<ProviderId, CliCmd> = {
	"claude-code": "claude",
	codex: "codex",
	ezio: "ai-ezio",
};

const DISPLAY_NAME: Record<ProviderId, string> = {
	"claude-code": "Claude Code",
	codex: "Codex",
	ezio: "ezio",
};

/**
 * ezio's config root: `${XDG_CONFIG_HOME:-<home>/.config}/ai-ezio`. This is
 * where its skills (`skills/`) and MCP registry (`mcp.json`) live, mirroring
 * the README's `Configuring MCP servers` location.
 */
function ezioConfigDir(home: string): string {
	const base = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
	return join(base, "ai-ezio");
}

export class AgentSkillInstaller {
	private readonly overrideStore: CliOverrideStore;

	constructor(private readonly deps: Deps) {
		this.overrideStore = new CliOverrideStore(
			join(deps.userDataPath, "ai-14all", "cli-overrides.json"),
		);
	}

	private async detect(
		id: ProviderId,
		override: string | null,
	): Promise<Detection> {
		const accessFn = this.deps._access ?? access;
		return detectCliPath(PROVIDER_CMD[id], {
			home: this.deps.home,
			platform: process.platform,
			shell: process.env.SHELL,
			override,
			exec: async (file, args, opts) => {
				const r = await exec(file, args, opts);
				return { stdout: typeof r.stdout === "string" ? r.stdout : "" };
			},
			access: accessFn,
			// E2E isolation: restrict detection to the caller-controlled PATH so
			// stripped-PATH tests can't find (and exec) real CLIs installed at
			// fixed absolute paths on the host. See DetectDeps.pathOnly.
			pathOnly: process.env.AI14ALL_E2E === "1",
		});
	}

	async listProviders() {
		const overrides = await this.overrideStore.load();
		const home = this.deps.home;

		const claudeOverride = overrides["claude-code"] ?? null;
		const codexOverride = overrides.codex ?? null;
		const ezioOverride = overrides.ezio ?? null;
		const claudeDetection = await this.detect("claude-code", claudeOverride);
		const codexDetection = await this.detect("codex", codexOverride);
		const ezioDetection = await this.detect("ezio", ezioOverride);

		const ezioCfg = ezioConfigDir(home);
		const claudeRoot =
			(await fileExists(join(home, ".claude"))) ||
			(await fileExists(join(home, ".claude.json")));
		const codexRoot = await fileExists(join(home, ".codex"));
		const ezioRoot = await fileExists(ezioCfg);
		const claudeInstalled = await fileExists(
			join(home, ".claude", "skills", REVIEW_SKILL_ID, "SKILL.md"),
		);
		const codexInstalled = await fileExists(
			join(home, ".codex", "skills", REVIEW_SKILL_ID, "SKILL.md"),
		);
		const ezioInstalled = await fileExists(
			join(ezioCfg, "skills", REVIEW_SKILL_ID, "SKILL.md"),
		);

		const row = (
			id: ProviderId,
			detection: Detection,
			rootDetected: boolean,
			installed: boolean,
		): ProviderRow => ({
			id,
			displayName: DISPLAY_NAME[id],
			cliAvailable: detection !== null,
			configRootDetected: rootDetected,
			installed,
			cliPath: detection?.cliPath ?? null,
			cliSource: detection?.source ?? "none",
		});

		return {
			providers: [
				row("claude-code", claudeDetection, claudeRoot, claudeInstalled),
				row("codex", codexDetection, codexRoot, codexInstalled),
				row("ezio", ezioDetection, ezioRoot, ezioInstalled),
			] as ProviderRow[],
		};
	}

	async setOverride(id: ProviderId, path: string | null) {
		if (path !== null) {
			let info: Awaited<ReturnType<typeof stat>>;
			try {
				info = await stat(path);
			} catch {
				throw new Error(`Path does not exist: ${path}`);
			}
			if (!info.isFile()) {
				throw new Error(`Path is not a regular file: ${path}`);
			}
		}
		await this.overrideStore.set(id, path);
		// The subsequent listProviders() call re-runs detectCliPath which checks
		// file existence again. If the file was deleted between stat() above and
		// detectCliPath's access() below, the override is persisted but reports
		// cliAvailable:false — a dangling pointer. The next listProviders() call
		// will reflect the correct state, and install() will fall through detection
		// tiers as designed. No corrective action needed here.
		return this.listProviders();
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
		const overrides = await this.overrideStore.load();
		const results: Array<{
			id: ProviderId;
			ok: boolean;
			message: string | null;
		}> = [];
		for (const id of ids) {
			try {
				const override = overrides[id] ?? null;
				const detection = await this.detect(id, override);
				// Fail fast before loading the bundled skill if CLI is unavailable.
				// ClaudeProvider/CodexProvider also check this, but checking early
				// avoids an unnecessary disk read and surfaces the clearest error.
				if (detection === null) {
					const name = DISPLAY_NAME[id];
					const cmd = PROVIDER_CMD[id];
					throw new Error(
						`${cmd} CLI is not available; install ${name} or set a CLI path override.`,
					);
				}
				const cliPath = detection.cliPath; // safe: null guard throws above
				const isCliAvailable = async () => detection !== null;
				const skills = await loadBundledSkills(this.deps.resourcesPath);
				let outcomes: SkillInstallOutcome[] = [];
				if (id === "claude-code") {
					const p = new ClaudeProvider({
						home: this.deps.home,
						cliPath,
						isCliAvailable,
					});
					outcomes = await p.installSkills({
						serverName: "ai-14all",
						url,
						skills,
					});
				} else if (id === "codex") {
					const p = new CodexProvider({
						home: this.deps.home,
						cliPath,
						isCliAvailable,
					});
					outcomes = await p.installSkills({
						serverName: "ai-14all",
						url,
						skills,
					});
				} else if (id === "ezio") {
					const p = new EzioProvider({
						configDir: ezioConfigDir(this.deps.home),
						isCliAvailable,
					});
					outcomes = await p.installSkills({
						serverName: "ai-14all",
						url,
						skills,
					});
				}
				results.push({
					id,
					ok: true,
					message: composeInstallMessage(outcomes),
				});
			} catch (e) {
				results.push({ id, ok: false, message: (e as Error).message });
			}
		}
		return results;
	}

	async uninstall(ids: ProviderId[]) {
		const overrides = await this.overrideStore.load();
		const results: Array<{
			id: ProviderId;
			ok: boolean;
			message: string | null;
		}> = [];
		for (const id of ids) {
			try {
				const override = overrides[id] ?? null;
				const detection = await this.detect(id, override);
				// Always attempt local skill removal regardless of CLI availability.
				// Providers remove the skill directory first, then optionally run
				// `mcp remove` only when isCliAvailable() returns true. Gating on
				// detection here would prevent users from cleaning up after moving or
				// deleting their CLI.
				const cliPath = detection?.cliPath ?? PROVIDER_CMD[id];
				const isCliAvailable = async () => detection !== null;
				if (id === "claude-code") {
					const p = new ClaudeProvider({
						home: this.deps.home,
						cliPath,
						isCliAvailable,
					});
					await p.uninstall({ serverName: "ai-14all" });
				} else if (id === "codex") {
					const p = new CodexProvider({
						home: this.deps.home,
						cliPath,
						isCliAvailable,
					});
					await p.uninstall({ serverName: "ai-14all" });
				} else if (id === "ezio") {
					const p = new EzioProvider({
						configDir: ezioConfigDir(this.deps.home),
						isCliAvailable,
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
