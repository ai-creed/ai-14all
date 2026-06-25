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
const ACTING_TOKEN = "s4-e2e-secret";

// Launch with acting either off or on. The worktree is selected but no terminal
// is spawned, so its slice carries sessionId: null -> the instruct router sees an
// "absent" session and returns no-live-agent (never send-input).
async function launchApp(actingEnabled: boolean): Promise<void> {
	mock = await startMockSamantha();
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-sam-act-")));
	writeFileSync(
		join(userDataDir, "config.toml"),
		`[plugins.samantha]\nenabled = true\n\n[plugins.samantha.behavior]\nfocus_raises_window = false\nacting_enabled = ${actingEnabled}\n`,
		"utf8",
	);
	// Provision the acting token secret the verifier reads.
	const tokenPath = join(userDataDir, "connector-token");
	writeFileSync(tokenPath, ACTING_TOKEN, "utf8");

	repo = createTestRepo();
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: repo.repoPath,
			AI14ALL_USER_DATA_PATH: userDataDir,
			AI_SAMANTHA_CONNECTOR_PORT: String(mock.port),
			SAMANTHA_ACTING_TOKEN_PATH: tokenPath,
			// Suppress the auto default-shell that fires when agentsAvailable===false.
			// With agents "present", the slot stays empty -> sessionId remains null
			// -> buildTargetSessionState returns "absent" -> routeInstruction returns
			// no-live-agent (never send-input). This is the determinism the brief
			// describes: "no terminal is spawned, sessionId null -> absent".
			AI14ALL_FAKE_AGENT_CLIS: "claude",
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(repo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	const nav = page.getByRole("navigation", { name: "Worktree sessions" });
	await expect(nav.getByRole("button", { name: /main/i })).toBeVisible({
		timeout: 15_000,
	});
	await nav.getByRole("button", { name: /main/i }).click();
}

test.afterEach(async () => {
	await closeApp(app);
	app = undefined;
	await mock.close();
	rmSync(userDataDir, { recursive: true, force: true });
	repo.cleanup();
});

function resultFor(
	requestId: string,
): { status: string; error?: { code: string } } | undefined {
	return mock.commandResults.find(
		(r: unknown) => (r as { requestId?: string }).requestId === requestId,
	) as { status: string; error?: { code: string } } | undefined;
}

// The acting audit log lives at <userData>/logs/acting-audit.jsonl
// (electron/main/index.ts: logsDir = join(app.getPath("userData"), "logs")).
function auditLineCount(): number {
	try {
		const raw = readFileSync(
			join(userDataDir, "logs", "acting-audit.jsonl"),
			"utf8",
		);
		return raw.split("\n").filter((l) => l.trim().length > 0).length;
	} catch {
		return 0;
	}
}

async function waitForRegister(): Promise<void> {
	await expect
		.poll(() => mock.requests.some((r) => r.url === "/connectors/register"), {
			timeout: 20_000,
		})
		.toBe(true);
}

// Wait for a PATCH snapshot with at least one worktree key and return the first
// key ("<repo>/<branch>"). The repo name is the basename of the tmp dir (not
// "ai-14all"), so we cannot hardcode it — derive it from the live snapshot.
async function waitForWorktreeKey(): Promise<string> {
	let key: string | undefined;
	await expect
		.poll(
			() => {
				const patch = [...mock.requests]
					.reverse()
					.find(
						(r) =>
							r.method === "PATCH" &&
							r.url === "/connectors/ai-14all/snapshot" &&
							r.body !== null &&
							typeof (r.body as { details?: unknown }).details === "object" &&
							Object.keys(
								(r.body as { details: Record<string, unknown> }).details,
							).length > 0,
					);
				if (!patch) return undefined;
				key = Object.keys(
					(patch.body as { details: Record<string, unknown> }).details,
				)[0];
				return key;
			},
			{ timeout: 20_000 },
		)
		.toBeTruthy();
	return key as string;
}

test.describe("acting disabled (toggle off)", () => {
	test.beforeEach(() => launchApp(false));

	test("instruct-session with a valid token returns acting-disabled", async () => {
		test.setTimeout(60_000);
		await waitForRegister();
		// Valid token (token gate passes) + acting OFF -> the acting gate rejects
		// before worktree resolution, so the key value does not matter here.
		mock.sendCommand({
			type: "command",
			capabilityId: "instruct-session",
			requestId: "act-off",
			args: { worktree: "ai-14all/main", instruction: "add tests" },
			token: ACTING_TOKEN,
		});
		await expect
			.poll(() => resultFor("act-off")?.error?.code, { timeout: 15_000 })
			.toBe("acting-disabled");
	});
});

test.describe("acting enabled (toggle on, no live agent)", () => {
	test.beforeEach(() => launchApp(true));

	test("instruct-session with a valid token and no live agent returns no-live-agent", async () => {
		test.setTimeout(60_000);
		// Derive the real worktree key from the live snapshot (repo name = tmp basename).
		const worktreeKey = await waitForWorktreeKey();
		// Valid token + acting ON -> BOTH gates pass; prepare/router run. The main
		// worktree has no spawned terminal (sessionId null) -> absent -> no-live-agent.
		mock.sendCommand({
			type: "command",
			capabilityId: "instruct-session",
			requestId: "act-on",
			args: { worktree: worktreeKey, instruction: "do it" },
			token: ACTING_TOKEN,
		});
		await expect
			.poll(() => resultFor("act-on")?.error?.code, { timeout: 15_000 })
			.toBe("no-live-agent");
	});

	test("a duplicate instruct-session frame replays no-live-agent without re-entering the guard", async () => {
		test.setTimeout(60_000);
		// Derive the real worktree key from the live snapshot (repo name = tmp basename).
		const worktreeKey = await waitForWorktreeKey();

		const frame = {
			type: "command" as const,
			capabilityId: "instruct-session" as const,
			requestId: "dup-act",
			args: { worktree: worktreeKey, instruction: "go" },
			token: ACTING_TOKEN,
		};
		// First send: passes both gates; router returns no-live-agent; ActGuard writes
		// exactly one result audit entry; the dispatcher caches the typed result.
		mock.sendCommand(frame);
		await expect
			.poll(() => resultFor("dup-act")?.error?.code, { timeout: 15_000 })
			.toBe("no-live-agent");
		const auditAfterFirst = auditLineCount();
		const resultsAfterFirst = mock.commandResults.length;
		expect(auditAfterFirst).toBeGreaterThan(0);

		// Re-send the SAME requestId -> dedup replays the cached result; the guard is
		// NOT re-entered, so the audit line count is unchanged.
		mock.sendCommand(frame);
		await expect
			.poll(() => mock.commandResults.length, { timeout: 15_000 })
			.toBeGreaterThan(resultsAfterFirst); // the resend WAS answered
		expect(
			mock.commandResults.filter(
				(r: unknown) => (r as { requestId?: string }).requestId === "dup-act",
			).length,
		).toBe(2);
		expect(auditLineCount()).toBe(auditAfterFirst); // did NOT re-execute
	});
});
