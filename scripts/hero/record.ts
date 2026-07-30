// scripts/hero/record.ts — the hero-video recorder orchestrator: stages the
// demo world (Task 6), drives the real built app via Playwright's `_electron`
// (arrange), captures a calibrated 2880x1520/60fps screencast through the
// storyboard's event loop (Task 5), gates on in-process source checks
// ("stage A"), and encodes hero-dist/master.mp4 + poster.png + storyboard.json.
// Not a Playwright spec — a standalone script (spec §4/§8; Global Constraints:
// nothing new under tests/e2e/).
import { execFileSync, execSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
	_electron as electron,
	type CDPSession,
	type ElectronApplication,
	type Locator,
	type Page,
} from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { stageHeroWorld, type HeroWorld } from "./stage.js";
import {
	calibrateClock,
	cdpToWallMs,
	type Calibration,
	type ClockSample,
} from "./clock.js";
import {
	CUE_TOLERANCE_SEC,
	FLEET_TIGHT,
	MASTER_DURATION,
	TOUR_DURATION,
	TOUR_OFFSET,
	tourToMaster,
	type CameraTarget,
	type HeroEvent,
} from "./storyboard.js";
import type { Rect } from "./gen-camera.js";
import type { CreateInput } from "../../services/review/review-comment-service.js";

const HERO_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERO_DIR, "..", "..");
const HERO_DIST_DIR = join(REPO_ROOT, "hero-dist");
const AGENT_PLAYER_PATH = join(HERO_DIR, "agent-player.mjs");
const DEMO_TESTS_TRANSCRIPT = join(HERO_DIR, "transcripts", "demo-tests.jsonl");
const DEMO_DEV_TRANSCRIPT = join(HERO_DIR, "transcripts", "demo-dev.jsonl");

type AgentName = "claude" | "codex" | "ezio";

// Sidebar accessible names include the worktree label (a slug derived from
// the worktree dir basename — parse-worktree-porcelain.ts) and/or the raw
// branch name; these substrings are unambiguous against either form.
const WORKTREE_NAME_RE: Record<AgentName, RegExp> = {
	claude: /checkout-retry/i,
	codex: /cart-badge/i,
	ezio: /api-examples/i,
};

// Repeated verbatim in every report_session_status push for a worktree's
// mission (MCP tool contract: same `task` across a mission's status pushes).
const TASKS: Record<AgentName, string> = {
	claude: "Implement checkout retry with backoff",
	codex: "Fix cart badge count",
	ezio: "Write API usage examples",
};

const INITIAL_SUMMARY: Record<AgentName, string> = {
	claude: "Implementing checkout retry with backoff",
	codex: "Fixing cart badge count",
	ezio: "Writing API usage examples",
};

// ---------------------------------------------------------------------------
// Small generic helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
	return new Promise((res) => setTimeout(res, ms));
}

async function waitUntilWallMs(targetWallMs: number): Promise<void> {
	const delay = targetWallMs - Date.now();
	if (delay > 0) await sleep(delay);
}

/** Generic polling gate: every arrange/cue-time UI wait goes through this or
 * `waitVisible` so a stuck condition fails with a specific, named error
 * instead of an opaque Playwright timeout. */
async function pollUntil<T>(
	name: string,
	fn: () => Promise<T>,
	predicate: (value: T) => boolean,
	timeoutMs = 30_000,
	intervalMs = 200,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await fn();
		if (predicate(value)) return value;
		if (Date.now() > deadline) {
			throw new Error(
				`[gate:${name}] timed out after ${timeoutMs}ms (last value: ${JSON.stringify(value)})`,
			);
		}
		await sleep(intervalMs);
	}
}

async function waitVisible(
	locator: Locator,
	name: string,
	timeoutMs = 30_000,
): Promise<void> {
	try {
		await locator.waitFor({ state: "visible", timeout: timeoutMs });
	} catch (err) {
		throw new Error(
			`[gate:${name}] timed out after ${timeoutMs}ms: ${(err as Error).message}`,
		);
	}
}

async function waitForFile(
	path: string,
	timeoutMs: number,
	name: string,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!existsSync(path)) {
		if (Date.now() > deadline) {
			throw new Error(
				`[gate:${name}] timed out after ${timeoutMs}ms waiting for ${path}`,
			);
		}
		await sleep(100);
	}
}

/**
 * The app spawns terminal shells as `$SHELL -l` (services/platform/default-
 * shell.ts) — a real login+interactive zsh. On macOS, `/etc/zprofile` (a
 * SYSTEM file, unaffected by ZDOTDIR) unconditionally runs `path_helper`,
 * which prepends every `/etc/paths.d/*` entry (Homebrew's installer drops
 * `/opt/homebrew/bin` there) ahead of whatever PATH the parent process
 * passed in — verified live: a PATH-prepended stub dir loses to the real
 * `claude`/`codex`/`ezio` binaries once the spawned shell finishes its own
 * startup. Fix: point ZDOTDIR at a scratch dir whose `.zprofile` re-prepends
 * the stub dir — that file is sourced AFTER `/etc/zprofile`'s path_helper
 * (login-shell order: /etc/zprofile, ~/.zprofile, /etc/zshrc, ~/.zshrc), so
 * it wins. Verified live against this exact path_helper/Homebrew collision.
 */
function setUpShellPathOverride(
	rootDir: string,
	stubBinDir: string,
): { zdotDir: string } {
	const zdotDir = mkdtempSync(join(rootDir, "hero-zdotdir-"));
	writeFileSync(
		join(zdotDir, ".zprofile"),
		`export PATH="${stubBinDir}:$PATH"\n`,
	);
	return { zdotDir };
}

function spawnCaffeinate(): void {
	try {
		const child = spawn("caffeinate", ["-dims", "-w", String(process.pid)], {
			detached: true,
			stdio: "ignore",
		});
		child.unref();
	} catch {
		console.warn(
			"[hero:record] caffeinate unavailable — the system may sleep mid-run",
		);
	}
}

// ---------------------------------------------------------------------------
// App-driving helpers (arrange + cue-time choreography)
// ---------------------------------------------------------------------------

function worktreeNav(page: Page): Locator {
	return page.getByRole("navigation", { name: "Worktree sessions" });
}

function worktreeRow(page: Page, nameRe: RegExp): Locator {
	return worktreeNav(page)
		.locator(".shell-sidebar__row")
		.filter({ has: page.getByRole("button", { name: nameRe }) });
}

async function switchToWorktree(page: Page, nameRe: RegExp): Promise<void> {
	await worktreeNav(page).getByRole("button", { name: nameRe }).first().click();
}

/** The seeded workspace-state.json restores every worktree with an EMPTY
 * default slot (slotProcessIds: [null], no auto-spawned shell) — restoring a
 * saved state replays exactly what was saved, unlike first-ever activation.
 * `slot-cta-0` fills it, same CTA pattern as the multi-slot layout's empty
 * slots 1/2. */
async function ensureDefaultShellSessionId(page: Page): Promise<string> {
	const cta = page.getByTestId("slot-cta-0");
	if (await cta.isVisible().catch(() => false)) {
		await cta.click();
	}
	await waitVisible(page.getByTestId("slot-0"), "slot-0-default-shell");
	return getSlotSessionId(page, 0);
}

async function getSlotSessionId(
	page: Page,
	slotIndex: number,
): Promise<string> {
	const sid = await page
		.locator(`[data-testid="slot-${slotIndex}"] .shell-terminal-pane`)
		.getAttribute("data-terminal-session-id");
	if (!sid) {
		throw new Error(`[arrange] slot-${slotIndex} has no terminal session id`);
	}
	return sid;
}

async function sendInput(
	page: Page,
	sessionId: string,
	data: string,
): Promise<void> {
	await page.evaluate(
		([sid, payload]) => window.ai14all.terminals.sendInput(sid, payload),
		[sessionId, data] as const,
	);
}

/** Idempotent open + file-select recipe (arrange step 2e and the on-cue
 * `open-review` ui-action share it verbatim — Task 7 brief). Deliberately
 * re-implemented rather than imported from tests/e2e/helpers/review-overlay.ts:
 * nothing under tests/e2e/ is a dependency of the hero pipeline. */
async function openReviewAndSelectCartBadge(page: Page): Promise<void> {
	const portal = page.locator('[data-testid="review-expanded-portal"]');
	if ((await portal.count()) > 0) {
		const leaving = await portal.getAttribute("data-leaving").catch(() => null);
		if (leaving === "true") {
			await portal
				.waitFor({ state: "detached", timeout: 5_000 })
				.catch(() => {});
		}
	}
	if (!(await portal.isVisible().catch(() => false))) {
		await page.getByRole("button", { name: /^open review$/i }).click();
	}
	await waitVisible(portal, "review-portal-open");
	await sleep(250); // 220ms slide-in CSS transition settle
	await portal
		.getByRole("tab", { name: "Changes" })
		.click({ force: true })
		.catch(() => {});
	const fileButton = portal.getByRole("button", {
		name: /src\/cart-badge\.ts/i,
	});
	await waitVisible(fileButton, "review-cart-badge-entry");
	await fileButton.click({ force: true });
}

async function measureRectDevicePx(locator: Locator): Promise<Rect> {
	const box = await locator.boundingBox();
	if (!box) throw new Error("[measure] boundingBox() returned null");
	return { x: box.x * 2, y: box.y * 2, w: box.width * 2, h: box.height * 2 };
}

/** Sidebar target is a TOP-ANCHORED SLICE, not the full measured pane: a
 * full-height sidebar rect saturates aspect normalization to a no-zoom
 * full-frame crop (Task 2 adjudication, carried into Task 7). Same x/y/w as
 * measured, fixed h = 520 device px (260 CSS px). */
async function measureSidebarRect(page: Page): Promise<Rect> {
	const box = await page.locator(".shell-sidebar").boundingBox();
	if (!box)
		throw new Error("[measure] .shell-sidebar boundingBox() returned null");
	return { x: box.x * 2, y: box.y * 2, w: box.width * 2, h: 520 };
}

async function measureUnionRectDevicePx(locators: Locator[]): Promise<Rect> {
	const boxes = await Promise.all(locators.map((l) => l.boundingBox()));
	const present = boxes.filter((b): b is NonNullable<typeof b> => b !== null);
	if (present.length === 0) {
		throw new Error("[measure] none of the given locators had a boundingBox()");
	}
	const minX = Math.min(...present.map((b) => b.x));
	const minY = Math.min(...present.map((b) => b.y));
	const maxX = Math.max(...present.map((b) => b.x + b.width));
	const maxY = Math.max(...present.map((b) => b.y + b.height));
	return {
		x: minX * 2,
		y: minY * 2,
		w: (maxX - minX) * 2,
		h: (maxY - minY) * 2,
	};
}

async function closeElectronApp(
	app: ElectronApplication | undefined,
): Promise<void> {
	if (!app) return;
	const proc = app.process();
	await Promise.race([app.close(), sleep(5_000)]);
	if (!proc.killed) proc.kill("SIGKILL");
	await sleep(500);
}

// ---------------------------------------------------------------------------
// MCP client helpers (session-attention.spec.ts:232-279 pattern)
// ---------------------------------------------------------------------------

type McpReportArgs = {
	worktreePath: string;
	state: "active" | "waiting" | "ready" | "failed";
	summary: string;
	nextAction: string | null;
	task?: string | null;
};
type McpReportResult = { ok?: boolean; error?: string; worktreeId?: string };

async function readMcpPort(userDataDir: string): Promise<string> {
	const portPath = join(userDataDir, "ai-14all", "mcp-port");
	const deadline = Date.now() + 30_000;
	for (;;) {
		if (existsSync(portPath)) {
			const value = readFileSync(portPath, "utf8").trim();
			if (value) return value;
		}
		if (Date.now() > deadline) {
			throw new Error(
				`[gate:mcp-port] timed out after 30000ms waiting for ${portPath}`,
			);
		}
		await sleep(200);
	}
}

async function callReportSessionStatus(
	client: Client,
	args: McpReportArgs,
): Promise<McpReportResult> {
	const result = await client.callTool({
		name: "report_session_status",
		arguments: args as unknown as Record<string, unknown>,
	});
	const content = result.content as Array<{ text: string }>;
	return JSON.parse(content[0]!.text) as McpReportResult;
}

/** Arrange-time only: retries through renderer_not_ready/bridge_timeout AND
 * no_worktree (the worktree may not be resolvable yet this early). */
async function reportUntilBridgeReady(
	client: Client,
	page: Page,
	args: McpReportArgs,
): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt++) {
		const parsed = await callReportSessionStatus(client, args);
		if (parsed.ok === true) return;
		if (
			parsed.error === "renderer_not_ready" ||
			parsed.error === "bridge_timeout" ||
			parsed.error === "no_worktree"
		) {
			await page.waitForTimeout(250);
			continue;
		}
		throw new Error(
			`[mcp:${args.worktreePath}] unexpected error: ${JSON.stringify(parsed)}`,
		);
	}
	throw new Error(
		`[gate:mcp-bridge-ready:${args.worktreePath}] timed out after 40 attempts`,
	);
}

/** Cue-time: bridge is already warm from arrange — a single attempt, hard
 * failure on anything but ok:true. */
async function mcpReportAtCue(
	client: Client,
	args: McpReportArgs,
): Promise<void> {
	const result = await callReportSessionStatus(client, args);
	if (result.ok !== true) {
		throw new Error(
			`[cue:${args.worktreePath}] report_session_status failed: ${JSON.stringify(result)}`,
		);
	}
}

// ---------------------------------------------------------------------------
// Marks file (Task 3 shim markers)
// ---------------------------------------------------------------------------

type Mark = { marker: string; t: number };

function readMarks(path: string): Mark[] {
	// world.marksPath may not exist until claude's first marker write.
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Mark);
}

// ---------------------------------------------------------------------------
// Capture: calibration, event loop, frame collection
// ---------------------------------------------------------------------------

type RetainedFrame = { cdpTimestamp: number; data: Buffer };

type CaptureResult = {
	cal: Calibration;
	frames: RetainedFrame[];
	M0wall: number;
	executedMasterById: Map<string, number>;
	posterCapturedMaster: number;
	marks: Mark[];
};

function reviewCommentPayload(world: HeroWorld): CreateInput {
	return {
		worktreeId: world.worktrees.codex,
		filePath: "src/cart-badge.ts",
		startLine: 3,
		endLine: 3,
		snippet: "const BADGE_MAX = 99;",
		body: "Nice fix — extract BADGE_MAX into a shared constant?",
		source: "working-tree",
		commitSha: null,
	};
}

type DispatchCtx = {
	page: Page;
	electronApp: ElectronApplication;
	mcpClient: Client;
	world: HeroWorld;
	cdpSession: CDPSession;
	dispatchWallNow: number;
};

async function dispatchEvent(
	event: HeroEvent,
	ctx: DispatchCtx,
): Promise<void> {
	switch (event.id) {
		case "ezio-waiting":
			await mcpReportAtCue(ctx.mcpClient, {
				worktreePath: ctx.world.worktrees.ezio,
				state: "waiting",
				summary: "Which client should the examples use?",
				nextAction: "answer in terminal",
				task: TASKS.ezio,
			});
			return;
		case "commit-line":
			// Opens claude's fixed 800ms burst; executedMaster is filled in later
			// from the marks file entry the burst's marker line writes.
			writeFileSync(
				join(ctx.world.gateDir, "fleet-burst"),
				String(ctx.dispatchWallNow),
			);
			return;
		case "switch-codex":
			await switchToWorktree(ctx.page, WORKTREE_NAME_RE.codex);
			await waitVisible(
				ctx.page.getByTestId("slot-0"),
				"switch-codex-pane-visible",
			);
			return;
		case "open-review":
			await openReviewAndSelectCartBadge(ctx.page);
			return;
		case "review-comment":
			await ctx.electronApp.evaluate((_electron, payload) => {
				return (
					globalThis as unknown as {
						__AI14ALL_E2E_HOOKS__: {
							injectReviewComment: (i: unknown) => Promise<unknown>;
						};
					}
				).__AI14ALL_E2E_HOOKS__.injectReviewComment(payload);
			}, reviewCommentPayload(ctx.world));
			return;
		case "codex-burst":
			writeFileSync(
				join(ctx.world.gateDir, "pullback-burst"),
				String(ctx.dispatchWallNow),
			);
			return;
		case "codex-ready":
			await mcpReportAtCue(ctx.mcpClient, {
				worktreePath: ctx.world.worktrees.codex,
				state: "ready",
				summary: "Cart badge fix done",
				nextAction: "review diff",
				task: TASKS.codex,
			});
			return;
		case "poster": {
			const shot = await ctx.cdpSession.send("Page.captureScreenshot", {
				format: "png",
			});
			writeFileSync(
				join(HERO_DIST_DIR, "poster.png"),
				Buffer.from(shot.data, "base64"),
			);
			return;
		}
	}
}

async function recordCapture(
	cdpSession: CDPSession,
	world: HeroWorld,
	page: Page,
	electronApp: ElectronApplication,
	mcpClient: Client,
): Promise<CaptureResult> {
	const warmupSamples: ClockSample[] = [];
	let warmupStartWall = 0;
	let cal: Calibration | null = null;
	let calibrationSettled = false;
	let M0cdp: number | null = null;
	let M0wall = 0;
	const retainedFrames: RetainedFrame[] = [];

	let resolveCalibration!: () => void;
	let rejectCalibration!: (err: Error) => void;
	const calibrationPromise = new Promise<void>((res, rej) => {
		resolveCalibration = res;
		rejectCalibration = rej;
	});
	let resolveM0!: () => void;
	const m0Promise = new Promise<void>((res) => {
		resolveM0 = res;
	});

	cdpSession.on("Page.screencastFrame", (evt) => {
		const wallClockAtReceipt = Date.now();
		const cdpTimestamp = evt.metadata.timestamp ?? 0;
		cdpSession
			.send("Page.screencastFrameAck", { sessionId: evt.sessionId })
			.catch(() => {});

		if (!calibrationSettled) {
			warmupSamples.push({ cdpTimestamp, wallClockAtReceipt });
			if (
				warmupSamples.length >= 5 &&
				wallClockAtReceipt - warmupStartWall >= 1000
			) {
				calibrationSettled = true;
				try {
					const computed = calibrateClock(warmupSamples);
					if (computed.residualSpreadMs > 50) {
						throw new Error(
							`clock calibration residual ${computed.residualSpreadMs.toFixed(1)}ms exceeds the 50ms budget`,
						);
					}
					cal = computed;
					resolveCalibration();
				} catch (err) {
					rejectCalibration(err as Error);
				}
			}
			return;
		}
		if (!cal) return; // calibration failed — drop further frames
		if (M0cdp === null) {
			M0cdp = cdpTimestamp;
			M0wall = cdpToWallMs(cdpTimestamp, cal);
			retainedFrames.push({
				cdpTimestamp,
				data: Buffer.from(evt.data, "base64"),
			});
			resolveM0();
			return;
		}
		retainedFrames.push({
			cdpTimestamp,
			data: Buffer.from(evt.data, "base64"),
		});
	});

	warmupStartWall = Date.now();
	await cdpSession.send("Page.startScreencast", {
		format: "jpeg",
		quality: 95,
		everyNthFrame: 1,
	});
	await calibrationPromise;
	if (!cal) throw new Error("clock calibration failed");
	await m0Promise;

	const executedMasterById = new Map<string, number>();
	let posterCapturedMaster = 0;

	// Copy before sorting — FLEET_TIGHT.events must not be mutated in place.
	const dispatches = FLEET_TIGHT.events
		.map((event) => {
			const nominalMaster = tourToMaster(event.cueTargetTour);
			const dispatchMaster =
				event.id === "commit-line" ? nominalMaster - 0.8 : nominalMaster;
			return { event, dispatchMaster };
		})
		.sort((a, b) => a.dispatchMaster - b.dispatchMaster);

	for (const { event, dispatchMaster } of dispatches) {
		await waitUntilWallMs(M0wall + dispatchMaster * 1000);
		// Dispatch time is sampled immediately before issuing the async call —
		// not after it resolves (spec §5 dispatch-time semantics).
		const dispatchWallNow = Date.now();
		const executedMaster = (dispatchWallNow - M0wall) / 1000;
		await dispatchEvent(event, {
			page,
			electronApp,
			mcpClient,
			world,
			cdpSession,
			dispatchWallNow,
		});
		if (event.id === "poster") posterCapturedMaster = executedMaster;
		if (event.id !== "commit-line")
			executedMasterById.set(event.id, executedMaster);
	}

	await waitUntilWallMs(M0wall + (MASTER_DURATION + 0.2) * 1000);
	await cdpSession.send("Page.stopScreencast");
	await sleep(200);

	const marks = readMarks(world.marksPath);
	const commitMark = marks.find((m) => m.marker === "commit-line");
	if (commitMark) {
		executedMasterById.set("commit-line", (commitMark.t - M0wall) / 1000);
	}

	return {
		cal,
		frames: retainedFrames,
		M0wall,
		executedMasterById,
		posterCapturedMaster,
		marks,
	};
}

// ---------------------------------------------------------------------------
// Stage A — in-process source checks, before any encoding
// ---------------------------------------------------------------------------

type StageAResult = { ok: boolean; errors: string[] };

const ALL_CAMERA_TARGETS: CameraTarget[] = [
	"full",
	"sidebar",
	"terminal-grid",
	"review-surface",
];

function runStageAChecks(
	capture: CaptureResult,
	targetRects: Partial<Record<CameraTarget, Rect | null>>,
): StageAResult {
	const errors: string[] = [];

	if (capture.cal.residualSpreadMs > 50) {
		errors.push(
			`clock calibration residual ${capture.cal.residualSpreadMs.toFixed(1)}ms exceeds 50ms`,
		);
	}

	const masterTimes = capture.frames.map(
		(f) => (cdpToWallMs(f.cdpTimestamp, capture.cal) - capture.M0wall) / 1000,
	);
	for (const w of FLEET_TIGHT.motionWindows) {
		const inWindow = masterTimes
			.filter((t) => t >= w.startMaster && t <= w.endMaster)
			.sort((a, b) => a - b);
		if (inWindow.length < 2) {
			errors.push(
				`motion window [${w.startMaster},${w.endMaster}]: only ${inWindow.length} frame(s) captured`,
			);
			continue;
		}
		let maxGapMs = 0;
		for (let i = 1; i < inWindow.length; i++) {
			maxGapMs = Math.max(maxGapMs, (inWindow[i]! - inWindow[i - 1]!) * 1000);
		}
		const spanSec = inWindow[inWindow.length - 1]! - inWindow[0]!;
		const meanCadenceHz = spanSec > 0 ? (inWindow.length - 1) / spanSec : 0;
		if (maxGapMs > 150) {
			errors.push(
				`motion window [${w.startMaster},${w.endMaster}]: max inter-frame gap ${maxGapMs.toFixed(1)}ms exceeds 150ms`,
			);
		}
		if (meanCadenceHz < 30) {
			errors.push(
				`motion window [${w.startMaster},${w.endMaster}]: mean cadence ${meanCadenceHz.toFixed(1)}Hz below 30Hz`,
			);
		}
	}

	if (!capture.marks.some((m) => m.marker === "commit-line")) {
		errors.push("commit-line marker missing from marks file");
	}

	// "full" is deliberately null (whole-frame, no crop) — every OTHER target
	// must have a genuinely measured, in-bounds rect.
	for (const target of ALL_CAMERA_TARGETS) {
		if (target === "full") continue;
		const rect = targetRects[target];
		if (
			!rect ||
			rect.w <= 0 ||
			rect.h <= 0 ||
			rect.x < 0 ||
			rect.y < 0 ||
			rect.x + rect.w > 2880 ||
			rect.y + rect.h > 1520
		) {
			errors.push(
				`camera target rect '${target}' missing or out of frame bounds: ${JSON.stringify(rect)}`,
			);
		}
	}

	for (const event of FLEET_TIGHT.events) {
		const executed = capture.executedMasterById.get(event.id);
		const target = tourToMaster(event.cueTargetTour);
		if (executed === undefined) {
			errors.push(`event '${event.id}' has no recorded executedMaster`);
			continue;
		}
		const tolerance = event.kind === "ui-action" ? 0.5 : CUE_TOLERANCE_SEC;
		const delta = Math.abs(executed - target);
		if (delta > tolerance) {
			errors.push(
				`event '${event.id}' (${event.kind}) executed at ${executed.toFixed(3)}s, target ${target.toFixed(3)}s, delta ${delta.toFixed(3)}s exceeds ±${tolerance}s`,
			);
		}
	}

	return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Frame output + encode
// ---------------------------------------------------------------------------

function frameFileName(index: number): string {
	return `frame-${String(index + 1).padStart(6, "0")}.jpg`;
}

function writeFrames(frames: RetainedFrame[]): void {
	const framesDir = join(HERO_DIST_DIR, "frames");
	mkdirSync(framesDir, { recursive: true });
	frames.forEach((frame, i) => {
		writeFileSync(join(framesDir, frameFileName(i)), frame.data);
	});
	writeFileSync(
		join(HERO_DIST_DIR, "frame-times.json"),
		JSON.stringify(
			frames.map((f) => f.cdpTimestamp),
			null,
			"\t",
		) + "\n",
	);
}

function escapeConcatPath(p: string): string {
	return p.replace(/'/g, "'\\''");
}

function encodeMaster(frames: RetainedFrame[]): void {
	const framesDir = join(HERO_DIST_DIR, "frames");
	const deltas: number[] = [];
	for (let i = 0; i < frames.length - 1; i++) {
		deltas.push(frames[i + 1]!.cdpTimestamp - frames[i]!.cdpTimestamp);
	}
	const meanDelta =
		deltas.length > 0
			? deltas.reduce((a, b) => a + b, 0) / deltas.length
			: 1 / 60;

	const lines: string[] = [];
	for (let i = 0; i < frames.length; i++) {
		const filePath = join(framesDir, frameFileName(i));
		const isLast = i === frames.length - 1;
		const duration = isLast
			? meanDelta
			: frames[i + 1]!.cdpTimestamp - frames[i]!.cdpTimestamp;
		lines.push(`file '${escapeConcatPath(filePath)}'`);
		lines.push(`duration ${duration.toFixed(6)}`);
		// The concat demuxer ignores the LAST listed duration — repeat the
		// final frame's file entry so its hold isn't dropped.
		if (isLast) lines.push(`file '${escapeConcatPath(filePath)}'`);
	}
	const listPath = join(HERO_DIST_DIR, "concat-list.txt");
	writeFileSync(listPath, lines.join("\n") + "\n");

	execFileSync(
		"ffmpeg",
		[
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			listPath,
			"-vf",
			"fps=60,format=yuv420p",
			"-c:v",
			"libx264",
			"-crf",
			"17",
			"-preset",
			"medium",
			"-an",
			"-t",
			String(MASTER_DURATION),
			"-y",
			join(HERO_DIST_DIR, "master.mp4"),
		],
		{ stdio: "inherit" },
	);
}

// ---------------------------------------------------------------------------
// storyboard.json
// ---------------------------------------------------------------------------

type AsExecutedStoryboard = {
	tourOffset: 2.0;
	tourDuration: 21;
	masterDuration: number;
	beats: Array<{
		beat: string;
		settleTour: number;
		holdSec: number;
		rect: Rect | null;
	}>;
	events: Array<{
		id: string;
		kind: string;
		cueTargetTour: number;
		executedMaster: number;
	}>;
	motionWindows: Array<{ startMaster: number; endMaster: number }>;
	provenance: {
		appVersion: string;
		gitSha: string;
		recordedAt: string;
		clockOffsetMs: number;
		clockResidualMs: number;
		posterCapturedMaster: number;
	};
};

function writeStoryboard(
	capture: CaptureResult,
	targetRects: Partial<Record<CameraTarget, Rect | null>>,
): void {
	const pkg = JSON.parse(
		readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
	) as {
		version: string;
	};
	const gitSha = execSync("git rev-parse HEAD", { cwd: REPO_ROOT })
		.toString()
		.trim();
	const lastFrame = capture.frames[capture.frames.length - 1];
	const masterDuration = lastFrame
		? (cdpToWallMs(lastFrame.cdpTimestamp, capture.cal) - capture.M0wall) / 1000
		: 0;

	const storyboard: AsExecutedStoryboard = {
		tourOffset: TOUR_OFFSET as 2.0,
		tourDuration: TOUR_DURATION as 21,
		masterDuration,
		beats: FLEET_TIGHT.beats.map((beat) => ({
			beat: beat.beat,
			settleTour: beat.settleTour,
			holdSec: beat.holdSec,
			rect: beat.target === "full" ? null : (targetRects[beat.target] ?? null),
		})),
		events: FLEET_TIGHT.events.map((event) => ({
			id: event.id,
			kind: event.kind,
			cueTargetTour: event.cueTargetTour,
			executedMaster: capture.executedMasterById.get(event.id) ?? -1,
		})),
		motionWindows: FLEET_TIGHT.motionWindows.map((w) => ({ ...w })),
		provenance: {
			appVersion: pkg.version,
			gitSha,
			recordedAt: new Date().toISOString(),
			clockOffsetMs: capture.cal.offsetMs,
			clockResidualMs: capture.cal.residualSpreadMs,
			posterCapturedMaster: capture.posterCapturedMaster,
		},
	};
	writeFileSync(
		join(HERO_DIST_DIR, "storyboard.json"),
		JSON.stringify(storyboard, null, "\t") + "\n",
	);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function arrange(
	page: Page,
	world: HeroWorld,
): Promise<{
	targetRects: Partial<Record<CameraTarget, Rect | null>>;
	mcpClient: Client;
}> {
	await pollUntil(
		"workspace-hydrated",
		() => page.locator(".shell-sidebar__row").count(),
		(n) => n >= 3,
	);

	const targetRects: Partial<Record<CameraTarget, Rect | null>> = {
		full: null,
	};
	targetRects.sidebar = await measureSidebarRect(page);

	for (const name of ["claude", "codex", "ezio"] as const) {
		await switchToWorktree(page, WORKTREE_NAME_RE[name]);
		const sid = await ensureDefaultShellSessionId(page);
		await sendInput(page, sid, `${name}\r`);
		await pollUntil(
			`provider-badge-${name}`,
			() =>
				worktreeRow(page, WORKTREE_NAME_RE[name])
					.locator(`.shell-sidebar__provider-badge[data-provider="${name}"]`)
					.count(),
			(n) => n >= 1,
		);
	}

	// Multi-slot layout + demo players, on the claude worktree.
	await switchToWorktree(page, WORKTREE_NAME_RE.claude);
	await page.getByTestId("terminal-layout-button").click();
	await waitVisible(page.getByTestId("layout-tile-3-v"), "layout-tile-3-v");
	await page.getByTestId("layout-tile-3-v").click();
	await waitVisible(page.getByTestId("slot-cta-1"), "slot-cta-1");
	await waitVisible(page.getByTestId("slot-cta-2"), "slot-cta-2");

	await page.getByTestId("slot-cta-1").click();
	await waitVisible(page.getByTestId("slot-1"), "slot-1-filled");
	const slot1Sid = await getSlotSessionId(page, 1);
	await sendInput(
		page,
		slot1Sid,
		`node "${AGENT_PLAYER_PATH}" --transcript "${DEMO_TESTS_TRANSCRIPT}" --loop\r`,
	);

	await page.getByTestId("slot-cta-2").click();
	await waitVisible(page.getByTestId("slot-2"), "slot-2-filled");
	const slot2Sid = await getSlotSessionId(page, 2);
	await sendInput(
		page,
		slot2Sid,
		`node "${AGENT_PLAYER_PATH}" --transcript "${DEMO_DEV_TRANSCRIPT}" --loop\r`,
	);

	targetRects["terminal-grid"] = await measureUnionRectDevicePx([
		page.locator('[data-testid="slot-0"]'),
		page.locator('[data-testid="slot-1"]'),
		page.locator('[data-testid="slot-2"]'),
	]);

	// MCP: connect + push the initial "active" task line per worktree.
	const mcpPort = await readMcpPort(world.userDataDir);
	const mcpClient = new Client({ name: "hero-recorder", version: "1.0.0" });
	await mcpClient.connect(
		new StreamableHTTPClientTransport(
			new URL(`http://127.0.0.1:${mcpPort}/mcp`),
		),
	);
	for (const name of ["claude", "codex", "ezio"] as const) {
		await reportUntilBridgeReady(mcpClient, page, {
			worktreePath: world.worktrees[name],
			state: "active",
			summary: INITIAL_SUMMARY[name],
			nextAction: null,
			task: TASKS[name],
		});
	}

	// Review-surface rect: measure then restore — the overlay stays CLOSED
	// until the on-cue `open-review` choreography re-opens it at tour 13.0.
	await switchToWorktree(page, WORKTREE_NAME_RE.codex);
	await openReviewAndSelectCartBadge(page);
	targetRects["review-surface"] = await measureRectDevicePx(
		page.locator('[data-testid="review-expanded-portal"]'),
	);
	await page.keyboard.press("Escape");
	await page
		.locator('[data-testid="review-expanded-portal"]')
		.waitFor({ state: "detached", timeout: 5_000 })
		.catch(() => {});
	await switchToWorktree(page, WORKTREE_NAME_RE.claude);
	await waitVisible(
		page.locator('[data-testid="slot-0"]'),
		"slot-0-after-review",
	);
	await waitVisible(
		page.locator('[data-testid="slot-1"]'),
		"slot-1-after-review",
	);
	await waitVisible(
		page.locator('[data-testid="slot-2"]'),
		"slot-2-after-review",
	);

	// Gate handshake: claude and codex's shims must be PARKED at their gates
	// before warmup/M0 may start, or a short arrange would open a gate before
	// the player reaches it and the burst would fire late.
	await waitForFile(
		join(world.gateDir, "fleet-burst.waiting"),
		30_000,
		"fleet-burst-waiting",
	);
	await waitForFile(
		join(world.gateDir, "pullback-burst.waiting"),
		30_000,
		"pullback-burst-waiting",
	);

	// Let the renderer fully settle before capture begins. KNOWN RISK (traced
	// with a PerformanceObserver("longtask") + a CDP-frame-gap probe, not
	// fixable from here): the ezio-waiting cue flips ezio's sidebar row to
	// `data-attention="actionRequired"`, which starts
	// `shell-sidebar-action-glow 1.4s ease-in-out infinite`
	// (src/styles/modules/sidebar.css) — an INFINITE, never-reverted
	// box-shadow animation. box-shadow forces paint, not just GPU composite,
	// so the animation's first application costs the compositor/paint
	// pipeline real time. Confirmed NOT a renderer JS/React block: the MCP
	// round trip itself takes ~10ms and zero PerformanceObserver longtasks
	// fire, yet a real ~250-265ms gap still shows up between consecutive CDP
	// `Page.screencastFrame` deliveries at that instant, occasionally enough
	// to blow the ezio-waiting cue's [6,8] motion-window 150ms
	// inter-frame-gap budget (disabling that one dispatch makes the window
	// pass cleanly every time — root cause confirmed, not incidental; the
	// [21,23] window's codex-ready cue doesn't reproduce this because the
	// review overlay, open since master 15, occludes the sidebar by then).
	// No caller-side workaround eliminates it short of not reporting "waiting"
	// at all (which would defeat the cue) — this is a paint-pipeline cost of
	// the app's own CSS choice, and app-code changes are out of this task's
	// scope (restricted to the Task 4 review seam). Two driver-side
	// mitigations were tried and both failed to eliminate it, narrowing the
	// cost further: (1) pre-triggering the same animation off-camera, both
	// early in arrange and immediately before capture — no reliable help,
	// ruling out a cold-cache/first-use explanation, since the cost recurs
	// per transition, not per session; (2) injecting `will-change: box-shadow`
	// on `.shell-sidebar__row` via `page.addStyleTag` to make the compositor
	// pre-allocate the row's paint layer — also no reliable help, meaning the
	// dominant cost is the shadow's own rasterization on each keyframe step,
	// not one-time layer-allocation overhead that `will-change` avoids. This
	// settle delay is a best-effort buffer, not a guarantee; per spec §7 the
	// sanctioned recovery for an occasional stage-A miss is "run it again."
	await page.waitForTimeout(1500);

	return { targetRects, mcpClient };
}

async function main(): Promise<void> {
	spawnCaffeinate();
	mkdirSync(HERO_DIST_DIR, { recursive: true });

	const world = stageHeroWorld(tmpdir());
	const { zdotDir } = setUpShellPathOverride(tmpdir(), world.stubBinDir);
	let electronApp: ElectronApplication | undefined;
	let mcpClient: Client | undefined;

	try {
		electronApp = await electron.launch({
			args: ["out/main/index.js"],
			cwd: REPO_ROOT,
			env: {
				...process.env,
				AI14ALL_E2E: "1",
				AI14ALL_USER_DATA_PATH: world.userDataDir,
				AI14ALL_WORKSPACE_STATE_PATH: world.workspaceStatePath,
				AI14ALL_FAKE_AGENT_CLIS: "claude,codex,ezio",
				HERO_MARKS_PATH: world.marksPath,
				HERO_GATE_DIR: world.gateDir,
				PATH: `${world.stubBinDir}:${process.env.PATH}`,
				ZDOTDIR: zdotDir,
			},
		});
		const page = await electronApp.firstWindow({ timeout: 60_000 });

		// Capture recipe (spike-verified — Emulation override, then zoom, then
		// settle) runs BEFORE arrange: every boundingBox() measurement arrange
		// takes must be measured against the SAME 2880x1520/zoom-2 geometry the
		// screencast will capture, or camera-target rects come out sized for
		// the wrong (default window) viewport.
		const cdpSession = await page.context().newCDPSession(page);
		await cdpSession.send("Page.enable");
		await cdpSession.send("Emulation.setDeviceMetricsOverride", {
			width: 2880,
			height: 1520,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await electronApp.evaluate(({ BrowserWindow }) => {
			BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2);
		});
		await sleep(1000);

		const { targetRects, mcpClient: client } = await arrange(page, world);
		mcpClient = client;

		const capture = await recordCapture(
			cdpSession,
			world,
			page,
			electronApp,
			mcpClient,
		);

		writeFrames(capture.frames);

		const stageA = runStageAChecks(capture, targetRects);
		if (!stageA.ok) {
			console.error(`[stage-A] FAIL — ${stageA.errors.length} issue(s):`);
			for (const err of stageA.errors) console.error("[stage-A]", err);
			process.exitCode = 1;
			return;
		}
		console.log(
			`[stage-A] PASS — residual ${capture.cal.residualSpreadMs.toFixed(1)}ms, ${capture.frames.length} frames retained`,
		);

		encodeMaster(capture.frames);
		writeStoryboard(capture, targetRects);
		console.log(`[hero:record] done — ${HERO_DIST_DIR}`);
	} finally {
		if (mcpClient) await mcpClient.close().catch(() => {});
		await closeElectronApp(electronApp);
		world.cleanup();
		rmSync(zdotDir, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error("[hero:record] fatal:", err);
	process.exitCode = 1;
});
