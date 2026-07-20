/**
 * Task 14 — end-to-end coverage for the insights-capture module (spec §7).
 *
 * Launches the REAL built app (out/main/index.js) with a seeded whisper state.db
 * fixture and the AI14ALL_USER_DATA_PATH / AI14ALL_WHISPER_STATE_ROOT env seams
 * (electron/main/index.ts:89,271), then verifies the three user-visible
 * behaviours the spec promises, all filesystem-observable and/or driven through
 * the real window.ai14all contract:
 *
 *   1. Capture on consent, and consent-OFF stops it: a disabled relaunch never
 *      archives the extra workflow of an altered source.
 *   2. Durable acknowledgement: the first-capture notice appears, "Manage in
 *      Settings" acknowledges it, and a relaunch (still enabled, store kept)
 *      shows no notice — only a persisted ack can explain that.
 *   3. The LIVE Settings toggle stops capture against an altered source, and
 *      delete-all removes the store (db + WAL + SHM).
 *
 * Each stop assertion ALTERS the source (swaps in a 2-workflow fixture) so a
 * still-running worker WOULD archive a new observation, and fingerprints EVERY
 * file under insights/ (db + WAL + SHM), so a write hidden in insights.db-wal
 * (WAL mode, Task 10) is still observed.
 *
 * Notice-delivery note: insights:notice is fire-and-forget (no buffered replay),
 * and InsightsNotice only mounts on the loaded main shell. The worker's initial
 * boot-time notice therefore fires before any repository is loaded and is lost.
 * The host's documented at-least-once contract re-delivers an UNACKNOWLEDGED
 * notice on the next worker start (see insights-host.test.ts), so the notice
 * tests load a repo (mounting InsightsNotice), then restart the worker via the
 * real window.ai14all.insights.setEnabled seam to deterministically deliver the
 * notice while the listener is live — exercising the real re-delivery path.
 */
import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

const HERE = dirname(fileURLToPath(import.meta.url)); // ESM-safe; no __dirname

// Complete-enough settings.json: omitted top-level fields fall back to schema
// defaults on parse (PersistedSettingsV1Schema), and usageTelemetry.enabled=false
// makes isInsightsCaptureEnabled() false → the worker never forks (master kill).
const disabledSettings = JSON.stringify({
	version: 1,
	usageTelemetry: {
		enabled: false,
		includeUntracked: false,
		chipRange: "week",
		insights: { enabled: false, noticeShown: true },
	},
});

let repo: TestRepo;
let userDataDir: string;
let whisperRoot: string;

const insightsDir = () => join(userDataDir, "insights");
const storePath = () => join(insightsDir(), "insights.db");

// Fingerprint EVERY file under insights/ (db + WAL + SHM), so a write hidden in
// -wal is still observed. "<none>" when the directory does not exist yet.
const fingerprint = (): string => {
	try {
		return readdirSync(insightsDir(), { withFileTypes: true })
			.filter((e) => e.isFile())
			.map((e) => {
				const s = statSync(join(insightsDir(), e.name));
				return `${e.name}:${s.size}:${s.mtimeMs}`;
			})
			.sort()
			.join("|");
	} catch {
		return "<none>";
	}
};

const launch = (): Promise<ElectronApplication> =>
	electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: repo.repoPath,
			AI14ALL_USER_DATA_PATH: userDataDir,
			AI14ALL_WHISPER_STATE_ROOT: whisperRoot,
		},
	});

// Bring up the MAIN shell (so InsightsNotice mounts) from whichever startup
// screen the app shows: the fresh setup screen (Browse resolves to
// AI14ALL_E2E_PICK_PATH via ipc.ts repository:pickRoot, then Load), or — after a
// prior session persisted a workspace snapshot — the RestorePrompt (default
// restorePreference is "prompt"), where we restore the previous workspace. Both
// the setup and restore screens use `shell-app--setup`; the loaded shell does
// not, so `main.shell-app:not(.shell-app--setup)` is the "shell is live" signal.
async function ensureMainShell(page: Page): Promise<void> {
	const browse = page.getByRole("button", { name: "Browse" });
	const restore = page.getByRole("button", {
		name: /restore previous workspace/i,
	});
	await expect(browse.or(restore).first()).toBeVisible({ timeout: 30_000 });
	if ((await restore.count()) > 0) {
		await restore.click();
	} else {
		await browse.click();
		await expect(page.locator("#repo-path")).toHaveValue(repo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();
	}
	await expect(
		page.locator("main.shell-app:not(.shell-app--setup)"),
	).toBeVisible({ timeout: 30_000 });
}

// Restart the capture worker through the real IPC seam so an UNACKNOWLEDGED
// notice re-delivers while InsightsNotice is mounted (at-least-once contract).
// Persists insights.enabled false→true; global telemetry stays on, so the end
// state is ENABLED. noticeShown is never touched here, so a not-yet-acked notice
// re-fires and an acked one stays suppressed.
async function restartWorker(page: Page): Promise<void> {
	await page.evaluate(() => window.ai14all.insights.setEnabled(false));
	await page.evaluate(() => window.ai14all.insights.setEnabled(true));
}

const noticeLocator = (page: Page) => page.locator(".insights-notice");

test.beforeEach(() => {
	repo = createTestRepo();
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-insights-ud-")));
	whisperRoot = realpathSync(mkdtempSync(join(tmpdir(), "ofa-insights-wr-")));
	cpSync(
		join(HERE, "fixtures", "whisper-state-v7.db"),
		join(whisperRoot, "state.db"),
	); // 1 workflow
});

test.afterEach(() => {
	rmSync(userDataDir, { recursive: true, force: true });
	rmSync(whisperRoot, { recursive: true, force: true });
	repo.cleanup();
});

// (1) Renderer-independent: proves capture on consent, then that disabling consent
// stops it even when the source GAINS a workflow — no-new-capture, not merely
// idempotent idle. WAL-aware. No UI needed; the worker is gated by settings alone.
test("captures on consent; a disabled relaunch archives no new source workflows (db+WAL+SHM)", async () => {
	test.setTimeout(120_000);

	let app = await launch();
	await app.firstWindow({ timeout: 60_000 });
	// The worker creates insights.db on boot and archives wf1 on its first tick.
	await expect
		.poll(() => existsSync(storePath()), { timeout: 30_000 })
		.toBe(true);
	await new Promise((r) => setTimeout(r, 4_000)); // let the first archive settle
	await closeApp(app);

	writeFileSync(join(userDataDir, "settings.json"), disabledSettings); // consent OFF
	cpSync(
		join(HERE, "fixtures", "whisper-state-v7-2wf.db"),
		join(whisperRoot, "state.db"),
	); // ALTER source

	app = await launch();
	await app.firstWindow({ timeout: 60_000 });
	// The disabled worker never forks, so insights/ is frozen at the first app's
	// final state — a quiescent baseline captured now equals a later re-read
	// UNLESS a (bugged) live worker archives the extra workflow.
	const before = fingerprint();
	await new Promise((r) => setTimeout(r, 8_000)); // several 3s poll intervals
	const after = fingerprint();
	await closeApp(app);

	expect(before).not.toBe("<none>"); // the FIRST (enabled) app really captured
	expect(after).toBe(before); // consent OFF → nothing under insights/ (incl. -wal/-shm) changed
});

// (2) Durable ack across a relaunch (still enabled, store kept), so ONLY a
// persisted acknowledgement can suppress the notice — not a disabled worker or a
// deleted store.
test("acknowledgement durably suppresses the notice across a relaunch (still enabled, store kept)", async () => {
	test.setTimeout(180_000);

	let app = await launch();
	let page = await app.firstWindow({ timeout: 60_000 });
	await expect
		.poll(() => existsSync(storePath()), { timeout: 30_000 })
		.toBe(true);
	await ensureMainShell(page); // mount the main shell + InsightsNotice
	await restartWorker(page); // re-deliver the unacknowledged notice to the live listener

	await expect(noticeLocator(page)).toContainText(/usage insights/i);
	await page.getByRole("button", { name: /manage in settings/i }).click(); // opens Settings AND acknowledges
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await page.keyboard.press("Escape"); // close dialog; leave insights ENABLED and the store in place

	// Confirm the ack persisted before relaunching, so the next launch can only
	// have the durable marker (not an in-memory guard) to go on.
	await expect
		.poll(() =>
			page.evaluate(() =>
				window.ai14all.settings
					.read()
					.then((r) => r.settings.usageTelemetry.insights.noticeShown),
			),
		)
		.toBe(true);
	await closeApp(app);

	app = await launch();
	page = await app.firstWindow({ timeout: 60_000 });
	await expect
		.poll(() => existsSync(storePath()), { timeout: 30_000 })
		.toBe(true);
	await ensureMainShell(page);
	await restartWorker(page); // a still-unacked notice WOULD re-fire here; a durable ack must not
	await page.waitForTimeout(5_000);
	await expect(noticeLocator(page)).toHaveCount(0); // only the persisted ack explains this
	await closeApp(app);
});

// (3) The LIVE Settings toggle actually STOPS capture (not just persists a flag):
// after unchecking, altering the whisper source archives nothing; then delete-all
// removes db + WAL + SHM.
test("live Settings toggle stops capture against an altered source; delete-all removes db+WAL+SHM", async () => {
	test.setTimeout(180_000);

	const app = await launch();
	const page = await app.firstWindow({ timeout: 60_000 });
	const p = storePath();
	await expect.poll(() => existsSync(p), { timeout: 30_000 }).toBe(true);
	await new Promise((r) => setTimeout(r, 4_000)); // let the first archive settle
	await ensureMainShell(page);
	await restartWorker(page); // deliver the notice to the live listener so we can open Settings via it

	// Open Settings via the notice, then UNCHECK insights (real control →
	// settings:write → applyInsightsConsent → host.setEnabled(false)).
	await page.getByRole("button", { name: /manage in settings/i }).click();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await page.getByRole("checkbox", { name: /usage insights/i }).uncheck();
	await expect
		.poll(() =>
			page.evaluate(() =>
				window.ai14all.settings
					.read()
					.then((r) => r.settings.usageTelemetry.insights.enabled),
			),
		)
		.toBe(false);
	await page.waitForTimeout(1_000); // let the killed worker fully settle before the baseline

	// Alter the source (2-workflow fixture) WITHOUT relaunching. A broken live
	// consent apply would archive the extra workflow into insights/.
	const before = fingerprint();
	cpSync(
		join(HERE, "fixtures", "whisper-state-v7-2wf.db"),
		join(whisperRoot, "state.db"),
	);
	await page.waitForTimeout(8_000); // several 3s poll intervals
	expect(fingerprint()).toBe(before); // live toggle stopped the worker → nothing new (incl. -wal/-shm)

	// Delete insights data → db + WAL + SHM removed (host-owned; works while disabled).
	await page.getByRole("button", { name: /delete insights data/i }).click();
	await expect
		.poll(
			() => existsSync(p) || existsSync(`${p}-wal`) || existsSync(`${p}-shm`),
			{ timeout: 10_000 },
		)
		.toBe(false);
	await closeApp(app);
});
