import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { createSecondTestRepo } from "./fixtures/create-second-test-repo";
import { closeApp } from "./fixtures/close-app";

type ShellEvent = {
	seq: number;
	event: string;
	data: Record<string, unknown>;
};

let app: ElectronApplication | undefined;
let page: Page;
let repoA: TestRepo;
let repoB: TestRepo;
let persistedStateDir: string;
let persistedStatePath: string;
let terminalDelayPath: string;
let userDataDir: string;

function readShellEvents(): ShellEvent[] {
	try {
		const logDir = join(userDataDir, "diagnostics", "shell-events");
		const files = readdirSync(logDir).sort();
		if (files.length === 0) return [];
		return readFileSync(join(logDir, files[files.length - 1]!), "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as ShellEvent);
	} catch {
		return [];
	}
}

function latestSeq() {
	return readShellEvents().at(-1)?.seq ?? 0;
}

function groupForRepo(repoPath: string) {
	return page
		.getByRole("navigation", { name: "Worktree sessions" })
		.getByRole("group", { name: basename(repoPath) });
}

async function ensureTwoWorkspacesLoaded() {
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(repoA.repoPath);
	await page.getByRole("button", { name: "Load" }).click();

	await expect(
		groupForRepo(repoA.repoPath).getByRole("button", { name: / main$/i }),
	).toBeVisible({ timeout: 15_000 });
	await groupForRepo(repoA.repoPath)
		.getByRole("button", { name: / main$/i })
		.click();

	await expect(
		page
			.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
			.first(),
	).toBeVisible({ timeout: 15_000 });

	await page.getByRole("button", { name: "Load workspace" }).click();
	await expect(
		page.getByRole("dialog", { name: "Load workspace" }),
	).toBeVisible({ timeout: 5_000 });
	await page.getByLabel("Repository path").fill(repoB.repoPath);
	await page.getByRole("button", { name: "Load" }).click();

	await expect(groupForRepo(repoB.repoPath)).toBeVisible({ timeout: 15_000 });
	await groupForRepo(repoB.repoPath)
		.getByRole("button", { name: / main$/i })
		.click();

	await expect(
		page
			.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
			.first(),
	).toBeVisible({ timeout: 15_000 });

	await groupForRepo(repoA.repoPath)
		.getByRole("button", { name: / main$/i })
		.click();

	await expect(
		groupForRepo(repoA.repoPath).getByRole("button", { name: / main$/i }),
	).toBeVisible({ timeout: 10_000 });
}

test.beforeAll(async () => {
	repoA = createTestRepo();
	repoB = createSecondTestRepo();
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-ws-shell-")),
	);
	persistedStatePath = join(persistedStateDir, "workspace-state.json");
	terminalDelayPath = join(persistedStateDir, "terminal-delay.json");
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-user-data-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: repoA.repoPath,
			AI14ALL_E2E_TERMINAL_DELAY_PATH: terminalDelayPath,
			AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
			AI14ALL_USER_DATA_PATH: userDataDir,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
}, 60_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		rmSync(userDataDir, { recursive: true, force: true });
		repoA?.cleanup();
		repoB?.cleanup();
	}
}, 90_000);

test.describe.serial("Workspace shell persistence", () => {
	test.describe.configure({ timeout: 120_000 });

	test("keeps a newly added shell alive and bound to its original workspace after switching away and back", async () => {
		await ensureTwoWorkspacesLoaded();

		const terminalTabs = page.locator(
			".shell-terminal-slot:not(.shell-terminal-slot--empty)",
		);
		const countBefore = await terminalTabs.count();
		const seqBeforeAdd = latestSeq();

		writeFileSync(
			terminalDelayPath,
			JSON.stringify({ nextCreateDelayMs: 1_000 }),
		);
		await page.getByRole("button", { name: "Add shell" }).click();

		// Switch away immediately after requesting the shell to expose timing bugs
		// between shell creation and workspace rebinding.
		await groupForRepo(repoB.repoPath)
			.getByRole("button", { name: / main$/i })
			.click();
		await expect(
			groupForRepo(repoB.repoPath).getByRole("button", { name: / main$/i }),
		).toBeVisible({ timeout: 10_000 });

		await groupForRepo(repoA.repoPath)
			.getByRole("button", { name: / main$/i })
			.click();

		const createdSessionId = await expect
			.poll(
				() => {
					const events = readShellEvents();
					const created = events
						.filter((event) => event.seq > seqBeforeAdd)
						.find(
							(event) =>
								event.event === "renderer-session-create-success" &&
								event.data.terminalSessionId &&
								event.data.worktreeId === repoA.repoPath,
						);
					return typeof created?.data.terminalSessionId === "string"
						? created.data.terminalSessionId
						: null;
				},
				{ timeout: 15_000 },
			)
			.not.toBeNull();

		const createdForWrongWorkspace = readShellEvents().some(
			(event) =>
				event.seq > seqBeforeAdd &&
				event.event === "renderer-session-create-success" &&
				event.data.worktreeId === repoB.repoPath,
		);
		expect(createdForWrongWorkspace).toBe(false);

		await expect(terminalTabs).toHaveCount(countBefore + 1, {
			timeout: 15_000,
		});

		const lifecycleEvents = readShellEvents().filter(
			(event) =>
				event.seq > seqBeforeAdd &&
				typeof event.data.terminalSessionId === "string" &&
				event.data.terminalSessionId === createdSessionId,
		);

		expect(
			lifecycleEvents.some((event) => event.event === "terminal-stop-request"),
		).toBe(false);
		expect(
			lifecycleEvents.some((event) => event.event === "terminal-exit"),
		).toBe(false);
	});
});
