import {
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	_electron as electron,
	type ElectronApplication,
	type Page,
	expect,
	test,
} from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";
import {
	startMockSamantha,
	type MockSamantha,
} from "./fixtures/samantha-mock-server";

let app: ElectronApplication | undefined;
let page: Page;
let mock: MockSamantha;
let userDataDir: string;
let repo: TestRepo;

test.beforeEach(async () => {
	mock = await startMockSamantha();
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-sam-ud-")));
	writeFileSync(
		join(userDataDir, "config.toml"),
		"[plugins.samantha]\nenabled = true\n",
		"utf8",
	);
	repo = createTestRepo();
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: repo.repoPath,
			AI14ALL_USER_DATA_PATH: userDataDir,
			AI_SAMANTHA_CONNECTOR_PORT: String(mock.port),
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	// Load the repo and select the main worktree so a renderer session exists
	// (mirrors tests/e2e/mcp-session-note.test.ts).
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(repo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	const nav = page.getByRole("navigation", { name: "Worktree sessions" });
	await expect(nav.getByRole("button", { name: /main/i })).toBeVisible({
		timeout: 15_000,
	});
	await nav.getByRole("button", { name: /main/i }).click();
});

test.afterEach(async () => {
	await closeApp(app);
	app = undefined;
	await mock.close();
	rmSync(userDataDir, { recursive: true, force: true });
	repo.cleanup();
});

test("registers, snapshots, and emits an attentionRequired event when a session goes waiting", async () => {
	test.setTimeout(120_000);

	// 1) Samantha sees us register + push an initial full snapshot.
	await expect
		.poll(() => mock.requests.map((r) => `${r.method} ${r.url}`), {
			timeout: 20_000,
		})
		.toContain("POST /connectors/register");
	await expect
		.poll(() => mock.requests.map((r) => `${r.method} ${r.url}`), {
			timeout: 20_000,
		})
		.toContain("PATCH /connectors/ai-14all/snapshot");

	// 2) Drive the main worktree to "waiting" via the real MCP tool — exactly as a
	// coding agent would. The MCP port is in the app's liveness file.
	const port = readFileSync(
		join(userDataDir, "ai-14all", "mcp-port"),
		"utf8",
	).trim();
	const client = new Client({ name: "e2e-samantha", version: "1.0.0" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
	);
	// The renderer may not own the worktree session for a moment after load.
	let reported = false;
	for (let i = 0; i < 40 && !reported; i++) {
		const res = await client.callTool({
			name: "report_session_status",
			arguments: {
				worktreePath: repo.repoPath,
				state: "waiting",
				summary: "awaiting an answer on the caching strategy",
				nextAction: "answer the question",
				task: "wire the cache",
			},
		});
		const parsed = JSON.parse((res.content as Array<{ text: string }>)[0].text);
		if (parsed.ok) reported = true;
		else await page.waitForTimeout(250);
	}
	expect(reported).toBe(true);

	// 3) The waiting transition must produce an attentionRequired event POST.
	await expect
		.poll(
			() =>
				mock.requests
					.filter((r) => r.url === "/connectors/ai-14all/events")
					.map((r) => (r.body as { signal?: string } | null)?.signal),
			{ timeout: 20_000 },
		)
		.toContain("attentionRequired");

	await client.close();
});
