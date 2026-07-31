/**
 * Adversarial gate for the re-fork bound (diagnosis §3.4).
 *
 * The bound is only real if the worker's readiness signal is honest. An earlier
 * cut posted `ready` from the initial sweep's `.then()` — but `sweep()` recovers
 * from its own failures, so it resolved even when the sweep or the persist had
 * failed. With the ledger made unpersistable, every replacement worker then
 * re-armed the host's budget and the five-exit ceiling never engaged: seven
 * consecutive kills produced seven replacements.
 *
 * Here `usage-ledger.json` is a DIRECTORY, so every atomic rename in saveState
 * fails and no worker can ever persist. Eight kills must therefore produce at
 * most five re-forks and then a give-up.
 */
import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";

const KILLS = 8;
const MAX_REFORKS = 5; // UsageHost.MAX_CONSECUTIVE_REFORKS

test("an unpersistable ledger cannot re-arm the re-fork budget", async () => {
	const repo: TestRepo = createTestRepo();
	const userDataDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-budget-ud-")),
	);
	const whisperRoot = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-budget-wr-")),
	);
	const tempHome = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-budget-home-")),
	);

	writeFileSync(
		join(userDataDir, "settings.json"),
		JSON.stringify({
			version: 1,
			usageTelemetry: {
				enabled: true,
				includeUntracked: false,
				chipRange: "week",
				insights: { enabled: true, noticeShown: true },
			},
		}),
	);
	// A directory where the state file belongs: saveState can never succeed.
	mkdirSync(join(userDataDir, "usage-ledger.json"), { recursive: true });

	const app: ElectronApplication = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: repo.repoPath,
			AI14ALL_USER_DATA_PATH: userDataDir,
			AI14ALL_WHISPER_STATE_ROOT: whisperRoot,
			HOME: tempHome,
		},
	});
	const stderr: string[] = [];
	app.process().stderr?.on("data", (d) => void stderr.push(String(d)));

	const page: Page = await app.firstWindow({ timeout: 60_000 });
	await expect(page.getByRole("button", { name: "Browse" })).toBeVisible({
		timeout: 30_000,
	});
	await page.getByRole("button", { name: "Browse" }).click();
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		page.locator("main.shell-app:not(.shell-app--setup)"),
	).toBeVisible({ timeout: 30_000 });

	for (let i = 0; i < KILLS; i++) {
		await page.evaluate(() =>
			(
				window as unknown as {
					ai14all: {
						__insightsTest: { crashUsageWorker: () => Promise<unknown> };
					};
				}
			).ai14all.__insightsTest.crashUsageWorker(),
		);
		await page.waitForTimeout(700);
	}
	await page.waitForTimeout(3000);

	const out = stderr.join("");
	const reforks = (out.match(/re-forking \(attempt/g) ?? []).length;

	// No worker ever persisted, so none may claim readiness. The COUNT of these
	// is timing-dependent (initial sweep plus whatever periodic sweeps landed),
	// so only presence is pinned.
	expect(out).toContain("not reporting ready");
	// The re-fork count is NOT timing-dependent: with the budget never resetting,
	// KILLS(8) exits must produce exactly MAX_REFORKS(5) replacements and then
	// stop. `<=` would pass vacuously at 0, so pin the exact number.
	expect(reforks).toBe(MAX_REFORKS);
	expect(out).toContain("giving up on the automatic re-fork");

	await app.close().catch(() => {});
	rmSync(userDataDir, { recursive: true, force: true });
	rmSync(whisperRoot, { recursive: true, force: true });
	rmSync(tempHome, { recursive: true, force: true });
	repo.cleanup();
});
