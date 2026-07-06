/**
 * E2E proof of the agent conversation-resume replay flow (spec §7 e2e #4,
 * persistent-settings + restore-all + agent-resume design): a resume handle
 * registered over the real MCP `register_agent_session` tool survives an app
 * restart (persisted onto the process session inside workspace-state.json),
 * and the `agentResume` setting gates how it replays into the recreated pane
 * — manual shows the "Resume conversation" affordance and types nothing, off
 * shows neither, auto types the stored resume command straight into the pane.
 *
 * Harness copied from tests/e2e/session-attention.spec.ts (electron.launch
 * args/env seams, MCP Client + StreamableHTTPClientTransport,
 * getVisibleTerminalSessionId, closeApp) and
 * tests/e2e/settings-persistence.test.ts (seeding settings.json directly on
 * disk before each relaunch, since agentResume isn't driven through
 * window.ai14all.settings.write in this flow).
 *
 * `register_agent_session` takes `worktreePath` directly (resolved to a
 * worktreeId inside the MCP server) — no workspaceId lookup is needed on the
 * test side, unlike terminals.list-style calls (see
 * tests/e2e/restore-all-workspaces.test.ts for that different pattern).
 *
 * Text-content assertions read `.xterm-accessibility-tree` (scoped to the
 * visible pane), NOT `.xterm` itself: xterm.js renders via canvas, so `.xterm`
 * has no text nodes — see tests/e2e/command-palette.spec.ts's documented
 * finding ("xterm renders via canvas — text is not accessible on `.xterm`
 * directly").
 */
import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let stateDir: string;
let userDataDir: string;

const RESUME_COMMAND = "claude --resume e2e-resume-marker";

const launch = () =>
	electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
			AI14ALL_USER_DATA_PATH: userDataDir,
		},
	});

// Rewritten on disk while the app is closed, before each restart cycle.
// Settings and workspace state are separate files under userDataDir
// (settings.json vs workspace-state.json), so the resumeCommand registered
// over MCP — persisted onto the process session inside workspace-state.json
// at quit — survives every one of these settings-only rewrites.
const seedSettings = (mode: "auto" | "manual" | "off") =>
	writeFileSync(
		join(userDataDir, "settings.json"),
		JSON.stringify({
			version: 1,
			agentResume: mode,
			restorePreference: "alwaysRestore",
		}),
	);

// Copied verbatim from tests/e2e/session-attention.spec.ts.
function getVisibleTerminalSessionId(): Promise<string | null> {
	return page.evaluate<string | null>(() => {
		const pane = document.querySelector<HTMLElement>(
			'.shell-terminal-pane[aria-hidden="false"]',
		);
		return pane?.dataset.terminalSessionId ?? null;
	});
}

// xterm.js renders via canvas, so text content assertions must read the a11y
// tree (see file header + tests/e2e/command-palette.spec.ts), scoped to
// whichever pane is currently visible.
const visiblePaneA11yTree = () =>
	page
		.locator(
			'.shell-terminal-pane[aria-hidden="false"] .xterm-accessibility-tree',
		)
		.first();

test.beforeAll(() => {
	testRepo = createTestRepo();
	stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-resume-")));
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-resume-ud-")));
	seedSettings("auto");
});
test.afterAll(async () => {
	if (app) await closeApp(app);
	rmSync(stateDir, { recursive: true, force: true });
	rmSync(userDataDir, { recursive: true, force: true });
	testRepo.cleanup();
});

test("registered resume handle drives manual, off, and auto modes across restarts", async () => {
	test.setTimeout(300_000);

	app = await launch();
	page = await app.firstWindow({ timeout: 60_000 });

	// Boot sequence per session-attention.spec.ts: Browse -> Load. The main
	// worktree's default (adHoc) shell spawns automatically once loaded (same
	// assertion tests/e2e/settings-persistence.test.ts uses to prove a live
	// terminal exists with no extra worktree-nav click needed).
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		page
			.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
			.first(),
	).toBeVisible({ timeout: 15_000 });

	// Resolve the default shell's terminal session id from the DOM — a
	// registered resumeCommand only lands on the process session whose
	// terminalSessionId matches exactly (use-agent-resume-bridge.ts).
	let termId: string | null = null;
	await expect
		.poll(async () => (termId = await getVisibleTerminalSessionId()), {
			timeout: 10_000,
		})
		.not.toBeNull();

	// Register over the REAL MCP register_agent_session tool (same
	// Client/StreamableHTTPClientTransport pattern as
	// session-attention.spec.ts's connectMcpClient).
	const port = Number(
		(await readFile(join(userDataDir, "ai-14all", "mcp-port"), "utf8")).trim(),
	);
	const client = new Client({ name: "e2e-resume", version: "1.0.0" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
	);
	try {
		// The renderer's agent-resume bridge announces "ready" once mounted, but
		// (same as report_session_status in session-attention.spec.ts Test 5)
		// there is a narrow Playwright+Electron preload window where the call
		// can race it. Retry on the bridge's own transient error codes rather
		// than assume the first call lands; anything else is a real failure.
		let ok = false;
		for (let i = 0; i < 40 && !ok; i++) {
			const result = await client.callTool({
				name: "register_agent_session",
				arguments: {
					worktreePath: testRepo.repoPath,
					terminalSessionId: termId,
					provider: "claude",
					resumeCommand: RESUME_COMMAND,
				},
			});
			const parsed = JSON.parse(
				(result.content as { text: string }[])[0]!.text,
			) as { ok: boolean; error?: string };
			if (parsed.ok) {
				ok = true;
				break;
			}
			if (
				parsed.error !== "renderer_not_ready" &&
				parsed.error !== "bridge_timeout"
			) {
				throw new Error(
					`register_agent_session failed: ${JSON.stringify(parsed)}`,
				);
			}
			await page.waitForTimeout(250);
		}
		expect(ok).toBe(true);
	} finally {
		await client.close();
	}

	// --- Cycle 1: manual — affordance shows, nothing typed (spec §7 e2e #4) ---
	await closeApp(app);
	seedSettings("manual");
	app = await launch();
	page = await app.firstWindow({ timeout: 60_000 });
	await expect(
		page.getByRole("button", { name: "Resume conversation" }),
	).toBeVisible({ timeout: 60_000 });
	await expect(visiblePaneA11yTree()).not.toContainText(RESUME_COMMAND);

	// --- Cycle 2: off — no affordance, nothing typed ---
	await closeApp(app);
	seedSettings("off");
	app = await launch();
	page = await app.firstWindow({ timeout: 60_000 });
	// Wait until the restored pane's terminal is live before asserting absence.
	await expect(page.locator("[data-terminal-font-size]").first()).toBeVisible({
		timeout: 60_000,
	});
	await expect(
		page.getByRole("button", { name: "Resume conversation" }),
	).toHaveCount(0);
	await expect(visiblePaneA11yTree()).not.toContainText(RESUME_COMMAND);

	// --- Cycle 3: auto — the resume command is typed into the recreated pane
	// (it will fail to run — claude isn't on PATH here — the assertion is that
	// the TEXT was typed). This cycle runs last so its typed text can never
	// bleed into the two "nothing typed" assertions above. ---
	await closeApp(app);
	seedSettings("auto");
	app = await launch();
	page = await app.firstWindow({ timeout: 60_000 });
	await expect(visiblePaneA11yTree()).toContainText(RESUME_COMMAND, {
		timeout: 60_000,
	});
});
