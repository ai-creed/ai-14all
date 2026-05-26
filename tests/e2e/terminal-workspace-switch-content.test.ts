import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { createSecondTestRepo } from "./fixtures/create-second-test-repo";

// Regression test for: "terminal renders empty after switching workspaces".
//
// Repro (observed): each workspace switch unmounts the leaving workspace's
// terminal panes (pane_unmounted in the shell-event log) and remounts a fresh
// xterm on return. Terminal output has no durable buffer, so the remounted
// pane has no content to replay and renders blank — the user sees the agent
// shell go empty. This asserts the user-visible symptom: text already shown in
// a terminal must survive a round-trip to another workspace and back.
//
// A single shell per workspace reproduces the root cause; the original report's
// two-agent setup is the same code path with more panes.

// Serial: the second test reuses the two workspaces loaded by the first.
test.describe.configure({ mode: "serial" });

let app: ElectronApplication | undefined;
let page: Page;
let repoA: TestRepo;
let repoB: TestRepo;
let persistedStateDir: string;
let persistedStatePath: string;
let userDataDir: string;

async function launchApp() {
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: repoA.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
			AI14ALL_USER_DATA_PATH: userDataDir,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
}

test.beforeAll(async () => {
	repoA = createTestRepo();
	repoB = createSecondTestRepo();
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-wsswitch-")),
	);
	persistedStatePath = join(persistedStateDir, "workspace-state.json");
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-user-data-")));
	await launchApp();
}, 60_000);

test.afterAll(async () => {
	try {
		if (app) await app.close();
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		rmSync(userDataDir, { recursive: true, force: true });
		repoA?.cleanup();
		repoB?.cleanup();
	}
}, 90_000);

const workspaceSidebar = () =>
	page.getByRole("navigation", { name: "Worktree sessions" });

// Every hydrated workspace now keeps its terminal panel mounted; only the
// active workspace's panes are visible (aria-hidden="false"). Scope all
// terminal queries to the visible pane so we never accidentally read a hidden
// workspace's xterm.
const visiblePane = () =>
	page.locator('.shell-terminal-pane[aria-hidden="false"]').first();
const visibleAccessibilityTree = () =>
	visiblePane().locator(".xterm-accessibility-tree");

async function typeInActiveTerminal(line: string) {
	const ta = visiblePane().locator(".xterm-helper-textarea");
	await ta.waitFor({ state: "attached" });
	await ta.focus();
	await page.keyboard.type(line);
	await page.keyboard.press("Enter");
}

test("terminal output survives a workspace round-trip", async () => {
	test.setTimeout(120_000);

	// Load repo A and activate its main worktree (auto-creates a shell).
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(repoA.repoPath);
	await page.getByRole("button", { name: "Load" }).click();

	await expect(
		workspaceSidebar().getByRole("button", { name: / main$/i }),
	).toBeVisible({ timeout: 15_000 });
	await workspaceSidebar()
		.getByRole("button", { name: / main$/i })
		.click();

	await expect(
		page
			.locator(
				'[data-active="true"] .shell-terminal-slot:not(.shell-terminal-slot--empty)',
			)
			.first(),
	).toBeVisible({ timeout: 15_000 });
	await expect(page.locator(".xterm")).toHaveCount(1, { timeout: 10_000 });

	await typeInActiveTerminal("echo MARKER_AAA");
	await expect(visibleAccessibilityTree()).toContainText("MARKER_AAA", {
		timeout: 10_000,
	});

	// Load repo B as a second workspace and activate it.
	await page.getByRole("button", { name: "Load workspace" }).click();
	await expect(
		page.getByRole("dialog", { name: "Load workspace" }),
	).toBeVisible({ timeout: 5_000 });
	await page.getByLabel("Repository path").fill(repoB.repoPath);
	await page.getByRole("button", { name: "Load" }).click();

	const nameA = basename(repoA.repoPath);
	const nameB = basename(repoB.repoPath);
	await expect(
		workspaceSidebar().getByRole("group", { name: nameB }),
	).toBeVisible({ timeout: 10_000 });
	await workspaceSidebar()
		.getByRole("group", { name: nameB })
		.getByRole("button", { name: / main$/i })
		.click();

	await expect(
		page
			.locator(
				'[data-active="true"] .shell-terminal-slot:not(.shell-terminal-slot--empty)',
			)
			.first(),
	).toBeVisible({ timeout: 15_000 });
	await typeInActiveTerminal("echo MARKER_BBB");
	await expect(visibleAccessibilityTree()).toContainText("MARKER_BBB", {
		timeout: 10_000,
	});

	// Round-trip: switch to A, then back to B.
	await workspaceSidebar()
		.getByRole("group", { name: nameA })
		.getByRole("button", { name: / main$/i })
		.click();
	await expect(
		workspaceSidebar().getByRole("group", { name: nameA }),
	).toHaveAttribute("data-active-workspace", "true", { timeout: 10_000 });

	await workspaceSidebar()
		.getByRole("group", { name: nameB })
		.getByRole("button", { name: / main$/i })
		.click();
	await expect(
		workspaceSidebar().getByRole("group", { name: nameB }),
	).toHaveAttribute("data-active-workspace", "true", { timeout: 10_000 });

	await expect(
		page
			.locator(
				'[data-active="true"] .shell-terminal-slot:not(.shell-terminal-slot--empty)',
			)
			.first(),
	).toBeVisible({ timeout: 10_000 });

	// The terminal that previously showed MARKER_BBB must still show it after
	// the round-trip. Today it renders blank (pane unmounted + no replay).
	await expect(visibleAccessibilityTree()).toContainText("MARKER_BBB", {
		timeout: 10_000,
	});
});

// Covers the second half of the root-cause contract from the diagnosis:
// output produced WHILE a workspace is inactive must still be written into its
// (hidden) xterm, so it appears on return. Before the fix, switching away
// unmounted the pane and tore down its PTY output subscription, so anything the
// PTY emitted while hidden was delivered to no subscriber and lost forever —
// this asserts it is captured instead. Relies on the two workspaces loaded by
// the previous (serial) test, with B currently active.
test("output emitted while a workspace is inactive appears after switching back", async () => {
	test.setTimeout(120_000);

	const nameA = basename(repoA.repoPath);
	const nameB = basename(repoB.repoPath);

	// B is active from the previous test. Start a command in B that emits its
	// marker only after a delay, so the output lands after we have switched away.
	await expect(
		workspaceSidebar().getByRole("group", { name: nameB }),
	).toHaveAttribute("data-active-workspace", "true", { timeout: 10_000 });
	await typeInActiveTerminal("sleep 2 && echo HIDDEN_WHILE_INACTIVE");

	// Switch to A immediately — well before the 2s sleep elapses — so the echo
	// fires while B's pane is hidden/inactive.
	await workspaceSidebar()
		.getByRole("group", { name: nameA })
		.getByRole("button", { name: / main$/i })
		.click();
	await expect(
		workspaceSidebar().getByRole("group", { name: nameA }),
	).toHaveAttribute("data-active-workspace", "true", { timeout: 10_000 });

	// The visible (A) terminal must not be the one emitting the marker, and the
	// marker has not fired yet anyway — guards against the output happening while
	// B was still visible.
	await expect(visibleAccessibilityTree()).not.toContainText(
		"HIDDEN_WHILE_INACTIVE",
	);

	// Wait on A long enough for B's delayed echo to fire while B is hidden.
	await page.waitForTimeout(3_000);

	// Back to B: the output produced while it was inactive must now be present.
	await workspaceSidebar()
		.getByRole("group", { name: nameB })
		.getByRole("button", { name: / main$/i })
		.click();
	await expect(
		workspaceSidebar().getByRole("group", { name: nameB }),
	).toHaveAttribute("data-active-workspace", "true", { timeout: 10_000 });

	await expect(visibleAccessibilityTree()).toContainText(
		"HIDDEN_WHILE_INACTIVE",
		{ timeout: 10_000 },
	);
});
