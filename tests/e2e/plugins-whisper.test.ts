import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";
import {
	setUpWhisperStub,
	startStubEventSocket,
	type StubEventSocket,
	type WhisperStubEnv,
} from "./fixtures/whisper-stub";

/**
 * E2E for the whisper ecosystem plugin against a stub `whisper` binary and a
 * fixture state.db. Three scenarios, each launching its own app instance:
 *   1. chips render + toggle persists (comment-preserving config write)
 *   2. a LIVE event-socket `workflow.halted` flips the row with polling pinned
 *      to 60s, proving the refresh came from the socket, not a poll
 *   3. Start-collab injects the two mount commands and flips to "ready" once
 *      both agent bindings land
 *
 * The fourth spec scenario (no-stub independence) lives in
 * tests/e2e/plugins-independence.test.ts and is intentionally untouched.
 */

let app: ElectronApplication | undefined;
let page: Page;
let repo: TestRepo;
let stub: WhisperStubEnv;
let socket: StubEventSocket | undefined;

function worktreeNav() {
	return page.getByRole("navigation", { name: "Worktree sessions" });
}

/** Loads the repo and selects the main worktree so the session chip bar mounts. */
async function loadRepoAndSelectWorktree(): Promise<void> {
	await page.locator("#repo-path").fill(repo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		worktreeNav().getByRole("button", { name: / main$/i }),
	).toBeVisible({ timeout: 15_000 });
	await worktreeNav()
		.getByRole("button", { name: / main$/i })
		.click();
	// The chip bar mounts once an active worktree session exists.
	await expect(page.getByRole("region", { name: "Session" })).toBeVisible({
		timeout: 15_000,
	});
}

async function launch(extraEnv: Record<string, string> = {}): Promise<void> {
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: { ...process.env, ...stub.env, ...extraEnv },
	});
	page = await app.firstWindow({ timeout: 60_000 });
}

test.afterEach(async () => {
	await socket?.close();
	socket = undefined;
	await closeApp(app);
	app = undefined;
	rmSync(stub.userDataDir, { recursive: true, force: true });
	rmSync(stub.stateRoot, { recursive: true, force: true });
	repo.cleanup();
});

test.describe.serial("whisper plugin (stub binary)", () => {
	test("chips render and toggle persists to config.toml", async () => {
		repo = createTestRepo();
		stub = setUpWhisperStub({ enabled: false });
		await launch();
		await loadRepoAndSelectWorktree();

		await page.getByRole("button", { name: "Open Plugins panel" }).click();

		const card = page.locator('[data-plugin-id="whisper"]');
		await expect(card).toBeVisible({ timeout: 15_000 });
		// Probe runs even while disabled, so version + installed-off chip show.
		await expect(card).toContainText("installed, off");
		await expect(card).toContainText("0.6.0-stub");

		// Toggle on: the chip flips to "on" via the push from the registry.
		await card.getByRole("switch").click();
		await expect(card.locator(".plugin-chip")).toContainText(/on/, {
			timeout: 15_000,
		});

		// Comment-preserving surgical write: enabled flips, install_path stays.
		const toml = readFileSync(join(stub.userDataDir, "config.toml"), "utf8");
		expect(toml).toContain("enabled = true");
		expect(toml).toContain("install_path");
	});

	test("live socket workflow.halted flips the row without polling", async () => {
		repo = createTestRepo();
		stub = setUpWhisperStub({ enabled: true });
		const freshHeartbeat = new Date().toISOString();
		stub.writeFixture({
			schemaVersion: 6,
			collabs: [
				{
					collab_id: "c1",
					workspace_root: repo.worktreePath,
					status: "active",
				},
			],
			daemons: [{ collab_id: "c1", last_heartbeat_at: freshHeartbeat }],
			workflows: [
				{
					workflow_id: "wf1",
					collab_id: "c1",
					status: "running",
					current_phase_index: 0,
				},
			],
			phases: [
				{
					phase_run_id: "pr1",
					workflow_id: "wf1",
					phase_index: 0,
					phase_name: "implementation",
					chain_id: "ch1",
				},
			],
			chains: [{ chain_id: "ch1", collab_id: "c1" }],
		});
		// Daemon end of the event socket must be listening before the app's
		// driver attaches on its first poll tick.
		socket = await startStubEventSocket(stub.stateRoot, "c1");

		// Polling pinned to 60s: any UI change inside the 10s assertion window
		// can only have come from the socket-triggered refresh.
		await launch({ AI14ALL_WHISPER_POLL_MS: "60000" });
		await loadRepoAndSelectWorktree();

		// The driver's one boot-time poll fires before the repo is loaded, so its
		// first (and only, for 60s) snapshot resolves zero worktrees. Toggle the
		// plugin off→on through the panel: that stops then restarts the driver,
		// forcing a fresh immediate snapshot now that the worktree is known. This
		// establishes the initial "running" row AND attaches the event socket
		// without shortening the 60s poll — so the later halted flip can still
		// only have come from the socket.
		await page.getByRole("button", { name: "Open Plugins panel" }).click();
		const card = page.locator('[data-plugin-id="whisper"]');
		await expect(card).toBeVisible({ timeout: 15_000 });
		await card.getByRole("switch").click(); // off
		await expect(card.locator(".plugin-chip")).toContainText(/off/, {
			timeout: 15_000,
		});
		await card.getByRole("switch").click(); // back on → fresh driver tick
		await expect(card.locator(".plugin-chip")).toContainText(/on/, {
			timeout: 15_000,
		});
		await page.keyboard.press("Escape"); // dismiss the panel

		const row = worktreeNav().locator(".workflow-row");
		await expect(row).toContainText("running", { timeout: 15_000 });

		await socket.waitForClient();

		// Rewrite the DB to the halted terminal state (fresh heartbeat so the
		// daemon stays alive), then emit the live event that triggers the reread.
		stub.writeFixture({
			schemaVersion: 6,
			collabs: [
				{
					collab_id: "c1",
					workspace_root: repo.worktreePath,
					status: "active",
				},
			],
			daemons: [
				{ collab_id: "c1", last_heartbeat_at: new Date().toISOString() },
			],
			workflows: [
				{
					workflow_id: "wf1",
					collab_id: "c1",
					status: "halted",
					halt_reason: "round limit reached",
					current_phase_index: 0,
				},
			],
			phases: [
				{
					phase_run_id: "pr1",
					workflow_id: "wf1",
					phase_index: 0,
					phase_name: "implementation",
					chain_id: "ch1",
				},
			],
			chains: [{ chain_id: "ch1", collab_id: "c1" }],
		});
		socket.emit("workflow.halted", {
			workflowId: "wf1",
			reason: "round limit reached",
		});

		// 10s << the 60s poll: arriving this fast proves the socket drove it.
		// The halted badge on `.workflow-row` is the assertion target. We do NOT
		// assert the sidebar row's `data-attention="actionRequired"` here: the
		// collab lives on the feature-a worktree (workspace_root) which is not the
		// selected row, and the row's data-attention is computed by
		// buildWorktreeAttentionDisplay (App.tsx) from session/process attention,
		// a path with its own timing. The lens flipping `.workflow-row` to
		// "halted" inside the 10s window is itself the unambiguous socket proof.
		await expect(row).toContainText("halted", { timeout: 10_000 });
		await expect(row.locator(".workflow-status")).toHaveAttribute(
			"data-status",
			"halted",
			{ timeout: 10_000 },
		);
	});

	test("start-collab injects two mount commands and flips to ready", async () => {
		repo = createTestRepo();
		stub = setUpWhisperStub({ enabled: true });
		// Empty DB (schema 6, no collabs): the start-collab button needs whisper
		// on-healthy (probe OK + enabled), and the driver pushes zero states.
		stub.writeFixture({ schemaVersion: 6 });
		await launch();
		await loadRepoAndSelectWorktree();

		const startCollab = page.getByRole("button", { name: "Start collab" });
		await expect(startCollab).toBeVisible({ timeout: 15_000 });
		await startCollab.click();

		await expect(
			page.getByRole("button", { name: "Mounting agents…" }),
		).toBeVisible({ timeout: 15_000 });

		// The terminals echo the injected input back to the xterm DOM.
		await expect(
			page.getByText("whisper collab mount claude").first(),
		).toBeVisible({ timeout: 20_000 });
		await expect(
			page.getByText("whisper collab mount codex").first(),
		).toBeVisible({ timeout: 20_000 });

		// Whisper completes the ceremony: a collab bound to both agents lands.
		// The collab MUST sit on the *active* worktree (the main worktree at
		// repoPath, which loadRepoAndSelectWorktree selects) because the
		// start-collab phase machine watches `whisperStates.get(activeWorktree.id)`
		// — bindings on any other worktree would never reach the button.
		stub.writeFixture({
			schemaVersion: 6,
			collabs: [
				{
					collab_id: "c1",
					workspace_root: repo.repoPath,
					status: "active",
				},
			],
			daemons: [
				{ collab_id: "c1", last_heartbeat_at: new Date().toISOString() },
			],
			bindings: [
				{ collab_id: "c1", agent_type: "claude", binding_state: "bound" },
				{ collab_id: "c1", agent_type: "codex", binding_state: "bound" },
			],
		});

		// Next poll picks up the two bound bindings and flips to ready.
		await expect(
			page.getByRole("button", { name: "Collab ready" }),
		).toBeVisible({ timeout: 15_000 });
	});
});
