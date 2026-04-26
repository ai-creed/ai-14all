/**
 * E2E tests for AgentSkillInstaller (Task 32).
 *
 * SKIP REASON: All E2E tests in this project currently fail because
 * `window.ai14all` (injected via contextBridge in the Electron preload) is
 * never defined when Playwright launches the app. Root-cause analysis shows
 * that Playwright 1.59's loader.js patches `app.whenReady` / `app.emit` and
 * inserts itself via `-r loader` before `out/main/index.js`. This interacts
 * with Electron 41's sandboxed-preload execution: the preload runs but
 * `contextBridge.exposeInMainWorld` does not surface `window.ai14all` in the
 * renderer's main execution context. The same failure is reproduced by running
 * `review-drawer.test.ts` and `review-comments.test.ts` on this machine.
 *
 * Resolution path: investigate the Playwright+Electron preload timing issue
 * (possibly upgrade Playwright or adjust `sandbox`/`contextIsolation` flags)
 * before enabling these tests.
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
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

// ---------------------------------------------------------------------------
// Test 1: CLI-present — install succeeds and SKILL.md is written
// ---------------------------------------------------------------------------

test.describe.serial("AgentSkillInstaller — CLI-present path", () => {
	test.skip(
		true,
		"requires E2E environment — unskip when Playwright/Electron compat is resolved",
	);

	let app: ElectronApplication | undefined;
	let page: Page;
	let testRepo: TestRepo;
	let persistedStateDir: string;
	let persistedStatePath: string;
	let tempHomeDir: string;
	let shimDir: string;
	let shimLogFile: string;

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

		// Launch app with custom HOME and PATH
		app = await electron.launch({
			args: ["out/main/index.js"],
			env: {
				...process.env,
				AI14ALL_E2E: "1",
				AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
				AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
				HOME: tempHomeDir,
				PATH: `${shimDir}:${process.env.PATH ?? ""}`,
			},
		});
		page = await app.firstWindow({ timeout: 60_000 });
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
			testRepo?.cleanup();
		}
	});

	test("install succeeds and SKILL.md is written", async () => {
		test.setTimeout(120_000);

		// Call install via window.ai14all.agentInstall
		const results = await page.evaluate(async () => {
			const ai = (window as unknown as { ai14all: typeof window.ai14all }).ai14all;
			return ai.agentInstall.install(["claude-code", "codex"]);
		});

		// Both providers should report ok: true
		const claudeResult = results.find(
			(r: { id: string; ok: boolean }) => r.id === "claude-code",
		);
		const codexResult = results.find(
			(r: { id: string; ok: boolean }) => r.id === "codex",
		);
		expect(claudeResult?.ok).toBe(true);
		expect(codexResult?.ok).toBe(true);

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
		expect(shimLog).toMatch(/claude mcp add --transport http --scope user ai-14all/);

		// Shim log: verify codex CLI was called with --url
		expect(shimLog).toMatch(/codex mcp add --url .+ ai-14all/);
	});
});

// ---------------------------------------------------------------------------
// Test 2: CLI-absent — checkboxes disabled, nothing written
// ---------------------------------------------------------------------------

test.describe.serial("AgentSkillInstaller — CLI-absent path", () => {
	test.skip(
		true,
		"requires E2E environment — unskip when Playwright/Electron compat is resolved",
	);

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

		// ~/.claude.json — configRootDetected for ClaudeProvider
		seededClaudeJson = JSON.stringify({ oauth: { token: "secret" } });
		writeFileSync(join(tempHomeDir, ".claude.json"), seededClaudeJson, "utf-8");

		// ~/.codex/ — configRootDetected for CodexProvider
		mkdirSync(join(tempHomeDir, ".codex"), { recursive: true });

		// Strip claude + codex from PATH (keep only system dirs that won't have them)
		strippedPath = (process.env.PATH ?? "")
			.split(":")
			.filter((p) => !p.includes("claude") && !p.includes("codex"))
			.join(":");

		// Launch app
		app = await electron.launch({
			args: ["out/main/index.js"],
			env: {
				...process.env,
				AI14ALL_E2E: "1",
				AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
				AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
				HOME: tempHomeDir,
				PATH: strippedPath,
			},
		});
		page = await app.firstWindow({ timeout: 60_000 });
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
			testRepo?.cleanup();
		}
	});

	test("listProviders reports CLI unavailable, configRoot detected", async () => {
		test.setTimeout(60_000);

		const providers = await page.evaluate(async () => {
			const ai = (window as unknown as { ai14all: typeof window.ai14all }).ai14all;
			return ai.agentInstall.listProviders();
		});

		const claude = providers.find(
			(p: { id: string }) => p.id === "claude-code",
		);
		const codex = providers.find(
			(p: { id: string }) => p.id === "codex",
		);

		// CLI not on PATH — both unavailable
		expect(claude?.cliAvailable).toBe(false);
		expect(codex?.cliAvailable).toBe(false);

		// Config roots exist via seeded files/dirs
		expect(claude?.configRootDetected).toBe(true);
		expect(codex?.configRootDetected).toBe(true);
	});

	test("install fails with 'not available' and writes nothing", async () => {
		test.setTimeout(60_000);

		const results = await page.evaluate(async () => {
			const ai = (window as unknown as { ai14all: typeof window.ai14all }).ai14all;
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
});
