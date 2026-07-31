// scripts/hero/stage.ts — builds the demo world a hero-video recording
// films: a throwaway git repo with three linked worktrees (one per fleet
// agent), a userData dir + workspace-state.json seeded so the app boots
// straight into the fleet view, and PATH shims that make `claude`/`codex`/
// `ezio` — plus the two demo panes' `watch-tests`/`dev-server` — resolve to
// the transcript player (Task 3) instead of real CLIs.
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
	realpathSync,
	chmodSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type HeroWorld = {
	repoPath: string; // demo repo root (main checkout)
	worktrees: { claude: string; codex: string; ezio: string }; // absolute paths
	userDataDir: string; // seeded settings.json ({"version":1,"theme":"dark","restorePreference":"alwaysRestore"})
	workspaceStatePath: string; // seeded v2 workspace-state.json
	stubBinDir: string; // SHIMS (agent + demo-player commands) on PATH
	marksPath: string; // HERO_MARKS_PATH target
	gateDir: string; // HERO_GATE_DIR — recorder writes gate files here
	cleanup(): void;
};

type AgentName = "claude" | "codex" | "ezio";

// Directory this file lives in (scripts/hero/) — resolved via import.meta.url
// rather than process.cwd() so the shims work regardless of who invokes
// stageHeroWorld() from where.
const HERO_DIR = dirname(fileURLToPath(import.meta.url));

/** The two demo-player commands the recorder types into the fleet beat's
 * extra slots. Named for what their pane DISPLAYS, not after the fixture file
 * behind them, because the typed command line is legible on camera and has to
 * read as a plausible project command (spec §9). Exported so record.ts types
 * the shim name and never a `node <absolute path>` command line. */
export const WATCH_TESTS_COMMAND = "watch-tests"; // streams vitest output
export const DEV_SERVER_COMMAND = "dev-server"; // streams HTTP request logs

/** One PATH shim: the one-word command a terminal pane is driven with, and
 * the transcript-player invocation it hides. */
type ShimSpec = {
	command: string; // what the recorder types — appears on camera
	transcript: string; // basename under transcripts/, without .jsonl
	title?: AgentName; // OSC-0 window title → sidebar provider badge
	loop?: boolean; // replay the transcript forever
};

/** Agent shims MUST NOT loop — a second pass would re-emit the `commit-line`
 * marker and break the recorder's cue timing. Only the demo players (which
 * write no markers) loop, so their panes keep streaming for the whole tour. */
const SHIMS: ShimSpec[] = [
	{ command: "claude", transcript: "claude", title: "claude" },
	{ command: "codex", transcript: "codex", title: "codex" },
	{ command: "ezio", transcript: "ezio", title: "ezio" },
	{
		command: WATCH_TESTS_COMMAND,
		transcript: "demo-tests",
		loop: true,
	},
	{ command: DEV_SERVER_COMMAND, transcript: "demo-dev", loop: true },
];

const PACKAGE_JSON = { name: "orbit-shop", private: true };

const CHECKOUT_TS = `export type OrderPayload = { cartId: string; total: number };
export type OrderResult = { orderId: string };

export async function submitOrder(
	payload: OrderPayload,
): Promise<OrderResult> {
	const response = await fetch("/api/checkout", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!response.ok) {
		throw new Error("checkout failed: " + response.status);
	}
	return response.json();
}
`;

const CART_BADGE_TS = `export type CartItem = { id: string; quantity: number };

export function computeBadgeCount(items: CartItem[]): number {
	let total = 0;
	for (const item of items) {
		total += item.quantity;
	}
	return total;
}

export function renderBadge(count: number): string {
	return count > 0 ? String(count) : "";
}
`;

// The reviewed dirty diff the review beat shows: rewrite the count
// computation to a reduce + clamp it with a new BADGE_MAX constant. Left
// UNCOMMITTED in codex's worktree (see stageHeroWorld).
const CART_BADGE_TS_DIRTY = `export type CartItem = { id: string; quantity: number };

const BADGE_MAX = 99;

export function computeBadgeCount(items: CartItem[]): number {
	const total = items.reduce((sum, item) => sum + item.quantity, 0);
	return Math.min(total, BADGE_MAX);
}

export function renderBadge(count: number): string {
	return count > 0 ? String(count) : "";
}
`;

const API_MD = `# Orbit Shop API

## Quickstart

This guide covers the Orbit Shop checkout and cart endpoints.

### POST /api/checkout

Submits the current cart for payment and order creation.

### GET /api/cart-badge

Returns the current cart item count for the header badge.
`;

function git(args: string, cwd: string): void {
	execSync(`git ${args}`, { cwd, stdio: "ignore" });
}

/** Creates `branch` off the current HEAD and adds a linked worktree for it
 * under `<repoPath>/.worktrees/`, mirroring the real app's worktree naming
 * (services/worktrees/worktree-service.ts normalizeWorktreeName: `/` → `-`). */
function stageWorktree(repoPath: string, branch: string): string {
	git(`branch ${branch}`, repoPath);
	const dir = join(repoPath, ".worktrees", branch.replace(/\//g, "-"));
	git(`worktree add "${dir}" ${branch}`, repoPath);
	return realpathSync(dir);
}

function writeShim(stubBinDir: string, spec: ShimSpec): void {
	const agentPlayerPath = join(HERO_DIR, "agent-player.mjs");
	const transcriptPath = join(
		HERO_DIR,
		"transcripts",
		`${spec.transcript}.jsonl`,
	);
	const args = [`--transcript "${transcriptPath}"`];
	if (spec.title) args.push(`--title ${spec.title}`);
	if (spec.loop) args.push("--loop");
	const script = `#!/bin/sh\nexec node "${agentPlayerPath}" ${args.join(" ")}\n`;
	const shimPath = join(stubBinDir, spec.command);
	writeFileSync(shimPath, script);
	chmodSync(shimPath, 0o755);
}

function emptyWorktreeSession(worktreeId: string) {
	return {
		worktreeId,
		title: "",
		note: "",
		reviewMode: "files" as const,
		viewerMode: "file" as const,
		selectedFilePath: null,
		selectedChangedFilePath: null,
		activeProcessSessionId: null,
		nextAdHocNumber: 1,
		processSessions: [],
	};
}

// v2 shape copied from tests/e2e/restore-all-workspaces.test.ts (savedWorkspace).
function buildWorkspaceState(
	repoPath: string,
	worktrees: HeroWorld["worktrees"],
) {
	const workspaceId = `workspace:${repoPath}`;
	return {
		version: 2,
		restorePreference: "alwaysRestore",
		activeWorkspaceId: workspaceId,
		workspaceOrder: [workspaceId],
		workspaces: [
			{
				workspaceId,
				repositoryPath: repoPath,
				repoId: null,
				snapshot: {
					repositoryPath: repoPath,
					repoId: null,
					selectedWorktreeId: worktrees.claude,
					commandPresets: [],
					worktreeSessions: [
						emptyWorktreeSession(worktrees.claude),
						emptyWorktreeSession(worktrees.codex),
						emptyWorktreeSession(worktrees.ezio),
					],
				},
			},
		],
	};
}

/**
 * Stages the demo world a hero-video recording films: a fresh `orbit-shop`
 * repo with a fleet worktree per agent (claude on the checkout-retry
 * feature, codex on the cart-badge fix — left dirty for the review beat —
 * ezio on API docs), a seeded userData dir + workspace-state.json so the app
 * restores straight into the fleet view, and PATH shims that route every
 * on-camera command (`claude`/`codex`/`ezio` plus `watch-tests`/`dev-server`)
 * through the transcript player instead of spawning real CLIs. All temp dirs
 * are created under `rootDir`; call `cleanup()` when the recording is done.
 */
export function stageHeroWorld(rootDir: string): HeroWorld {
	// Unwind bookkeeping: every top-level temp dir mkdtemp'd so far (LIFO
	// removal order) and every linked worktree registered with git so far
	// (must be `worktree remove`d before its parent dir disappears). Populated
	// as staging proceeds so a throw partway through leaves nothing behind —
	// see the catch block below.
	const createdDirs: string[] = [];
	const createdWorktrees: string[] = [];
	let demoParentDir = "";
	let repoPath = "";

	try {
		// mkdtemp the PARENT dir (hero-demo-<rand>) and put the repo at a fixed
		// `orbit-shop` name inside it — the app labels a workspace by the repo
		// dir's basename (services/insights/store/path-identity.ts,
		// src/features/insights/workspaceIndex.ts), so a random-suffixed repo
		// dir would show up on camera as "HERO-DEMO-XXXXXX" instead of
		// "ORBIT-SHOP".
		demoParentDir = realpathSync(mkdtempSync(join(rootDir, "hero-demo-")));
		createdDirs.push(demoParentDir);
		mkdirSync(join(demoParentDir, "orbit-shop"), { recursive: true });
		repoPath = realpathSync(join(demoParentDir, "orbit-shop"));

		git("init -b main", repoPath);
		git("config user.email 'hero-demo@example.com'", repoPath);
		git("config user.name 'Hero Demo'", repoPath);

		mkdirSync(join(repoPath, "src"), { recursive: true });
		mkdirSync(join(repoPath, "docs"), { recursive: true });
		writeFileSync(
			join(repoPath, "package.json"),
			JSON.stringify(PACKAGE_JSON, null, "\t") + "\n",
		);
		writeFileSync(join(repoPath, "src", "checkout.ts"), CHECKOUT_TS);
		writeFileSync(join(repoPath, "src", "cart-badge.ts"), CART_BADGE_TS);
		writeFileSync(join(repoPath, "docs", "api.md"), API_MD);

		git("add -A", repoPath);
		git('commit -m "initial commit"', repoPath);

		// origin/HEAD → origin/master, mirroring create-test-repo.ts so worktree
		// creation resolves a base ref the same way it would against a real clone.
		git("update-ref refs/remotes/origin/main HEAD", repoPath);
		git("update-ref refs/remotes/origin/master HEAD", repoPath);
		git(
			"symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master",
			repoPath,
		);

		mkdirSync(join(repoPath, ".worktrees"), { recursive: true });
		const worktrees = {
			claude: stageWorktree(repoPath, "feat/checkout-retry"),
			codex: stageWorktree(repoPath, "fix/cart-badge-count"),
			ezio: stageWorktree(repoPath, "docs/api-examples"),
		};
		createdWorktrees.push(...Object.values(worktrees));

		// Dirty (uncommitted) diff in codex's worktree — the review beat shows it.
		writeFileSync(
			join(worktrees.codex, "src", "cart-badge.ts"),
			CART_BADGE_TS_DIRTY,
		);

		const userDataDir = realpathSync(
			mkdtempSync(join(rootDir, "hero-userdata-")),
		);
		createdDirs.push(userDataDir);
		// version: 1 is required by PersistedSettingsV1Schema (no default) — an
		// unversioned file fails schema parse, the app falls back to DEFAULTS
		// (system theme, restorePreference "prompt"), and boots into a
		// restore-prompt modal in light theme instead of the seeded dark fleet
		// view. restorePreference: "alwaysRestore" here also suppresses the
		// legacy migration path that would otherwise pull alwaysRestore off of
		// workspace-state.json instead.
		writeFileSync(
			join(userDataDir, "settings.json"),
			JSON.stringify({
				version: 1,
				theme: "dark",
				restorePreference: "alwaysRestore",
			}),
		);

		const stateDir = realpathSync(mkdtempSync(join(rootDir, "hero-state-")));
		createdDirs.push(stateDir);
		const workspaceStatePath = join(stateDir, "workspace-state.json");
		writeFileSync(
			workspaceStatePath,
			JSON.stringify(buildWorkspaceState(repoPath, worktrees)),
		);

		const stubBinDir = realpathSync(mkdtempSync(join(rootDir, "hero-bin-")));
		createdDirs.push(stubBinDir);
		for (const spec of SHIMS) {
			writeShim(stubBinDir, spec);
		}

		const marksDir = realpathSync(mkdtempSync(join(rootDir, "hero-marks-")));
		createdDirs.push(marksDir);
		const marksPath = join(marksDir, "marks.jsonl");

		const gateDir = realpathSync(mkdtempSync(join(rootDir, "hero-gate-")));
		createdDirs.push(gateDir);

		return {
			repoPath,
			worktrees,
			userDataDir,
			workspaceStatePath,
			stubBinDir,
			marksPath,
			gateDir,
			cleanup(): void {
				for (const path of createdWorktrees) {
					try {
						git(`worktree remove "${path}" --force`, repoPath);
					} catch {
						// worktree may already be removed
					}
				}
				for (const dir of [...createdDirs].reverse()) {
					rmSync(dir, { recursive: true, force: true });
				}
			},
		};
	} catch (err) {
		// Partial-staging unwind: best-effort, each removal independently
		// guarded so one failure doesn't stop the rest from being attempted.
		for (const path of createdWorktrees) {
			try {
				git(`worktree remove "${path}" --force`, repoPath);
			} catch {
				// best-effort — the recursive rmSync below covers this anyway
			}
		}
		for (const dir of [...createdDirs].reverse()) {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				// best-effort unwind
			}
		}
		throw err;
	}
}
