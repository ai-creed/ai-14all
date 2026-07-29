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
 * boot-time notice therefore fires before any repository is loaded and reaches no
 * listener. The renderer recovers it via PULL-ON-MOUNT: when InsightsNotice mounts
 * on the loaded shell it asks the main process whether the one-time notice is
 * still pending (window.ai14all.insights.checkNoticePending → insights:noticePending
 * → InsightsHost.isNoticePending) and shows it if so. The notice tests below load a
 * repo and assert the banner appears through this real fresh-install delivery path —
 * no artificial worker restart.
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
	await ensureMainShell(page); // mount the loaded shell → InsightsNotice mounts and pulls

	// Real fresh-install delivery: the boot-time push was missed (shell not yet
	// mounted); the pull-on-mount recovers it. No artificial worker restart.
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
	await ensureMainShell(page); // pull-on-mount runs here; a still-unacked notice WOULD show
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
	await ensureMainShell(page); // pull-on-mount delivers the notice to the live listener

	// Open Settings via the notice (recovered through the real pull path), then
	// UNCHECK insights (real control → settings:write → applyInsightsConsent →
	// host.setEnabled(false)).
	await expect(noticeLocator(page)).toContainText(/usage insights/i);
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

// (4) App-focus/idle collector (spec §4/§6/§7), driven through the real IPC path
// via the bounded E2E seam (window.ai14all.__insightsTest). One continuous
// session covers: durability within a single poll interval BEFORE any
// blur/flush, no engaged-time inflation across a threshold-crossing poll, a
// forced worker crash replayed through the REAL exit-handler re-fork + outbox
// replay, a suspend→resume persisting a second uptime interval, and
// delete-while-enabled resuming capture on its own.
test("app-focus collector: durable within one poll, no engaged inflation, crash replay, resume, and delete-while-enabled", async () => {
	test.setTimeout(120_000);

	const app = await launch();
	const page = await app.firstWindow();
	await ensureMainShell(page);

	// Drive the collector through the bounded E2E seam with explicit timestamps
	// so the assertions are deterministic (no real 15 s waits). The base time is
	// read from the APP's own clock, not hard-coded: the collector opened its
	// uptime interval at real `Date.now()` on arm, so a fixed literal would sit
	// before/after that interval unpredictably across runs and pollute the
	// completeness assertions.
	const t0 = await page.evaluate(() => Date.now());
	const seam = async (type: string, arg: Record<string, number> = {}) =>
		page.evaluate(
			([t, a]) =>
				(
					window as unknown as {
						ai14all: {
							__insightsTest: {
								signal: (
									x: string,
									y: Record<string, number>,
								) => Promise<{ ok: boolean }>;
							};
						};
					}
				).ai14all.__insightsTest.signal(
					t as string,
					a as Record<string, number>,
				),
			[type, arg] as const,
		);
	const appTime = async (fromMs: number, toMs: number) => {
		const r = await page.evaluate(
			([f, t]) =>
				(
					window as unknown as {
						ai14all: {
							insights: {
								queryAppTime: (r: { fromMs: number; toMs: number }) => Promise<
									| {
											ok: true;
											data: {
												focusedMs: number;
												engagedMs: number;
												completeness: string;
											};
									  }
									| { ok: false; reason: string }
								>;
							};
						};
					}
				).ai14all.insights.queryAppTime({
					fromMs: f as number,
					toMs: t as number,
				}),
			[fromMs, toMs] as const,
		);
		if (!r.ok) {
			throw new Error("insights read failed: " + JSON.stringify(r));
		}
		return r.data;
	};

	// AC1: focus + ONE active poll must be durable BEFORE any blur/flush.
	await seam("focus", { atMs: t0 });
	await seam("idle", { atMs: t0 + 15_000, idleSeconds: 5 });
	await expect
		.poll(async () => (await appTime(t0, t0 + 60_000)).focusedMs, {
			timeout: 10_000,
		})
		.toBe(15_000);
	const first = await appTime(t0, t0 + 60_000);
	// Engaged is bounded [focusTime, pollTime - idleSeconds] = [t0, t0+10s].
	expect(first.engagedMs).toBe(10_000);

	// No inflation: a threshold-crossing poll adds nothing past the last input.
	await seam("idle", { atMs: t0 + 75_000, idleSeconds: 65 });
	await expect
		.poll(async () => (await appTime(t0, t0 + 120_000)).engagedMs, {
			timeout: 10_000,
		})
		.toBe(10_000);

	// Forced crash through the REAL exit handler, made deterministic by ARMING the
	// crash FIRST: the worker dies immediately before the next producer post, so
	// the span below can never have been inserted or acked pre-crash. It can only
	// reach the store via the host's own consent-gated re-fork + outbox replay —
	// no suppression, no manual restart, the production `exit` path throughout.
	// The hook's MECHANICS (kills before the post, buffers unacked, replays
	// config-first) are pinned by the Task 6 host regression, so a no-op hook
	// cannot make this aggregate assertion pass vacuously.
	await page.evaluate(() =>
		(
			window as unknown as {
				ai14all: { __insightsTest: { crashWorker: () => Promise<unknown> } };
			}
		).ai14all.__insightsTest.crashWorker(),
	); // arm — nothing has died yet
	await seam("idle", { atMs: t0 + 90_000, idleSeconds: 0 }); // kills, then buffers
	await expect
		.poll(async () => (await appTime(t0, t0 + 120_000)).focusedMs, {
			timeout: 15_000,
		})
		.toBe(90_000); // 15s + 60s + the REPLAYED 15s, counted exactly once

	// Suspend → resume must persist a SECOND uptime interval. Close it with a
	// flush so it is durable, then assert against the RESUMED window (a query
	// ending before the resume could never see the second interval).
	await seam("suspend", { atMs: t0 + 100_000 }); // closes interval 1
	await seam("resume", { atMs: t0 + 200_000 }); // opens interval 2
	await seam("flush", { atMs: t0 + 260_000 }); // closes interval 2
	await expect
		.poll(
			async () => (await appTime(t0 + 200_000, t0 + 260_000)).completeness,
			{ timeout: 10_000 },
		)
		.toBe("complete"); // only a persisted SECOND interval can certify this window
	// …and the sleep gap between the two intervals is never certified.
	expect((await appTime(t0, t0 + 260_000)).completeness).toBe("partial");

	// Delete-while-enabled: consent is untouched, so capture must resume by itself.
	await page.evaluate(() =>
		(
			window as unknown as {
				ai14all: { insights: { deleteAll: () => Promise<void> } };
			}
		).ai14all.insights.deleteAll(),
	);
	await expect
		.poll(async () => (await appTime(t0, t0 + 300_000)).focusedMs, {
			timeout: 10_000,
		})
		.toBe(0); // old data gone, no buffered pre-delete event reappears

	const t1 = t0 + 400_000;
	await seam("focus", { atMs: t1 });
	await seam("idle", { atMs: t1 + 15_000, idleSeconds: 0 });
	await expect
		.poll(async () => (await appTime(t1, t1 + 60_000)).focusedMs, {
			timeout: 10_000,
		})
		.toBe(15_000); // a NEW post-delete span reaches the fresh store
	// Re-assert the zero now that the store+worker are demonstrably live. The poll
	// above is only a liveness wait: `queryAppTime` also answers 0 from its empty
	// fallback when the re-forked worker is still cold or the query times out, so
	// on its own it can pass without ever reading the store. This range is disjoint
	// from the t1 span, so a real read must still return 0 — pure strengthening.
	expect((await appTime(t0, t0 + 300_000)).focusedMs).toBe(0);

	await closeApp(app);
});
