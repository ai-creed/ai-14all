import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	chmodSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

// ---------------------------------------------------------------------------
// Stub set-up
// ---------------------------------------------------------------------------

/**
 * Creates two stub binaries in a temp dir:
 * - `ai-cortex`: `--version` prints "ai-cortex 0.15.1" so the cortex probe
 *   resolves to installed. The plugin's `install_path` (config.toml) points the
 *   resolver straight at this binary, so no PATH manipulation is needed.
 * - `noop-shell`: a shell stand-in that swallows stdin and stays alive. It is
 *   set as `SHELL`, so when the Configure action opens a terminal and injects
 *   the wiring command, the PTY launches (the launch is what we assert) but the
 *   command is NOT executed — keeping the test hermetic (no real `ai-cortex` /
 *   `claude` / `codex` invocations on the host). Whether a real shell would run
 *   the command is the shell's responsibility, not this app's; the exact command
 *   string is asserted separately via `window.__lastPluginCommand`.
 *
 * Agent-CLI detection is driven deterministically by AI14ALL_FAKE_AGENT_CLIS,
 * so no claude/codex binaries are required.
 */
function setUpStubs(): {
	binDir: string;
	cortexBinPath: string;
	noopShellPath: string;
} {
	const binDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-cortex-bin-")));
	const write = (name: string, body: string): string => {
		const p = join(binDir, name);
		writeFileSync(p, body, "utf8");
		chmodSync(p, 0o755);
		return p;
	};
	const cortexBinPath = write(
		"ai-cortex",
		["#!/bin/sh", "echo 'ai-cortex 0.15.1'", "exit 0"].join("\n") + "\n",
	);
	// terminal-service spawns `[SHELL, "-l"]`; this stub ignores its args and
	// discards stdin so the injected command never runs.
	const noopShellPath = write(
		"noop-shell",
		["#!/bin/sh", "exec cat >/dev/null"].join("\n") + "\n",
	);
	return { binDir, cortexBinPath, noopShellPath };
}

function setUpCortexUserData(options: {
	enabled: boolean;
	cortexBinPath: string;
}): { userDataDir: string } {
	const userDataDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-cortex-ud-")),
	);
	writeFileSync(
		join(userDataDir, "config.toml"),
		[
			"[plugins.cortex]",
			`enabled = ${options.enabled}`,
			`install_path = "${options.cortexBinPath}"`,
		].join("\n") + "\n",
		"utf8",
	);
	return { userDataDir };
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let app: ElectronApplication | undefined;
let page: Page;
let repo: TestRepo;
let userDataDir: string;
let binDir: string;

function worktreeNav() {
	return page.getByRole("navigation", { name: "Worktree sessions" });
}

/** Load the test repo and select the feature-a worktree so the session mounts. */
async function loadRepoAndSelectWorktree(): Promise<void> {
	await page.locator("#repo-path").fill(repo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		worktreeNav().getByRole("button", { name: /feature-a/i }),
	).toBeVisible({ timeout: 15_000 });
	await worktreeNav()
		.getByRole("button", { name: /feature-a/i })
		.click();
	await expect(page.getByRole("region", { name: "Session" })).toBeVisible({
		timeout: 15_000,
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe.serial("cortex plugin (stub binary)", () => {
	test.beforeEach(async () => {
		repo = createTestRepo();
		const stubs = setUpStubs();
		binDir = stubs.binDir;
		const userData = setUpCortexUserData({
			enabled: false,
			cortexBinPath: stubs.cortexBinPath,
		});
		userDataDir = userData.userDataDir;

		app = await electron.launch({
			args: ["out/main/index.js"],
			env: {
				...process.env,
				AI14ALL_E2E: "1",
				AI14ALL_FAKE_AGENT_CLIS: "claude,codex",
				AI14ALL_USER_DATA_PATH: userDataDir,
				// No-op shell: Configure opens a terminal (the launch is asserted)
				// but the injected command is discarded — no real tool runs.
				SHELL: stubs.noopShellPath,
			},
		});
		page = await app.firstWindow({ timeout: 60_000 });
	});

	test.afterEach(async () => {
		await closeApp(app);
		app = undefined;
		rmSync(userDataDir, { recursive: true, force: true });
		rmSync(binDir, { recursive: true, force: true });
		repo.cleanup();
	});

	// (1) cortex card shows "installed, off" with version (probe via install_path)
	test("cortex plugin card shows installed-off chip with version", async () => {
		// The "Open Plugins panel" button lives in the session chip bar, which
		// only mounts once an active worktree session exists.
		await loadRepoAndSelectWorktree();

		await page.getByRole("button", { name: "Open Plugins panel" }).click();

		const card = page.locator('[data-plugin-id="cortex"]');
		await expect(card).toBeVisible({ timeout: 15_000 });
		await expect(card).toContainText("installed, off");
		await expect(card).toContainText("0.15.1");
	});

	// (2) with cortex OFF, the code-nav symbol palette shows the disabled banner
	test("symbol palette shows unavailable banner when cortex is off", async () => {
		await loadRepoAndSelectWorktree();

		const isMac = process.platform === "darwin";
		await page.keyboard.press(isMac ? "Meta+t" : "Control+t");

		const banner = page.getByTestId("code-nav-unavailable-banner");
		await expect(banner).toBeVisible({ timeout: 15_000 });
		await expect(banner).toContainText(
			"Enable ai-cortex to use code navigation.",
		);
	});

	// (3) toggling cortex ON clears the banner live (driver emits availabilityChanged)
	test("toggling cortex ON clears the unavailable banner", async () => {
		await loadRepoAndSelectWorktree();

		const isMac = process.platform === "darwin";
		await page.keyboard.press(isMac ? "Meta+t" : "Control+t");

		const banner = page.getByTestId("code-nav-unavailable-banner");
		await expect(banner).toBeVisible({ timeout: 15_000 });

		await page.getByRole("button", { name: "Open Plugins panel" }).click();
		const card = page.locator('[data-plugin-id="cortex"]');
		await expect(card).toBeVisible({ timeout: 15_000 });
		await card.getByRole("switch").click();
		await expect(card.locator(".plugin-chip")).toContainText(/on/, {
			timeout: 15_000,
		});

		await page.keyboard.press("Escape");

		await expect(banner).not.toBeVisible({ timeout: 15_000 });
	});

	// (4) clicking Configure injects the EXACT composed agent-wiring command
	test("Configure injects the exact cortex wiring command via window.__lastPluginCommand", async () => {
		await loadRepoAndSelectWorktree();

		await page.getByRole("button", { name: "Open Plugins panel" }).click();
		const card = page.locator('[data-plugin-id="cortex"]');
		await expect(card).toBeVisible({ timeout: 15_000 });

		// Wait for agent-CLI probes to resolve so Configure uses the full probed
		// set (claude + codex are both found via AI14ALL_FAKE_AGENT_CLIS).
		await expect(
			page.locator('[data-cli="claude"][data-found="true"]'),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.locator('[data-cli="codex"][data-found="true"]'),
		).toBeVisible({ timeout: 15_000 });

		await card.getByRole("button", { name: "Configure" }).click();

		const expectedCommand =
			"claude mcp get ai-cortex >/dev/null 2>&1 || claude mcp add -s user ai-cortex -- ai-cortex mcp; " +
			"codex mcp get ai-cortex >/dev/null 2>&1 || codex mcp add ai-cortex -- ai-cortex mcp; " +
			"ai-cortex history install-hooks; " +
			"ai-cortex memory install-prompt-guide";

		// handlePluginInstall sets window.__lastPluginCommand synchronously, but the
		// React onClick is async so poll briefly.
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							(window as unknown as { __lastPluginCommand?: string })
								.__lastPluginCommand ?? null,
					),
				{ timeout: 10_000 },
			)
			.toBe(expectedCommand);
	});

	// (5) clicking Configure launches a pinned terminal session (the injection path
	//     actually fires). The exact command is covered by (4); the OS shell's
	//     execution of it is the shell's responsibility, not this app's.
	test("Configure launches a pinned terminal session for the wiring command", async () => {
		await loadRepoAndSelectWorktree();

		await page.getByRole("button", { name: "Open Plugins panel" }).click();
		const card = page.locator('[data-plugin-id="cortex"]');
		await expect(card).toBeVisible({ timeout: 15_000 });
		await expect(
			page.locator('[data-cli="claude"][data-found="true"]'),
		).toBeVisible({ timeout: 15_000 });

		const beforePanes = await page.locator(".shell-terminal-pane").count();

		await card.getByRole("button", { name: "Configure" }).click();

		await expect(page.locator(".shell-terminal-pane")).toHaveCount(
			beforePanes + 1,
			{ timeout: 15_000 },
		);
	});
});
