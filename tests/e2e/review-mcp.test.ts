/**
 * E2E tests for the Review MCP server (Task 31).
 *
 * SKIP REASON: All E2E tests in this project currently fail because
 * `window.ai14all` (injected via contextBridge in the Electron preload) is
 * never defined when Playwright launches the app. Root-cause analysis shows
 * that Playwright 1.59's loader.js patches `app.whenReady` / `app.emit` and
 * inserts itself via `-r loader` before `out/main/index.js`. This interacts
 * with Electron 41's sandboxed-preload execution: the preload runs but
 * `contextBridge.exposeInMainWorld` does not surface `window.ai14all` in the
 * renderer's main execution context. The same failure is reproduced by running
 * `review-drawer.test.ts` and `review-comments.test.ts` on this machine.
 *
 * Resolution path: investigate the Playwright+Electron preload timing issue
 * (possibly upgrade Playwright or adjust `sandbox`/`contextIsolation` flags)
 * before enabling these tests.
 */

import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
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
let userDataDir: string;
let persistedStateDir: string;
let persistedStatePath: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-review-mcp-")),
	);
	persistedStatePath = join(persistedStateDir, "workspace-state.json");
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-user-data-mcp-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
			AI14ALL_USER_DATA_PATH: userDataDir,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	page.setDefaultTimeout(60_000);
}, 60_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		rmSync(userDataDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
}, 90_000);

test.describe.serial("Review MCP server", () => {
	test.skip(
		true,
		"requires E2E environment — unskip when Playwright/Electron compat is resolved",
	);

	test("MCP client can list and mark addressed a comment", async () => {
		test.setTimeout(120_000);

		// Wait for the workspace to load: feature-a worktree nav button
		const worktreeNav = page.getByRole("navigation", {
			name: "Worktree sessions",
		});
		await expect(
			worktreeNav.getByRole("button", { name: /feature-a/i }),
		).toBeVisible({ timeout: 20_000 });

		// --- 1. Obtain workspaceId + worktreeId via IPC ---
		//
		// openRepository returns the workspaceId for the loaded repo.
		// listWorktrees returns all Worktree objects (id, path, branchName, isMain).
		// We target the feature-a linked worktree (isMain === false).
		const { workspaceId, worktreeId } = await page.evaluate(
			async (repoPath: string) => {
				const ai = (window as unknown as { ai14all: typeof window.ai14all })
					.ai14all;
				const ws = await ai.workspace.openRepository(repoPath);
				const worktrees = await ai.repository.listWorktrees(ws.id);
				const linked = worktrees.find((wt: { isMain: boolean }) => !wt.isMain);
				if (!linked) throw new Error("feature-a worktree not found");
				return { workspaceId: ws.id, worktreeId: linked.id };
			},
			testRepo.repoPath,
		);
		expect(workspaceId).toBeTruthy();
		expect(worktreeId).toBeTruthy();

		// --- 2. Create a review comment via IPC ---
		const { comment } = await page.evaluate(
			async (input: {
				worktreeId: string;
				filePath: string;
				startLine: number;
				endLine: number;
				snippet: string;
				body: string;
				status: "open";
				source: "working-tree";
				commitSha: null;
			}) => {
				const ai = (window as unknown as { ai14all: typeof window.ai14all })
					.ai14all;
				return ai.reviewComments.create(input);
			},
			{
				worktreeId,
				filePath: "src/index.ts",
				startLine: 1,
				endLine: 1,
				snippet: 'export const hello = "phase-2";',
				body: "rename x",
				status: "open" as const,
				source: "working-tree" as const,
				commitSha: null,
			},
		);
		expect(comment.id).toBeTruthy();
		const commentId: string = comment.id;

		// --- 3. Read the MCP port from the liveness file ---
		const portStr = await readFile(
			join(userDataDir, "ai-14all", "mcp-port"),
			"utf-8",
		);
		const port = parseInt(portStr.trim(), 10);
		expect(port).toBeGreaterThanOrEqual(51000);
		expect(port).toBeLessThanOrEqual(51999);

		// --- 4. Connect an MCP client ---
		const transport = new StreamableHTTPClientTransport(
			new URL(`http://127.0.0.1:${port}/mcp`),
		);
		const client = new Client({ name: "e2e-test", version: "1.0.0" });
		await client.connect(transport);

		try {
			// --- 5. list_pending_reviews → expect 1 open review ---
			const listResult = await client.callTool({
				name: "list_pending_reviews",
				arguments: { worktreePath: testRepo.worktreePath },
			});
			const listContent = listResult.content as Array<{
				type: string;
				text: string;
			}>;
			const { reviews } = JSON.parse(listContent[0]!.text) as {
				reviews: Array<{ id: string; body: string; status: string }>;
			};
			expect(reviews).toHaveLength(1);
			expect(reviews[0]!.id).toBe(commentId);
			expect(reviews[0]!.body).toBe("rename x");
			expect(reviews[0]!.status).toBe("open");

			// --- 6. mark_review_addressed → expect { ok: true } ---
			const markResult = await client.callTool({
				name: "mark_review_addressed",
				arguments: { commentId },
			});
			const markContent = markResult.content as Array<{
				type: string;
				text: string;
			}>;
			const markResponse = JSON.parse(markContent[0]!.text) as {
				ok: boolean;
				error?: string;
			};
			expect(markResponse.ok).toBe(true);
			expect(markResponse.error).toBeUndefined();

			// --- 7. mark_review_addressed again → expect { ok: false, error: "already_addressed" } ---
			const markAgainResult = await client.callTool({
				name: "mark_review_addressed",
				arguments: { commentId },
			});
			const markAgainContent = markAgainResult.content as Array<{
				type: string;
				text: string;
			}>;
			const markAgainResponse = JSON.parse(markAgainContent[0]!.text) as {
				ok: boolean;
				error?: string;
			};
			expect(markAgainResponse.ok).toBe(false);
			expect(markAgainResponse.error).toBe("already_addressed");

			// --- 8. Assert sidebar card updated to addressed ---
			// Navigate to feature-a and open the review drawer to verify the
			// card reflects the addressed status set by the MCP tool.
			await worktreeNav
				.getByRole("button", { name: /feature-a/i })
				.click({ force: true });
			const commentCard = page.locator(".shell-review-comment-card");
			await expect(commentCard).toBeVisible({ timeout: 10_000 });
			await expect(commentCard).toHaveAttribute("data-status", "addressed", {
				timeout: 5_000,
			});
		} finally {
			await client.close();
		}
	});
});
