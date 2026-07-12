/**
 * E2E tests for AgentSkillInstaller.
 *
 * Historical note: this file was skipped for a Playwright+Electron preload
 * timing issue (`window.ai14all` not yet exposed at firstWindow()). The
 * active suites solved it with an explicit waitForFunction guard after
 * firstWindow() — see tests/e2e/review-comments.test.ts — which this file
 * now uses too.
 */

import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
	mkdirSync,
	readFileSync,
	existsSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

// ---------------------------------------------------------------------------
// Test 1: CLI-present — install succeeds and SKILL.md is written
// ---------------------------------------------------------------------------

test.describe.serial("AgentSkillInstaller — CLI-present path", () => {
	let app: ElectronApplication | undefined;
	let page: Page;
	let testRepo: TestRepo;
	let persistedStateDir: string;
	let persistedStatePath: string;
	let tempHomeDir: string;
	let shimDir: string;
	let shimLogFile: string;
	let userDataDir: string;

	test.beforeAll(async () => {
		testRepo = createTestRepo();
		persistedStateDir = realpathSync(
			mkdtempSync(join(tmpdir(), "ofa-agent-install-cli-present-")),
		);
		persistedStatePath = join(persistedStateDir, "workspace-state.json");

		// Temp HOME
		tempHomeDir = realpathSync(
			mkdtempSync(join(tmpdir(), "ofa-agent-install-home-")),
		);

		// Isolate userData: without this the app falls back to the real OS
		// user-data dir (electron/main/index.ts only calls app.setPath("userData",
		// ...) when AI14ALL_USER_DATA_PATH is set), which shares the developer's
		// live review-mcp port config and collides with a running instance.
		userDataDir = realpathSync(
			mkdtempSync(join(tmpdir(), "ofa-agent-install-cli-present-ud-")),
		);

		// Shim log file — shims append their args here
		shimLogFile = join(tempHomeDir, "shim-calls.log");
		writeFileSync(shimLogFile, "", "utf-8");

		// Shim dir on PATH
		shimDir = realpathSync(
			mkdtempSync(join(tmpdir(), "ofa-agent-install-shims-")),
		);

		// claude shim: record args, exit 0
		const claudeShim = join(shimDir, "claude");
		writeFileSync(
			claudeShim,
			`#!/bin/sh\necho "claude $*" >> "${shimLogFile}"\nexit 0\n`,
			{ mode: 0o755 },
		);

		// codex shim: record args, exit 0
		const codexShim = join(shimDir, "codex");
		writeFileSync(
			codexShim,
			`#!/bin/sh\necho "codex $*" >> "${shimLogFile}"\nexit 0\n`,
			{ mode: 0o755 },
		);

		// ai-ezio shim: detection looks for the `ai-ezio` binary on PATH. ezio
		// registration is a direct mcp.json file write (no CLI call), so this only
		// needs to exist for detection — it records args for completeness.
		const ezioShim = join(shimDir, "ai-ezio");
		writeFileSync(
			ezioShim,
			`#!/bin/sh\necho "ai-ezio $*" >> "${shimLogFile}"\nexit 0\n`,
			{ mode: 0o755 },
		);

		// Launch app with custom HOME and PATH. XDG_CONFIG_HOME is pinned inside the
		// temp HOME so ezio's config root (`$XDG_CONFIG_HOME/ai-ezio`) is contained
		// and deterministic regardless of the runner's environment.
		// args: ["."] (package mode) so app.getAppPath() = repo root: agentInstall's
		// dev-mode resourcesPath is join(appPath, "assets"); script-mode
		// "out/main/index.js" yields appPath = out/main, where no assets exist.
		app = await electron.launch({
			args: ["."],
			env: {
				...process.env,
				AI14ALL_E2E: "1",
				AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
				AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
				HOME: tempHomeDir,
				XDG_CONFIG_HOME: join(tempHomeDir, ".config"),
				PATH: `${shimDir}:${process.env.PATH ?? ""}`,
				AI14ALL_USER_DATA_PATH: userDataDir,
			},
		});
		page = await app.firstWindow({ timeout: 60_000 });
		await page.waitForFunction(() => "ai14all" in window, null, {
			timeout: 30_000,
		});
		page.setDefaultTimeout(60_000);

		// Navigate into workspace
		await page.getByRole("button", { name: "Browse" }).click();
		await page.getByRole("button", { name: "Load" }).click();
		const worktreeNav = page.getByRole("navigation", {
			name: "Worktree sessions",
		});
		await expect(
			worktreeNav.getByRole("button", { name: /feature-a/i }),
		).toBeVisible({ timeout: 15_000 });
	}, 90_000);

	test.afterAll(async () => {
		try {
			await closeApp(app);
		} finally {
			rmSync(persistedStateDir, { recursive: true, force: true });
			rmSync(tempHomeDir, { recursive: true, force: true });
			rmSync(shimDir, { recursive: true, force: true });
			rmSync(userDataDir, { recursive: true, force: true });
			testRepo?.cleanup();
		}
	});

	test("install succeeds and SKILL.md is written", async () => {
		test.setTimeout(120_000);

		// Call install via window.ai14all.agentInstall
		const { results } = await page.evaluate(async () => {
			const ai = (window as unknown as { ai14all: typeof window.ai14all })
				.ai14all;
			return ai.agentInstall.install(["claude-code", "codex", "ezio"]);
		});

		// All three providers should report ok: true
		const claudeResult = results.find(
			(r: { id: string; ok: boolean }) => r.id === "claude-code",
		);
		const codexResult = results.find(
			(r: { id: string; ok: boolean }) => r.id === "codex",
		);
		const ezioResult = results.find(
			(r: { id: string; ok: boolean }) => r.id === "ezio",
		);
		expect(claudeResult?.ok).toBe(true);
		expect(codexResult?.ok).toBe(true);
		expect(ezioResult?.ok).toBe(true);

		// SKILL.md written for claude
		const claudeSkillPath = join(
			tempHomeDir,
			".claude",
			"skills",
			"ai-14all-fix-review",
			"SKILL.md",
		);
		expect(existsSync(claudeSkillPath)).toBe(true);
		const claudeSkillContent = readFileSync(claudeSkillPath, "utf-8");
		expect(claudeSkillContent).toMatch(/^---\nname: ai-14all-fix-review/);

		// SKILL.md written for codex
		const codexSkillPath = join(
			tempHomeDir,
			".codex",
			"skills",
			"ai-14all-fix-review",
			"SKILL.md",
		);
		expect(existsSync(codexSkillPath)).toBe(true);
		const codexSkillContent = readFileSync(codexSkillPath, "utf-8");
		expect(codexSkillContent).toMatch(/^---\nname: ai-14all-fix-review/);

		// Shim log: verify claude CLI was called with the expected MCP args
		const shimLog = readFileSync(shimLogFile, "utf-8");
		expect(shimLog).toMatch(
			/claude mcp add --transport http --scope user ai-14all/,
		);

		// Shim log: verify codex CLI was called with --url
		expect(shimLog).toMatch(/codex mcp add --url .+ ai-14all/);

		// ezio: registration is a direct file write into its config root, not a CLI
		// call. SKILL.md is written under `$XDG_CONFIG_HOME/ai-ezio/skills/...`.
		const ezioConfigDir = join(tempHomeDir, ".config", "ai-ezio");
		const ezioSkillPath = join(
			ezioConfigDir,
			"skills",
			"ai-14all-fix-review",
			"SKILL.md",
		);
		expect(existsSync(ezioSkillPath)).toBe(true);
		expect(readFileSync(ezioSkillPath, "utf-8")).toMatch(
			/^---\nname: ai-14all-fix-review/,
		);

		// ezio mcp.json gains the stdio->HTTP mcp-remote bridge entry pointing at
		// ai-14all's MCP URL, since ezio's host can't consume the HTTP URL directly.
		const ezioMcp = JSON.parse(
			readFileSync(join(ezioConfigDir, "mcp.json"), "utf-8"),
		);
		expect(ezioMcp.mcpServers["ai-14all"].command).toBe("npx");
		expect(ezioMcp.mcpServers["ai-14all"].args).toEqual([
			"-y",
			"mcp-remote",
			expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
		]);
	});
});

// ---------------------------------------------------------------------------
// Version-guard statuses — skipped-newer / up-to-date paths (spec §5.6)
// ---------------------------------------------------------------------------

test.describe.serial("AgentSkillInstaller — version-guard statuses", () => {
	let app: ElectronApplication | undefined;
	let page: Page;
	let testRepo: TestRepo;
	let persistedStateDir: string;
	let persistedStatePath: string;
	let tempHomeDir: string;
	let shimDir: string;
	let userDataDir: string;

	const SKILL_IDS = ["ai-14all-fix-review", "ai-14all-session-status"] as const;

	function installedSkillPath(id: string): string {
		return join(tempHomeDir, ".claude", "skills", id, "SKILL.md");
	}

	// Dev-mode resourcesPath is `<appPath>/assets`, so the repo's own assets
	// are the bundled skills the app serves in this test.
	function bundledSkillContent(id: string): string {
		return readFileSync(
			join("assets", "agent-skills", id, "SKILL.md"),
			"utf-8",
		);
	}

	function seedInstalled(id: string, content: string): void {
		mkdirSync(join(tempHomeDir, ".claude", "skills", id), { recursive: true });
		writeFileSync(installedSkillPath(id), content, "utf-8");
	}

	test.beforeAll(async () => {
		testRepo = createTestRepo();
		persistedStateDir = realpathSync(
			mkdtempSync(join(tmpdir(), "ofa-agent-install-guard-")),
		);
		persistedStatePath = join(persistedStateDir, "workspace-state.json");
		tempHomeDir = realpathSync(
			mkdtempSync(join(tmpdir(), "ofa-agent-install-guard-home-")),
		);
		shimDir = realpathSync(
			mkdtempSync(join(tmpdir(), "ofa-agent-install-guard-shims-")),
		);
		userDataDir = realpathSync(
			mkdtempSync(join(tmpdir(), "ofa-agent-install-guard-ud-")),
		);
		writeFileSync(join(shimDir, "claude"), "#!/bin/sh\nexit 0\n", {
			mode: 0o755,
		});

		// args: ["."] (package mode) so app.getAppPath() = repo root: agentInstall's
		// dev-mode resourcesPath is join(appPath, "assets"); script-mode
		// "out/main/index.js" yields appPath = out/main, where no assets exist.
		app = await electron.launch({
			args: ["."],
			env: {
				...process.env,
				AI14ALL_E2E: "1",
				AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
				AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
				HOME: tempHomeDir,
				XDG_CONFIG_HOME: join(tempHomeDir, ".config"),
				PATH: `${shimDir}:${process.env.PATH ?? ""}`,
				AI14ALL_USER_DATA_PATH: userDataDir,
			},
		});
		page = await app.firstWindow({ timeout: 60_000 });
		await page.waitForFunction(() => "ai14all" in window, null, {
			timeout: 30_000,
		});
		page.setDefaultTimeout(60_000);

		await page.getByRole("button", { name: "Browse" }).click();
		await page.getByRole("button", { name: "Load" }).click();
		const worktreeNav = page.getByRole("navigation", {
			name: "Worktree sessions",
		});
		await expect(
			worktreeNav.getByRole("button", { name: /feature-a/i }),
		).toBeVisible({ timeout: 15_000 });
	}, 90_000);

	test.afterAll(async () => {
		try {
			await closeApp(app);
		} finally {
			rmSync(persistedStateDir, { recursive: true, force: true });
			rmSync(tempHomeDir, { recursive: true, force: true });
			rmSync(shimDir, { recursive: true, force: true });
			rmSync(userDataDir, { recursive: true, force: true });
			testRepo?.cleanup();
		}
	});

	test("skips a newer installed version and leaves it byte-untouched", async () => {
		test.setTimeout(120_000);
		const newerContent =
			"---\nname: guard-test\nversion: 9.9.9\n---\n\nlocally newer body\n";
		for (const id of SKILL_IDS) seedInstalled(id, newerContent);

		const { results } = await page.evaluate(async () => {
			const ai = (window as unknown as { ai14all: typeof window.ai14all })
				.ai14all;
			return ai.agentInstall.install(["claude-code"]);
		});
		const claude = results.find(
			(r: { id: string }) => r.id === "claude-code",
		) as { ok: boolean; message: string | null };
		expect(claude.ok).toBe(true);
		expect(claude.message).toMatch(/skipped — newer version installed/);
		for (const id of SKILL_IDS) {
			expect(readFileSync(installedSkillPath(id), "utf-8")).toBe(newerContent);
		}
	});

	test("reports Already up to date on equal versions with zero writes", async () => {
		test.setTimeout(120_000);
		for (const id of SKILL_IDS) seedInstalled(id, bundledSkillContent(id));
		const mtimesBefore = SKILL_IDS.map(
			(id) => statSync(installedSkillPath(id)).mtimeMs,
		);

		const { results } = await page.evaluate(async () => {
			const ai = (window as unknown as { ai14all: typeof window.ai14all })
				.ai14all;
			return ai.agentInstall.install(["claude-code"]);
		});
		const claude = results.find(
			(r: { id: string }) => r.id === "claude-code",
		) as { ok: boolean; message: string | null };
		expect(claude.ok).toBe(true);
		expect(claude.message).toBe("Already up to date");
		SKILL_IDS.forEach((id, i) => {
			expect(readFileSync(installedSkillPath(id), "utf-8")).toBe(
				bundledSkillContent(id),
			);
			// Zero writes: mtime unchanged, not merely identical bytes.
			expect(statSync(installedSkillPath(id)).mtimeMs).toBe(mtimesBefore[i]);
		});
	});

	test("install modal shows the up-to-date status instead of Installed", async () => {
		test.setTimeout(120_000);
		// Installed copies still equal the bundled versions from the previous test.
		await app!.evaluate(({ BrowserWindow }) => {
			BrowserWindow.getAllWindows()[0]?.webContents.send(
				"review:openInstallModal",
			);
		});
		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByText("Connect your coding agents to ai-14all"),
		).toBeVisible();
		await dialog.getByRole("checkbox").first().check();
		await dialog.getByRole("button", { name: "Install" }).click();
		await expect(dialog.getByText("Already up to date")).toBeVisible();
		await expect(dialog.getByText(/^Installed/)).not.toBeVisible();
	});
});

// ---------------------------------------------------------------------------
// Test 2: CLI-absent — checkboxes disabled, nothing written
// ---------------------------------------------------------------------------

test.describe.serial("AgentSkillInstaller — CLI-absent path", () => {
	let app: ElectronApplication | undefined;
	let page: Page;
	let testRepo: TestRepo;
	let persistedStateDir: string;
	let persistedStatePath: string;
	let tempHomeDir: string;
	/** PATH that contains neither claude nor codex */
	let strippedPath: string;
	/** Original content seeded into ~/.claude.json */
	let seededClaudeJson: string;
	let userDataDir: string;

	test.beforeAll(async () => {
		testRepo = createTestRepo();
		persistedStateDir = realpathSync(
			mkdtempSync(join(tmpdir(), "ofa-agent-install-cli-absent-")),
		);
		persistedStatePath = join(persistedStateDir, "workspace-state.json");

		// Temp HOME — seed config roots without CLI
		tempHomeDir = realpathSync(
			mkdtempSync(join(tmpdir(), "ofa-agent-install-home2-")),
		);

		// Isolate userData: without this the app falls back to the real OS
		// user-data dir (electron/main/index.ts only calls app.setPath("userData",
		// ...) when AI14ALL_USER_DATA_PATH is set), which shares the developer's
		// live review-mcp port config and collides with a running instance.
		userDataDir = realpathSync(
			mkdtempSync(join(tmpdir(), "ofa-agent-install-cli-absent-ud-")),
		);

		// ~/.claude.json — configRootDetected for ClaudeProvider
		seededClaudeJson = JSON.stringify({ oauth: { token: "secret" } });
		writeFileSync(join(tempHomeDir, ".claude.json"), seededClaudeJson, "utf-8");

		// ~/.codex/ — configRootDetected for CodexProvider
		mkdirSync(join(tempHomeDir, ".codex"), { recursive: true });

		// $XDG_CONFIG_HOME/ai-ezio/ — configRootDetected for EzioProvider
		mkdirSync(join(tempHomeDir, ".config", "ai-ezio"), { recursive: true });

		// Strip claude + codex + ezio from PATH. Matching on the directory path
		// string alone is not enough: shared bin dirs (e.g. /opt/homebrew/bin)
		// contain the real binaries without "claude"/"codex"/"ezio" in their
		// path, so also drop any dir that actually contains one of the CLIs.
		strippedPath = (process.env.PATH ?? "")
			.split(":")
			.filter(
				(p) =>
					!p.includes("claude") &&
					!p.includes("codex") &&
					!p.includes("ezio") &&
					!existsSync(join(p, "claude")) &&
					!existsSync(join(p, "codex")) &&
					!existsSync(join(p, "ai-ezio")),
			)
			.join(":");

		// Launch app.
		// args: ["."] (package mode) so app.getAppPath() = repo root: agentInstall's
		// dev-mode resourcesPath is join(appPath, "assets"); script-mode
		// "out/main/index.js" yields appPath = out/main, where no assets exist.
		app = await electron.launch({
			args: ["."],
			env: {
				...process.env,
				AI14ALL_E2E: "1",
				AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
				AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
				HOME: tempHomeDir,
				XDG_CONFIG_HOME: join(tempHomeDir, ".config"),
				PATH: strippedPath,
				AI14ALL_USER_DATA_PATH: userDataDir,
			},
		});
		page = await app.firstWindow({ timeout: 60_000 });
		await page.waitForFunction(() => "ai14all" in window, null, {
			timeout: 30_000,
		});
		page.setDefaultTimeout(60_000);

		// Navigate into workspace
		await page.getByRole("button", { name: "Browse" }).click();
		await page.getByRole("button", { name: "Load" }).click();
		const worktreeNav = page.getByRole("navigation", {
			name: "Worktree sessions",
		});
		await expect(
			worktreeNav.getByRole("button", { name: /feature-a/i }),
		).toBeVisible({ timeout: 15_000 });
	}, 90_000);

	test.afterAll(async () => {
		try {
			await closeApp(app);
		} finally {
			rmSync(persistedStateDir, { recursive: true, force: true });
			rmSync(tempHomeDir, { recursive: true, force: true });
			rmSync(userDataDir, { recursive: true, force: true });
			testRepo?.cleanup();
		}
	});

	test("listProviders reports CLI unavailable, configRoot detected", async () => {
		test.setTimeout(60_000);

		const { providers } = await page.evaluate(async () => {
			const ai = (window as unknown as { ai14all: typeof window.ai14all })
				.ai14all;
			return ai.agentInstall.listProviders();
		});

		const claude = providers.find(
			(p: { id: string }) => p.id === "claude-code",
		);
		const codex = providers.find((p: { id: string }) => p.id === "codex");
		const ezio = providers.find((p: { id: string }) => p.id === "ezio");

		// CLI not on PATH — all unavailable
		expect(claude?.cliAvailable).toBe(false);
		expect(codex?.cliAvailable).toBe(false);
		expect(ezio?.cliAvailable).toBe(false);

		// Config roots exist via seeded files/dirs
		expect(claude?.configRootDetected).toBe(true);
		expect(codex?.configRootDetected).toBe(true);
		expect(ezio?.configRootDetected).toBe(true);
	});

	test("install fails with 'not available' and writes nothing", async () => {
		test.setTimeout(60_000);

		const { results } = await page.evaluate(async () => {
			const ai = (window as unknown as { ai14all: typeof window.ai14all })
				.ai14all;
			return ai.agentInstall.install(["claude-code"]);
		});

		// Install should fail — CLI not available
		const claudeResult = results.find(
			(r: { id: string; ok: boolean; message: string | null }) =>
				r.id === "claude-code",
		);
		expect(claudeResult?.ok).toBe(false);
		expect(claudeResult?.message).toMatch(/not available/i);

		// ~/.claude.json must be byte-identical to seeded content
		const actualClaudeJson = readFileSync(
			join(tempHomeDir, ".claude.json"),
			"utf-8",
		);
		expect(actualClaudeJson).toBe(seededClaudeJson);

		// ~/.codex/config.toml must NOT exist
		expect(existsSync(join(tempHomeDir, ".codex", "config.toml"))).toBe(false);
	});

	test.skip("installs claude-code via override path picked from file dialog", async () => {
		// Harness currently broken — see top-of-file skip reason.
		// When unblocked:
		// 1. Build a fixture binary: `#!/bin/sh\necho "$@" >> "$AI14ALL_TEST_LOG"\n`
		//    chmod +x, place under tmpdir.
		// 2. Stub dialog.showOpenDialog via ElectronApplication.evaluate:
		//    `dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })`
		// 3. Open install modal, click "Locate Claude Code CLI…", confirm row flips
		//    to "CLI detected (override: …)", check box, click Install.
		// 4. Assert AI14ALL_TEST_LOG contains "mcp add --transport http --scope user
		//    ai-14all <url>".
	});

	test.skip("opens install modal from sidebar CTA when no provider is installed", async () => {
		// Harness currently broken — see top-of-file skip reason.
		// When unblocked:
		// 1. Launch app fresh (no SKILL.md persisted).
		// 2. Open a worktree with the review overlay.
		// 3. Assert data-testid="agent-install-cta" is visible in the comment sidebar.
		// 4. Click the CTA Install… button; assert install modal becomes visible.
	});
});

test.skip("AgentInstallModal closes on Escape", async () => {
	// Pending Playwright/Electron preload harness fix.
	// Intent: open install modal via menu, press Escape, assert modal not visible.
});

test.skip("AgentInstallModal closes on overlay click", async () => {
	// Pending harness fix.
	// Intent: open install modal, click .shell-app-dialog__overlay, assert modal not visible.
});

test.skip("AgentInstallModal restores focus on close", async () => {
	// Pending harness fix.
	// Intent: open via menu (focus on menu trigger), close via Escape, assert
	// trigger receives focus again.
});

test.skip("NewWorktreeDialog closes on Escape", async () => {
	// Pending harness fix.
	// Intent: open new-session dialog from sidebar, press Escape, assert dialog
	// not visible and underlying app remains interactive.
});
