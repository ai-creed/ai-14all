/**
 * E2E for workflow-suppressed attention (spec 2026-07-05 §4/§8) and unified
 * agent detection (§3). Builds on the plugins-whisper.test.ts fixture pattern:
 * a stub whisper binary + fixture state.db bound to the feature-a worktree.
 *
 * Reliability model (poll-driven, no socket): these tests do NOT need the
 * "flip without polling" guarantee that plugins-whisper.test.ts proves, so they
 * run the whisper driver at its DEFAULT fast poll (~3s) rather than pinning it
 * to 60s. Every workflow state change is applied by rewriting the fixture
 * state.db; the next poll re-reads it and re-renders the lens. This removes the
 * dependency on the flaky worktree-change re-snapshot (gotcha mem-2026-06-19)
 * and the net-no-op off→on plugin toggle — both of which made the initial
 * `.workflow-row` render time out under full-suite load. Heartbeats are written
 * in the near future so `daemonAlive` (staleMs = 30s) stays true for the whole
 * test regardless of wall-clock duration.
 *
 * Attention-raising recipe (from session-attention.spec.ts): a shell becomes an
 * agent via OSC title (session/updateProcessLabel → isAgentProcess), and its
 * output raises actionRequired only while UNVIEWED — so each scenario sets up
 * the shell on feature-a, switches to main, then sends input.
 */

import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { rmSync } from "node:fs";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";
import { setUpWhisperStub, type WhisperStubEnv } from "./fixtures/whisper-stub";

let app: ElectronApplication | undefined;
let page: Page;
let repo: TestRepo;
let stub: WhisperStubEnv;

function worktreeNav() {
	return page.getByRole("navigation", { name: "Worktree sessions" });
}

function featureABtn() {
	return worktreeNav().getByRole("button", { name: /feature-a/i });
}

/**
 * The card wrapper (`.shell-sidebar__row`) for the worktree whose nav button
 * matches `name`. The provider badge is rendered as a SIBLING of the nav button
 * (SessionSidebar.tsx renders `{item}{taskLine}{processList}` inside the row,
 * deliberately outside the row button to avoid nested `<button>` elements), so
 * badge/process-row lookups must scope to the row, not to the button.
 */
function worktreeRow(name: RegExp) {
	return worktreeNav()
		.locator(".shell-sidebar__row")
		.filter({ has: page.getByRole("button", { name }) });
}

async function launch(extraEnv: Record<string, string> = {}): Promise<void> {
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: { ...process.env, ...stub.env, ...extraEnv },
	});
	page = await app.firstWindow({ timeout: 60_000 });
}

async function loadRepoAndSelect(name: RegExp): Promise<void> {
	await page.locator("#repo-path").fill(repo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	await expect(worktreeNav().getByRole("button", { name })).toBeVisible({
		timeout: 15_000,
	});
	await worktreeNav().getByRole("button", { name }).click();
	await expect(page.getByRole("region", { name: "Session" })).toBeVisible({
		timeout: 15_000,
	});
}

async function getVisibleTerminalSessionId(): Promise<string | null> {
	return page.evaluate<string | null>(() => {
		const pane = document.querySelector<HTMLElement>(
			'.shell-terminal-pane[aria-hidden="false"]',
		);
		return pane?.dataset.terminalSessionId ?? null;
	});
}

async function trySendInput(sessionId: string, data: string): Promise<boolean> {
	return page.evaluate<boolean, { sid: string; data: string }>(
		async ({ sid, data: payload }) => {
			try {
				await window.ai14all.terminals.sendInput(sid, payload);
				return true;
			} catch (err) {
				if (
					String((err as Error)?.message ?? err).includes(
						"Terminal session not found",
					)
				) {
					return false;
				}
				throw err;
			}
		},
		{ sid: sessionId, data },
	);
}

/** Spawn a fresh shell in the CURRENT worktree and return a live session id. */
async function spawnFreshShellSession(): Promise<string | null> {
	const slots = page.locator(
		".shell-terminal-slot:not(.shell-terminal-slot--empty)",
	);
	const before = await slots.count();
	await page.getByRole("button", { name: "Add shell" }).click();
	await expect
		.poll(async () => await slots.count(), { timeout: 10_000 })
		.toBeGreaterThan(before);
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const sid = await getVisibleTerminalSessionId();
		if (sid && (await trySendInput(sid, ""))) return sid;
		await page.waitForTimeout(250);
	}
	return null;
}

/** Set the shell's OSC title until the provider badge appears on the card. */
async function setProviderViaOscTitle(
	sessionId: string,
	provider: string,
	cardName: RegExp,
): Promise<boolean> {
	const badge = worktreeRow(cardName).locator(
		`.shell-sidebar__provider-badge[data-provider="${provider}"]`,
	);
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const sent = await trySendInput(
			sessionId,
			` printf '\\033]0;${provider}\\007'\r`,
		);
		if (sent && (await badge.count()) > 0) return true;
		await page.waitForTimeout(500);
	}
	return (await badge.count()) > 0;
}

/**
 * Near-future heartbeat so `daemonAlive` (staleMs = 30s) stays true for the
 * whole test regardless of duration: `now() - Date.parse(heartbeat)` is
 * negative, which is < 30s. Removes the heartbeat-aging flake that a
 * `Date.now()` heartbeat suffers once a scenario's setup exceeds 30s.
 */
function futureHeartbeat(): string {
	return new Date(Date.now() + 5 * 60_000).toISOString();
}

/**
 * Base fixture: a live daemon + a RUNNING workflow bound to feature-a with a
 * normal (non-escalated) relay chain. `chainOverride` flips the chain to
 * `status: "escalated"` while keeping the WORKFLOW status running.
 */
function runningWorkflowFixture(chainOverride: Record<string, unknown> = {}) {
	return {
		schemaVersion: 6,
		collabs: [
			{ collab_id: "c1", workspace_root: repo.worktreePath, status: "active" },
		],
		daemons: [{ collab_id: "c1", last_heartbeat_at: futureHeartbeat() }],
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
		chains: [{ chain_id: "ch1", collab_id: "c1", ...chainOverride }],
	};
}

test.afterEach(async () => {
	await closeApp(app);
	app = undefined;
	rmSync(stub.userDataDir, { recursive: true, force: true });
	rmSync(stub.stateRoot, { recursive: true, force: true });
	repo.cleanup();
});

test.describe.serial("workflow attention suppression", () => {
	test("running workflow suppresses an agent prompt; a workflow escalation punches through while the process source stays suppressed", async () => {
		test.setTimeout(180_000);
		repo = createTestRepo();
		stub = setUpWhisperStub({ enabled: true });
		stub.writeFixture(runningWorkflowFixture());
		await launch();
		await loadRepoAndSelect(/feature-a/i);

		// The default fast poll (~3s) renders the running workflow row within a
		// few seconds — no socket / toggle / snapshot dependency.
		const row = worktreeNav().locator(".workflow-row");
		await expect(row.locator(".workflow-row__status")).toHaveAttribute(
			"data-status",
			"running",
			{ timeout: 30_000 },
		);

		// Agent shell on feature-a, then switch away so its output is UNVIEWED
		// (viewed output never raises attention regardless of suppression).
		const sid = await spawnFreshShellSession();
		test.skip(sid === null, "no live shell session available");
		const badged = await setProviderViaOscTitle(sid!, "claude", /feature-a/i);
		expect(badged).toBe(true);
		await worktreeNav().getByRole("button", { name: / main$/i }).click();

		// --- Part 1: suppression on. A waiting prompt must NOT go red. ---
		await trySendInput(sid!, " printf 'Approve this change? (y/n)\\n'\r");
		// Deliberate quiet window: give the pipeline ample time to (wrongly) raise
		// before asserting it stayed quiet. This is the one fixed wait in the file.
		await page.waitForTimeout(5_000);
		await expect(featureABtn()).not.toHaveAttribute(
			"data-attention",
			"actionRequired",
		);
		// Spec §8: the process row must STILL SHOW ACTIVITY while the red tier is
		// suppressed — suppression must not drop the row to idle or hide it. Scope
		// to the claude shell's own row via its provider badge; under suppression
		// deriveState skips the actionRequired branch and falls through to "active"
		// by recency (the prompt just landed, well inside the 10s active window).
		// This fails if a regression suppressed the row to idle/hidden (which the
		// worktree-button check above would NOT catch).
		const claudeRow = worktreeRow(/feature-a/i)
			.locator(".shell-sidebar__process")
			.filter({
				has: page.locator(
					'.shell-sidebar__provider-badge[data-provider="claude"]',
				),
			});
		await expect(
			claudeRow.locator('[data-testid="process-state-indicator"]'),
		).toHaveAttribute("data-state", "active");

		// --- Part 2: escalation punches through, unambiguously from the workflow
		// source. Rewrite the fixture so the relay chain is escalated while the
		// WORKFLOW status stays "running" (App.tsx's suppression predicate keys on
		// that, so the PROCESS prompt stays suppressed). The next poll re-reads it. ---
		stub.writeFixture(
			runningWorkflowFixture({
				status: "escalated",
				terminal_reason: "needs a human decision",
				updated_at: futureHeartbeat(),
			}),
		);
		// WorkflowRow renders escalation-over-status (statusKey = row.escalated ?
		// "escalated" : row.status), so the row's data-status becomes "escalated".
		// That is the unambiguous witness that the red ring below is the workflow
		// escalation source — a resurfaced (still-suppressed) process prompt would
		// never move the workflow row.
		await expect(row.locator(".workflow-row__status")).toHaveAttribute(
			"data-status",
			"escalated",
			{ timeout: 30_000 },
		);
		// …and the ring is red: the escalation punched through suppression.
		await expect(featureABtn()).toHaveAttribute(
			"data-attention",
			"actionRequired",
			{ timeout: 30_000 },
		);
	});

	test("workflow completion lifts suppression: the worktree shows ready, then a new prompt raises attention again", async () => {
		test.setTimeout(180_000);
		repo = createTestRepo();
		stub = setUpWhisperStub({ enabled: true });
		stub.writeFixture(runningWorkflowFixture());
		await launch();
		await loadRepoAndSelect(/feature-a/i);

		const row = worktreeNav().locator(".workflow-row");
		await expect(row.locator(".workflow-row__status")).toHaveAttribute(
			"data-status",
			"running",
			{ timeout: 30_000 },
		);

		// --- Part 1: done → the worktree shows the READY tier (workflow-source
		// ready reason; no competing process attention because none was raised). ---
		stub.writeFixture({
			...runningWorkflowFixture(),
			workflows: [
				{
					workflow_id: "wf1",
					collab_id: "c1",
					status: "done",
					current_phase_index: 0,
				},
			],
		});
		await expect(row.locator(".workflow-row__status")).toHaveAttribute(
			"data-status",
			"done",
			{ timeout: 30_000 },
		);
		await expect(featureABtn()).toHaveAttribute("data-attention", "ready", {
			timeout: 30_000,
		});

		// --- Part 2: normal attention resumes. With the workflow done, suppression
		// is lifted, so a fresh unviewed agent prompt raises actionRequired again —
		// proving the mute was scoped to the active run, not permanent. ---
		const sid = await spawnFreshShellSession();
		test.skip(sid === null, "no live shell session available");
		const badged = await setProviderViaOscTitle(sid!, "claude", /feature-a/i);
		expect(badged).toBe(true);
		await worktreeNav().getByRole("button", { name: / main$/i }).click();

		await trySendInput(sid!, " printf 'Approve this change? (y/n)\\n'\r");
		await expect(featureABtn()).toHaveAttribute(
			"data-attention",
			"actionRequired",
			{ timeout: 20_000 },
		);
	});

	test("unified detection: an ezio shell raises attention like a claude shell", async () => {
		test.setTimeout(120_000);
		repo = createTestRepo();
		stub = setUpWhisperStub({ enabled: true });
		stub.writeFixture({ schemaVersion: 6 }); // healthy whisper, no collab → no suppression
		await launch();
		await loadRepoAndSelect(/feature-a/i);

		const sid = await spawnFreshShellSession();
		test.skip(sid === null, "no live shell session available");
		// Pre-unification, "ezio" was absent from KNOWN_AGENTS: the badge showed
		// but agentDetected stayed false and no attention ever raised. This pins
		// the unified path end-to-end.
		const badged = await setProviderViaOscTitle(sid!, "ezio", /feature-a/i);
		expect(badged).toBe(true);
		await worktreeNav().getByRole("button", { name: / main$/i }).click();

		await trySendInput(sid!, " printf 'Approve this change? (y/n)\\n'\r");
		await expect(featureABtn()).toHaveAttribute(
			"data-attention",
			"actionRequired",
			{ timeout: 20_000 },
		);
	});
});
