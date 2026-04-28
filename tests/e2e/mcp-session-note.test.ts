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
let stateDir: string;
let userDataDir: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-mcp-note-")));
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-mcp-note-ud-")));

	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
			// Isolate the MCP port/config/liveness files to a temp dir so the test
			// never touches a developer's real userData (electron/main/index.ts:25).
			AI14ALL_USER_DATA_PATH: userDataDir,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();

	// Select the main session so a worktree session exists in renderer state
	const nav = page.getByRole("navigation", { name: "Worktree sessions" });
	await expect(nav.getByRole("button", { name: /main/i })).toBeVisible({
		timeout: 15_000,
	});
	await nav.getByRole("button", { name: /main/i }).click();
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(userDataDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test.describe("mcp session note", () => {
	test("append + read updates NoteSheet live", async () => {
		test.setTimeout(120_000);

		// 1. Read the MCP port from the isolated userData dir set in beforeAll
		const portStr = await readFile(
			join(userDataDir, "ai-14all", "mcp-port"),
			"utf8",
		);
		const url = `http://127.0.0.1:${portStr.trim()}/mcp`;

		// 2. Open NoteSheet via the chip bar Note button (matches session-chip-bar test)
		await page.getByRole("button", { name: /open note/i }).click();
		const textarea = page.getByRole("textbox", { name: /session note/i });
		await expect(textarea).toBeVisible();

		// 3. Connect MCP client
		const client = new Client({ name: "e2e", version: "1.0.0" });
		await client.connect(new StreamableHTTPClientTransport(new URL(url)));

		const worktreePath = testRepo.repoPath; // main worktree path

		// 4. Wait for renderer ready (poll read until it stops returning renderer_not_ready)
		let readReady = false;
		for (let i = 0; i < 40 && !readReady; i++) {
			const r = await client.callTool({
				name: "read_session_note",
				arguments: { worktreePath },
			});
			const parsed = JSON.parse((r.content as Array<{ text: string }>)[0].text);
			if (parsed.ok || parsed.error !== "renderer_not_ready") {
				readReady = true;
				break;
			}
			await page.waitForTimeout(250);
		}
		expect(readReady).toBe(true);

		// 5. Append
		const appendResult = await client.callTool({
			name: "append_session_note",
			arguments: {
				worktreePath,
				title: "Captured idea",
				body: "the body",
			},
		});
		const appendParsed = JSON.parse(
			(appendResult.content as Array<{ text: string }>)[0].text,
		) as { ok: true; appendedSection: string; note: string };
		expect(appendParsed.ok).toBe(true);
		expect(appendParsed.appendedSection).toMatch(
			/^## Captured idea — \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
		);

		// 6. NoteSheet textarea reflects the new content live (regex-escape the section)
		const escaped = appendParsed.appendedSection.replace(
			/[.*+?^${}()|[\]\\]/g,
			"\\$&",
		);
		await expect(textarea).toHaveValue(new RegExp(escaped));

		// 7. Read returns the same content
		const readResult = await client.callTool({
			name: "read_session_note",
			arguments: { worktreePath },
		});
		const readParsed = JSON.parse(
			(readResult.content as Array<{ text: string }>)[0].text,
		);
		expect(readParsed).toEqual({ ok: true, note: appendParsed.note });

		await client.close();
	});
});
