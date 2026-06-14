import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";
import {
	setUpWhisperStub,
	startStubEventSocket,
	type StubEventSocket,
	type WhisperStubEnv,
} from "./fixtures/whisper-stub";

function setUpAgentCliStubs(): { binDir: string; env: Record<string, string> } {
	const binDir = mkdtempSync(join(tmpdir(), "ofa-agent-bin-"));
	mkdirSync(binDir, { recursive: true });
	const write = (name: string, body: string) => {
		const p = join(binDir, name);
		writeFileSync(p, body, "utf8");
		chmodSync(p, 0o755);
	};
	write("claude", "#!/bin/sh\necho 'claude 9.9.9'\n");
	write("codex", "#!/bin/sh\necho 'codex 9.9.9'\n");
	write(
		"ezio",
		"#!/bin/sh\nif [ \"$1\" = doctor ]; then echo 'ezio version : 0.2.0-beta.3'; exit 0; fi\necho hax\n",
	);
	return {
		binDir,
		// PATH stubs make the spawned `claude`/`codex`/`ezio` commands runnable;
		// AI14ALL_FAKE_AGENT_CLIS makes the (PATH-ignoring) e2e probe report them
		// as found so the launcher chips render.
		env: {
			PATH: `${binDir}:${process.env.PATH ?? ""}`,
			AI14ALL_FAKE_AGENT_CLIS: "claude,codex,ezio",
		},
	};
}

/**
 * E2E for the whisper ecosystem plugin against a stub `whisper` binary and a
 * fixture state.db. Three scenarios, each launching its own app instance:
 *   1. chips render + toggle persists (comment-preserving config write)
 *   2. a LIVE event-socket `workflow.halted` flips the row with polling pinned
 *      to 60s, proving the refresh came from the socket, not a poll
 *   3. agent launchers mount when whisper is healthy: clicking a chip injects a
 *      mount command, the collab-status pill tracks bindings ("need 1 more" →
 *      "ready for workflows"), and the relocated "+ Shell" button still spawns a
 *      pane; plus a whisper-off variant where a chip spawns the bare provider
 *      with no mount command and no status pill
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
		await expect(row.locator(".workflow-row__status")).toHaveAttribute(
			"data-status",
			"halted",
			{ timeout: 10_000 },
		);
	});

	test("agent launchers mount when whisper is healthy and the relocated + Shell still works", async () => {
		repo = createTestRepo();
		stub = setUpWhisperStub({ enabled: true });
		stub.writeFixture({ schemaVersion: 6 }); // empty: whisper on-healthy, no collab
		const agentStubs = setUpAgentCliStubs();
		await launch(agentStubs.env);
		await loadRepoAndSelectWorktree();

		const header = page.getByRole("region", { name: "Terminal controls" });
		await expect(header).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("agent-launch-claude")).toBeVisible();
		await expect(page.getByTestId("agent-launch-codex")).toBeVisible();
		await expect(page.getByTestId("agent-launch-ezio")).toBeVisible();

		await page.getByTestId("agent-launch-claude").click();
		await expect(
			page.getByText("whisper collab mount claude").first(),
		).toBeVisible({ timeout: 20_000 });

		stub.writeFixture({
			schemaVersion: 6,
			collabs: [
				{ collab_id: "c1", workspace_root: repo.repoPath, status: "active" },
			],
			daemons: [
				{ collab_id: "c1", last_heartbeat_at: new Date().toISOString() },
			],
			bindings: [
				{ collab_id: "c1", agent_type: "claude", binding_state: "bound" },
			],
		});
		await expect(page.getByTestId("collab-status-pill")).toHaveText(
			/need 1 more/,
			{ timeout: 15_000 },
		);

		stub.writeFixture({
			schemaVersion: 6,
			collabs: [
				{ collab_id: "c1", workspace_root: repo.repoPath, status: "active" },
			],
			daemons: [
				{ collab_id: "c1", last_heartbeat_at: new Date().toISOString() },
			],
			bindings: [
				{ collab_id: "c1", agent_type: "claude", binding_state: "bound" },
				{ collab_id: "c1", agent_type: "codex", binding_state: "bound" },
			],
		});
		await expect(page.getByTestId("collab-status-pill")).toHaveText(
			/ready for workflows/,
			{ timeout: 15_000 },
		);

		const before = await page.locator(".shell-terminal-pane").count();
		await page.getByTestId("terminal-add-shell").click();
		await expect(page.locator(".shell-terminal-pane")).toHaveCount(before + 1, {
			timeout: 15_000,
		});

		rmSync(agentStubs.binDir, { recursive: true, force: true });
	});

	test("with whisper off, an agent chip spawns the bare provider", async () => {
		repo = createTestRepo();
		stub = setUpWhisperStub({ enabled: false }); // whisper installed but off
		const agentStubs = setUpAgentCliStubs();
		await launch(agentStubs.env);
		await loadRepoAndSelectWorktree();

		await expect(page.getByTestId("agent-launch-codex")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("collab-status-pill")).toHaveCount(0);
		await page.getByTestId("agent-launch-codex").click();
		const pane = page.locator('.shell-terminal-pane[aria-hidden="false"]');
		await expect(pane.getByText("codex").first()).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.getByText("whisper collab mount")).toHaveCount(0);

		rmSync(agentStubs.binDir, { recursive: true, force: true });
	});
});
