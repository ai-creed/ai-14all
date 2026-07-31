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

import {
	stageHeroWorld,
	DEV_SERVER_COMMAND,
	WATCH_TESTS_COMMAND,
	type HeroWorld,
} from "./stage.js";
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
import { DEFAULT_MARGIN_FRAC, type Rect } from "./gen-camera.js";
import type { CreateInput } from "../../services/review/review-comment-service.js";

const HERO_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERO_DIR, "..", "..");
const HERO_DIST_DIR = join(REPO_ROOT, "hero-dist");

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
	// A single setTimeout(delay) can fire up to ~1ms early (timer truncation +
	// the fractional part of M0wall) — loop until the wall clock has actually
	// crossed the target instead of trusting one sleep to land on-or-after it.
	while (Date.now() < targetWallMs) {
		await sleep(Math.max(1, Math.ceil(targetWallMs - Date.now())));
	}
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
 *
 * The same ZDOTDIR also carries a `.zshrc` that overrides the PROMPT. macOS's
 * `/etc/zshrc` sets `PS1="%n@%m %1~ %# "` — a real username and hostname,
 * legible in every terminal pane for the whole tour, which spec §9's
 * claims-safety checklist forbids on camera. `/etc/zshrc` is sourced AFTER
 * `$ZDOTDIR/.zprofile` (so the prompt cannot be fixed there) and BEFORE
 * `$ZDOTDIR/.zshrc`, so `.zshrc` is the only file in the scratch ZDOTDIR that
 * wins. `%1~` keeps the worktree/branch dir name — that part is good demo
 * content — and drops `%n@%m`. PATH is untouched by `/etc/zshrc`, so the
 * shims still resolve first (verified live). The same `.zshrc` clears
 * PROMPT_EOL_MARK — see the comment on the write below.
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
	// PROMPT_EOL_MARK='' suppresses zsh's reverse-video "%" partial-line marker.
	// zsh prints it whenever the previous command's output does not end in a
	// newline — which is every pane the transcript player drives, because it
	// parks on a spinner chunk. The marker lands as the first cell of the
	// scrollback, sits on camera for the whole tour, and is magnified at the
	// sidebar beat's deepest zoom stop.
	writeFileSync(
		join(zdotDir, ".zshrc"),
		"PROMPT='%1~ %# '\nPROMPT_EOL_MARK=''\n",
	);
	return { zdotDir };
}

// Every file any stage of the pipeline writes into hero-dist/. `tour.mp4` and
// `tour-filter.txt` are hero:render's outputs, cleared here too: without that,
// a failed record followed by a standalone `hero:record` + `hero:validate`
// (both documented in the README) would let stage B PASS a stale tour from an
// unrelated capture and ship it beside a mismatched storyboard/poster.
const STALE_HERO_DIST_ENTRIES = [
	"master.mp4",
	"tour.mp4",
	"tour-filter.txt",
	"poster.png",
	"storyboard.json",
	"frame-times.json",
	"concat-list.txt",
	"calibration-failure.json",
];

/** A failed run's leftovers must never mix with a later run's — clear
 * `frames/` plus every entry in STALE_HERO_DIST_ENTRIES at the start of every
 * run (not just on success), then recreate the directory fresh. Without this,
 * a failed run's frames/frame-times/poster can splice against a stale
 * master/tour/storyboard from an earlier, unrelated run. */
function clearHeroDist(): void {
	rmSync(join(HERO_DIST_DIR, "frames"), { recursive: true, force: true });
	for (const name of STALE_HERO_DIST_ENTRIES) {
		rmSync(join(HERO_DIST_DIR, name), { force: true });
	}
	mkdirSync(HERO_DIST_DIR, { recursive: true });
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

/** Review target is a TOP-ANCHORED SLICE of the DIFF PANE, not the whole
 * expanded portal — same adjudication Task 2 made for the sidebar. The
 * portal's measured rect is 2304x1416 of a 2880x1520 frame; after the 6%
 * margin and aspect normalization that clamps to ~2845x1501, a 1.012x "zoom",
 * so the review beat, its transition and the pullback render as one static
 * full-frame shot and the spec's push-in never happens on screen.
 *
 * The diff pane is what the beat is actually about: the changed file plus the
 * inline comment thread injected at line 3, which mounts near the pane's top.
 * Its measured width (~1646 device px) is what sets the crop — normalization
 * grows it by the 6% margin to ~1745 and derives the height from the aspect
 * (~920), a genuine ~1.65x push-in. The height cap below is therefore a
 * VERTICAL ANCHOR rather than a size: 700 device px puts the crop's centre
 * 350 device px (175 CSS px) under the pane's top edge, which frames the
 * file header, the BADGE_MAX
 * line, the whole comment card and the reduce/Math.min hunk without spending
 * frame on the app's top chrome.
 *
 * Measured by class, not by testid: no `data-testid` exists on the diff pane
 * (the review surface's testids are the portal, the grid, the rail and the
 * minimap — all portal-sized), and a stable class selector is already how
 * `measureSidebarRect` targets `.shell-sidebar`. Scoped under the portal so it
 * can never match a viewer rendered elsewhere in the app. */
const REVIEW_SLICE_H = 700;

async function measureReviewSurfaceRect(page: Page): Promise<Rect> {
	const box = await page
		.locator('[data-testid="review-expanded-portal"] .shell-viewer-panel')
		.boundingBox();
	if (!box) {
		throw new Error("[measure] review diff pane boundingBox() returned null");
	}
	return {
		x: box.x * 2,
		y: box.y * 2,
		w: box.width * 2,
		h: Math.min(box.height * 2, REVIEW_SLICE_H),
	};
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
				let computed: Calibration | null = null;
				try {
					computed = calibrateClock(warmupSamples);
					if (computed.residualSpreadMs > 50) {
						throw new Error(
							`clock calibration residual ${computed.residualSpreadMs.toFixed(1)}ms exceeds the 50ms budget`,
						);
					}
					cal = computed;
					resolveCalibration();
				} catch (err) {
					// A failed run must keep artifacts too (keep-artifacts-on-fail
					// contract) — write what warmup evidence exists before rejecting,
					// since no CaptureResult (and so no stage-A run) ever follows.
					writeFileSync(
						join(HERO_DIST_DIR, "calibration-failure.json"),
						JSON.stringify(
							{
								error: (err as Error).message,
								offsetMs: computed?.offsetMs ?? null,
								residualSpreadMs: computed?.residualSpreadMs ?? null,
								samples: warmupSamples,
							},
							null,
							"\t",
						) + "\n",
					);
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

/** A crop wider than this fraction of the frame is not a push-in at all — see
 * the stage-A check that uses it. */
const MAX_CROP_FRAME_FRACTION = 0.95;

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

	// No residual check here: a >50ms residual hard-fails inside recordCapture
	// (writes calibration-failure.json, rejects) before a CaptureResult ever
	// exists, so this function never sees one — checking it again is dead code.

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
		const gaps: Array<{ gapMs: number; startMaster: number }> = [];
		for (let i = 1; i < inWindow.length; i++) {
			gaps.push({
				gapMs: (inWindow[i]! - inWindow[i - 1]!) * 1000,
				startMaster: inWindow[i - 1]!,
			});
		}

		// Errata (spec cb7f813d, 2026-07-30): Chromium's CDP screencast capturer
		// deterministically drops ~250ms of frames on any in-flow box-geometry
		// relayout, even though the renderer's rAF cadence holds an unbroken
		// 60Hz — measured, not app-visible jank (task-7-report, fix round 2).
		// An mcp-status cue always produces exactly one such gap at its own
		// dispatch instant, so within a motion window at most ONE inter-frame
		// gap is exempt from the 150ms rule, iff it starts within
		// [t-0.05s, t+0.35s] of an mcp-status cue's executedMaster t inside
		// that window AND the gap itself is ≤ 400ms.
		const cueTimesInWindow = FLEET_TIGHT.events
			.filter((e) => e.kind === "mcp-status")
			.map((e) => capture.executedMasterById.get(e.id))
			.filter(
				(t): t is number =>
					t !== undefined && t >= w.startMaster && t <= w.endMaster,
			);

		let exemptIndex = -1;
		let exemptGapMs = 0;
		gaps.forEach((g, i) => {
			if (g.gapMs <= 150 || g.gapMs > 400) return;
			const qualifies = cueTimesInWindow.some(
				(t) => g.startMaster >= t - 0.05 && g.startMaster <= t + 0.35,
			);
			if (qualifies && g.gapMs > exemptGapMs) {
				exemptGapMs = g.gapMs;
				exemptIndex = i;
			}
		});

		if (exemptIndex >= 0) {
			console.log(
				`[stage-A] motion window [${w.startMaster},${w.endMaster}]: exempting one ${exemptGapMs.toFixed(1)}ms gap at t=${gaps[exemptIndex]!.startMaster.toFixed(3)} (mcp-status relayout, spec errata)`,
			);
		}

		let maxGapMs = 0;
		gaps.forEach((g, i) => {
			if (i === exemptIndex) return;
			maxGapMs = Math.max(maxGapMs, g.gapMs);
		});
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
			continue;
		}

		// A rect can be positive and in-bounds yet still frame nothing: the
		// review beat once measured the whole portal (2304 wide), which the 6%
		// margin grew to 0.988 of the frame — a 1.012x "push-in" that rendered
		// as a static full-frame shot for the last 6.5s of the tour. Nothing
		// caught it but a human looking at frames. Assert the crop is actually
		// a crop. Measured beats today: sidebar 0.177, review 0.587, fleet
		// 0.845 — fleet is legitimately wide (the whole terminal grid), so the
		// ceiling sits above it with margin rather than at the tightest value.
		const frameFraction = (rect.w * (1 + DEFAULT_MARGIN_FRAC)) / 2880;
		if (frameFraction > MAX_CROP_FRAME_FRACTION) {
			errors.push(
				`camera target rect '${target}' spans ${frameFraction.toFixed(3)} of frame width once the ${DEFAULT_MARGIN_FRAC} margin is applied — that renders as a no-op push-in (ceiling ${MAX_CROP_FRAME_FRACTION})`,
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
			"fps=60,scale=out_range=tv,format=yuv420p",
			"-color_range",
			"tv",
			"-colorspace",
			"bt709",
			"-color_primaries",
			"bt709",
			"-color_trc",
			"bt709",
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

	// Both demo panes are driven through their PATH shim (stage.ts SHIMS), NOT
	// a raw `node <abs path> --transcript <abs path>` line: the typed command is
	// legible on camera for the whole fleet beat, and a real repo path there is
	// a spec §9 claims-safety violation (and gives the fixture away).
	await page.getByTestId("slot-cta-1").click();
	await waitVisible(page.getByTestId("slot-1"), "slot-1-filled");
	const slot1Sid = await getSlotSessionId(page, 1);
	await sendInput(page, slot1Sid, `${WATCH_TESTS_COMMAND}\r`);

	await page.getByTestId("slot-cta-2").click();
	await waitVisible(page.getByTestId("slot-2"), "slot-2-filled");
	const slot2Sid = await getSlotSessionId(page, 2);
	await sendInput(page, slot2Sid, `${DEV_SERVER_COMMAND}\r`);

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
	// Wait for the diff itself to render before measuring — the pane is a grid
	// cell whose geometry doesn't depend on its content, but measuring a
	// "Loading diff…" placeholder would mean the rect was never checked against
	// the surface the beat actually films.
	await waitVisible(
		page.locator('[data-testid="review-expanded-portal"] .shell-viewer'),
		"review-diff-viewer",
	);
	targetRects["review-surface"] = await measureReviewSurfaceRect(page);
	await page.keyboard.press("Escape");
	// The portal's own "detached" wait can't distinguish a real close from a
	// still-mounted-but-occluded element — assert the count itself hits 0.
	await pollUntil(
		"review-portal-detached",
		() => page.locator('[data-testid="review-expanded-portal"]').count(),
		(n) => n === 0,
	);
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

	// Let the renderer fully settle before capture begins.
	//
	// Unrelated to that settle, but worth knowing here because this is where
	// the cues get dispatched from: every mcp-status cue drops ~250ms of
	// CAPTURED frames. Measured against the real app with this exact capture
	// recipe (probe with a rAF baseline canvas plus event-loop lag samplers in
	// both processes): Chromium's `Page.startScreencast` capturer stalls
	// ~249-270ms whenever the page performs a layout that CHANGES BOX
	// GEOMETRY. The ezio-waiting cue mounts new in-flow boxes into its sidebar
	// row (the needs-you pill and the attention-context block), so it stalls
	// every time.
	//
	// It is a capture-instrument artifact, NOT app jank: renderer rAF holds an
	// unbroken 60Hz through every transition and neither process's event loop
	// lags 60ms. Paint-only, composited, and geometry-preserving changes all
	// capture cleanly; a bare in-flow DOM append with all attention CSS
	// disabled stalls identically, and so does the `ready` state, which arms
	// no glow at all. (An earlier note here blamed the row's box-shadow glow
	// animation; that hypothesis was falsified by the probe above. So were
	// `will-change`, `contain`, and `translateZ` mitigations — all still
	// stall.) Stage A therefore exempts one such gap per motion window under
	// the narrow conditions in spec §7's errata; see runStageAChecks.
	await page.waitForTimeout(1500);

	return { targetRects, mcpClient };
}

async function main(): Promise<void> {
	spawnCaffeinate();
	clearHeroDist();

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
				// The ZDOTDIR mechanism below is zsh-only, and the app spawns
				// `$SHELL -l`. On a machine where $SHELL is bash, /etc/bashrc's
				// `\u@\h` would put a real username and hostname back on camera
				// AND the operator's own ~/.bashrc would run inside the take.
				// Pin the shell so the recording never depends on who runs it.
				SHELL: "/bin/zsh",
				// /etc/zshrc sources /etc/zshrc_$TERM_PROGRAM; under Apple
				// Terminal that emits per-prompt OSC 7 carrying an absolute
				// path. xterm.js drops unhandled OSC today, so nothing renders
				// — but an inherited value makes startup depend on the
				// operator's terminal, which a deterministic take cannot allow.
				TERM_PROGRAM: "",
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
