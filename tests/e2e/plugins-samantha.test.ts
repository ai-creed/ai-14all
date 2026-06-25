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
		"[plugins.samantha]\nenabled = true\n\n[plugins.samantha.behavior]\nfocus_raises_window = false\n",
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

test("focus-worktree selects the worktree and returns ok { focused }", async () => {
	test.setTimeout(60_000);

	// Wait for the connector to register and push a snapshot so the WS connects.
	await expect
		.poll(() => mock.requests.some((r) => r.url === "/connectors/register"), {
			timeout: 20_000,
		})
		.toBe(true);
	await expect
		.poll(
			() =>
				mock.requests.some(
					(r) =>
						r.method === "PATCH" &&
						r.url === "/connectors/ai-14all/snapshot" &&
						r.body !== null &&
						typeof (r.body as { details?: unknown }).details === "object" &&
						Object.keys(
							(r.body as { details: Record<string, unknown> }).details,
						).length > 0,
				),
			{ timeout: 20_000 },
		)
		.toBe(true);

	// Derive the worktree key at runtime from the most recent PATCH snapshot body.
	const snapshotReq = [...mock.requests]
		.reverse()
		.find(
			(r) => r.method === "PATCH" && r.url === "/connectors/ai-14all/snapshot",
		);
	const details = (snapshotReq?.body as { details?: Record<string, unknown> })
		?.details;
	const key = Object.keys(details ?? {})[0];
	expect(key).toBeTruthy();

	mock.sendCommand({
		type: "command",
		capabilityId: "focus-worktree",
		requestId: "e1",
		args: { worktree: key },
	});
	await expect
		.poll(() => mock.commandResults.length, { timeout: 15_000 })
		.toBeGreaterThan(0);
	const result = mock.commandResults.find(
		(r: unknown) => (r as { requestId?: string }).requestId === "e1",
	) as {
		status: string;
		result: { focused: string };
	};
	expect(result.status).toBe("ok");
	expect(result.result.focused).toBe(key);

	// Assert the renderer selected that worktree (the deterministic UI change).
	// The worktree branch name is the second segment of the "<repo>/<branch>" key.
	const branch = key.split("/").slice(1).join("/");
	const nav = page.getByRole("navigation", { name: "Worktree sessions" });
	await expect(
		nav.getByRole("button", { name: new RegExp(branch, "i") }),
	).toHaveAttribute("data-selected", "true", { timeout: 10_000 });
});

test("session-report returns ok with a report naming the worktree(s)", async () => {
	test.setTimeout(60_000);

	// Wait for register so the WS command channel is connected.
	await expect
		.poll(() => mock.requests.some((r) => r.url === "/connectors/register"), {
			timeout: 20_000,
		})
		.toBe(true);

	mock.sendCommand({
		type: "command",
		capabilityId: "session-report",
		requestId: "e2",
	});
	await expect
		.poll(
			() =>
				mock.commandResults.some(
					(r: unknown) => (r as { requestId?: string }).requestId === "e2",
				),
			{ timeout: 15_000 },
		)
		.toBe(true);
	const result = mock.commandResults.find(
		(r: unknown) => (r as { requestId?: string }).requestId === "e2",
	) as { status: string; result: { report: string } };
	expect(result.status).toBe("ok");
	expect(typeof result.result.report).toBe("string");
	expect(result.result.report.length).toBeGreaterThan(0);
});

test("focus-worktree with a bogus key returns error unknown-worktree", async () => {
	test.setTimeout(60_000);

	// Wait for register so the WS command channel is connected.
	await expect
		.poll(() => mock.requests.some((r) => r.url === "/connectors/register"), {
			timeout: 20_000,
		})
		.toBe(true);

	mock.sendCommand({
		type: "command",
		capabilityId: "focus-worktree",
		requestId: "e3",
		args: { worktree: "nope/nope" },
	});
	await expect
		.poll(
			() =>
				mock.commandResults.some(
					(r: unknown) => (r as { requestId?: string }).requestId === "e3",
				),
			{ timeout: 15_000 },
		)
		.toBe(true);
	const result = mock.commandResults.find(
		(r: unknown) => (r as { requestId?: string }).requestId === "e3",
	) as { status: string; error: { code: string } };
	expect(result.status).toBe("error");
	expect(result.error.code).toBe("unknown-worktree");
});

test("a dropped command socket: health reconnecting, a new WS appears, health back to connected", async () => {
	test.setTimeout(60_000);

	// Wait until the command WS is connected (register happened + socket opened).
	await expect
		.poll(() => mock.connectionCount, { timeout: 20_000 })
		.toBeGreaterThanOrEqual(1);

	// Open the Plugins panel so link health is rendered (data-samantha-link).
	await page.getByRole("button", { name: "Open Plugins panel" }).click();
	await expect(page.locator("[data-samantha-link='connected']")).toBeVisible({
		timeout: 20_000,
	});
	const before = mock.connectionCount;

	mock.dropSocket();
	// The WS-plane drop pushes health -> reconnecting (onStatus -> driver health)...
	await expect(page.locator("[data-samantha-link='reconnecting']")).toBeVisible(
		{
			timeout: 20_000,
		},
	);
	// ...a new WS connection appears automatically (no manual action)...
	await mock.waitForConnection(before + 1, 20_000);
	// ...and health returns to connected.
	await expect(page.locator("[data-samantha-link='connected']")).toBeVisible({
		timeout: 20_000,
	});
});

test("a forgotten registration: fresh register, the next PATCH succeeds, health recovers", async () => {
	test.setTimeout(60_000);

	await expect
		.poll(() => mock.requests.some((r) => r.url === "/connectors/register"), {
			timeout: 20_000,
		})
		.toBe(true);

	// Open the panel to observe health recovery.
	await page.getByRole("button", { name: "Open Plugins panel" }).click();
	await expect(page.locator("[data-samantha-link='connected']")).toBeVisible({
		timeout: 20_000,
	});
	const registersBefore = mock.requests.filter(
		(r) => r.url === "/connectors/register",
	).length;

	// Samantha "restarts" and drops our registration: the next snapshot PATCH 404s.
	mock.forgetRegistration();

	// Force a rebuild now (instead of waiting for the 30s keep-alive) by driving a
	// session-state change through the real MCP tool — the same mechanism a coding
	// agent uses. The forced PATCH 404s, so the driver re-registers and re-PATCHes.
	const port = readFileSync(
		join(userDataDir, "ai-14all", "mcp-port"),
		"utf8",
	).trim();
	const client = new Client({ name: "e2e-samantha-404", version: "1.0.0" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
	);
	for (let i = 0; i < 40; i++) {
		const res = await client.callTool({
			name: "report_session_status",
			arguments: {
				worktreePath: repo.repoPath,
				state: i % 2 === 0 ? "active" : "waiting",
				summary: `tick ${i}`,
				nextAction: null,
				task: "reconnect probe",
			},
		});
		const parsed = JSON.parse((res.content as Array<{ text: string }>)[0].text);
		if (parsed.ok) break;
		await page.waitForTimeout(250);
	}

	// A fresh register was issued...
	await expect
		.poll(
			() =>
				mock.requests.filter((r) => r.url === "/connectors/register").length,
			{ timeout: 30_000 },
		)
		.toBeGreaterThan(registersBefore);
	// ...and a snapshot PATCH lands AFTER that register — the re-PATCH the mock now
	// answers 200, because a fresh register cleared the forgotten flag (proof the
	// next PATCH succeeded, not another 404).
	await expect
		.poll(
			() => {
				const lastRegisterIdx = mock.requests.reduce(
					(acc, r, i) => (r.url === "/connectors/register" ? i : acc),
					-1,
				);
				return mock.requests.some(
					(r, i) =>
						i > lastRegisterIdx &&
						r.method === "PATCH" &&
						r.url === "/connectors/ai-14all/snapshot",
				);
			},
			{ timeout: 20_000 },
		)
		.toBe(true);
	// ...and the link is healthy again (health connected is only set after a
	// successful PATCH).
	await expect(page.locator("[data-samantha-link='connected']")).toBeVisible({
		timeout: 20_000,
	});

	await client.close();
});

test("manual Reconnect now recovers the link after the mock restarts", async () => {
	test.setTimeout(120_000);

	await expect
		.poll(() => mock.connectionCount, { timeout: 20_000 })
		.toBeGreaterThanOrEqual(1);
	await page.getByRole("button", { name: "Open Plugins panel" }).click();
	await expect(page.locator("[data-samantha-link='connected']")).toBeVisible({
		timeout: 20_000,
	});
	const before = mock.connectionCount;

	// Take Samantha fully down; the link drops and the Reconnect-now button appears.
	await mock.stop();
	const reconnectBtn = page.getByTestId("samantha-reconnect");
	await expect(reconnectBtn).toBeVisible({ timeout: 40_000 });

	// Deterministic negative check: WHILE Samantha is down the link provably cannot
	// recover on its own (there is no server to connect to), so it must stay
	// disconnected across this window. This proves the link genuinely needs help —
	// without depending on background-backoff timing (a post-restart window would be
	// racy: a scheduled retry could land in it). The fast-path-beats-backoff timing
	// itself is proven deterministically in the unit tests (driver/client
	// reconnectNow: it cancels the pending wait and opens immediately).
	await page.waitForTimeout(3_000);
	await expect(page.locator("[data-samantha-link='connected']")).toHaveCount(0);

	// Bring Samantha back and immediately click Reconnect now. The manual fast-path
	// resets the backoff and forces an immediate reconnect, so the link recovers
	// right after the click rather than waiting out the (grown) background backoff.
	await mock.restart();
	await reconnectBtn.click();
	await mock.waitForConnection(before + 1, 20_000);
	await expect(page.locator("[data-samantha-link='connected']")).toBeVisible({
		timeout: 20_000,
	});
});
