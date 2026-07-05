/**
 * E2E proof for the restore-all-workspaces flow (spec: persistent-settings +
 * restore-all): a pre-seeded v2 workspace-state file with `alwaysRestore`
 * brings BOTH saved workspaces back on launch — the active one restored
 * immediately, the other background-hydrated to `inactiveLive` — with no
 * restore prompt and no manual repo pick. Terminals stay lazy: the
 * background-hydrated workspace gets real worktrees + a live sidebar
 * (no more "Open this workspace to load its worktree sessions." placeholder)
 * but spawns nothing until the user actually visits one of its worktrees.
 *
 * Harness copied from tests/e2e/session-attention.spec.ts (electron.launch
 * args, env seams, createTestRepo/closeApp fixtures) and
 * tests/e2e/multi-workspace-fast-switch.test.ts (workspace-group locator
 * pattern: `page.getByRole("group", { name: basename(repoPath) })`).
 *
 * Two things this test resolves at runtime rather than assuming:
 *  - The sidebar workspace name is `path.basename(<git toplevel>)` (see
 *    services/worktrees/worktree-service.ts `setRepositoryRoot`), which for
 *    these fixture repos equals `basename(repo.repoPath)` (realpath'd temp
 *    dir === git toplevel). The seeded `workspaceId: workspace:<repoPath>`
 *    literal below is only a placeholder the startup-restore reconciliation
 *    matches by `repositoryPath`/order, NOT the id the backend actually
 *    assigns once it re-opens the repo.
 *  - The backend's canonical workspaceId is `workspace:<repoId-uuid>`
 *    (electron/main/ipc.ts `workspace:openRepository`), where `repoId` is a
 *    random UUID minted into `.git/config` (`ai14all.repoId`) the first time
 *    the repo is opened — NOT `workspace:<repoPath>`. `terminals.list` keys
 *    strictly on this canonical id, so it is resolved at runtime via
 *    `window.ai14all.workspace.openRepository(repoPath)` (idempotent/dedup'd
 *    against the app's own earlier open — see
 *    services/workspace/workspace-registry-service.ts), reading its
 *    `.workspaceId` field (NOT `.id`, which the type does not have).
 */
import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let repoA: TestRepo;
let repoB: TestRepo;
let stateDir: string;
let userDataDir: string;

const savedWorkspace = (repoPath: string) => ({
	workspaceId: `workspace:${repoPath}`,
	repositoryPath: repoPath,
	repoId: null,
	snapshot: {
		repositoryPath: repoPath,
		repoId: null,
		selectedWorktreeId: repoPath,
		commandPresets: [],
		worktreeSessions: [
			{
				worktreeId: repoPath,
				title: "",
				note: "",
				reviewMode: "files" as const,
				viewerMode: "file" as const,
				selectedFilePath: null,
				selectedChangedFilePath: null,
				activeProcessSessionId: null,
				nextAdHocNumber: 1,
				processSessions: [],
			},
		],
	},
});

test.beforeAll(() => {
	repoA = createTestRepo();
	repoB = createTestRepo();
	stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-restoreall-")));
	userDataDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-restoreall-ud-")),
	);
	writeFileSync(
		join(stateDir, "workspace-state.json"),
		JSON.stringify({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: `workspace:${repoA.repoPath}`,
			workspaceOrder: [
				`workspace:${repoA.repoPath}`,
				`workspace:${repoB.repoPath}`,
			],
			workspaces: [
				savedWorkspace(repoA.repoPath),
				savedWorkspace(repoB.repoPath),
			],
		}),
	);
});

test.afterAll(async () => {
	if (app) await closeApp(app);
	rmSync(stateDir, { recursive: true, force: true });
	rmSync(userDataDir, { recursive: true, force: true });
	repoA.cleanup();
	repoB.cleanup();
});

test("both workspaces hydrate on launch; terminals spawn on first visit only", async () => {
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
			AI14ALL_USER_DATA_PATH: userDataDir,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });

	const nameB = basename(repoB.repoPath);
	const groupB = page
		.getByRole("navigation", { name: "Worktree sessions" })
		.getByRole("group", { name: nameB });

	// Both workspaces restore with NO prompt: `alwaysRestore` is seeded from
	// the legacy workspace-state file into settings on first boot (Task 3/4),
	// so `useStartupRestore` auto-restores the active workspace (repo A)
	// immediately. Background hydration (Task 7) then brings repo B to
	// `inactiveLive` without any click — its placeholder disappears and its
	// real worktree rows appear.
	await expect(
		page.getByText("Open this workspace to load its worktree sessions."),
	).toHaveCount(0, { timeout: 30_000 });
	await expect(groupB.getByRole("button", { name: /main/i })).toBeVisible({
		timeout: 10_000,
	});

	// Resolve repo B's canonical (post-hydration) workspaceId.
	const bId = await page.evaluate(
		(repoPath) =>
			window.ai14all.workspace
				.openRepository(repoPath)
				.then((r) => r.workspaceId),
		repoB.repoPath,
	);

	// No PTY exists yet for repo B: terminals are lazy — every saved worktree
	// session sits in the pending-restore map until the worktree is visited.
	const before = await page.evaluate(
		(id) => window.ai14all.terminals.list(id).then((l) => l.length),
		bId,
	);
	expect(before).toBe(0);

	// Visit repo B's main worktree: its pending (zero-process) session
	// restores, and the default-shell-on-empty-worktree effect spawns a
	// terminal now that this worktree is the active selection.
	await groupB.getByRole("button", { name: /main/i }).click();
	await expect
		.poll(
			() =>
				page.evaluate(
					(id) => window.ai14all.terminals.list(id).then((l) => l.length),
					bId,
				),
			{ timeout: 30_000 },
		)
		.toBeGreaterThan(0);
});
