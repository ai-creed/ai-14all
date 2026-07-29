/**
 * Cumulative E2E for push-wake v2 (spec 2026-07-28, child spec §6): proves the
 * whole path end to end through the REAL main process — a paired-but-
 * disconnected phone, a live `report_session_status` MCP call driving a
 * "waiting" transition, and the host posting EXACTLY one visible, content-free
 * push payload to a local recorder standing in for Expo's push endpoint
 * (`AI14ALL_PUSH_WAKE_ENDPOINT` — Tasks 1/4's E2E seam). It then reconnects
 * the SAME fake phone, refreshes its authenticated-connection stamp with one
 * live capability call, drives a SECOND transition, and asserts gate 2
 * (`suppressed-connected`) — not gate 3 (`coalesced`) — is the outcome the
 * watcher audits, and that no second POST is ever sent.
 *
 * Harness copied from tests/e2e/phone-bridge.test.ts: the `registerXbpVendorTsLoader`
 * hack (Playwright/Node both refuse to transform `@xavier/xbp`'s vendored
 * TypeScript source under node_modules), `launch()`'s env seams,
 * `readStatus()`, `connectPhoneTransport()`, and the pairing steps verbatim
 * from its "pty-input" test (QR offer -> SAS confirm -> paired). Combined with
 * tests/e2e/session-attention.spec.ts's MCP client (port file at
 * `<userData>/ai-14all/mcp-port`) and its report_session_status readiness-poll
 * pattern -- extended here to retry through EVERY error code, including
 * `no_worktree` (this test always targets a worktree just loaded in
 * `beforeAll`, so an early failure is transient identity-discovery lag, not a
 * real absence -- per the brief: "extend the readiness poll, not the
 * assertions").
 *
 * CRITICAL (recorded project gotcha, same as phone-bridge.test.ts):
 * AI14ALL_USER_DATA_PATH must be set, or the app shares the real dev app's
 * userData -- including its real settings.json and any real paired phone.
 * settings.json is seeded with `phoneBridge: { enabled: true, pushWakeEnabled:
 * true }` BEFORE launch.
 */
import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import {
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
	readFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import ts from "typescript";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

// Minimal shape of the vendor Transport this file needs, kept local instead of
// a static `import type { Transport } from "@xavier/xbp/node"` -- a static
// import, type-only or not, is hoisted to link time, before
// registerXbpVendorTsLoader() below has installed its module hooks.
type PhoneTransport = {
	send(frame: Uint8Array): Promise<void>;
	close(): Promise<void>;
};

/**
 * Scoped to node_modules on both sides (resolve: only when the importing
 * module is itself under node_modules; load: only for a .ts/.mts URL under
 * node_modules) so this can never intercept this suite's own spec/fixture
 * files -- only the vendor package's TypeScript source. Copied verbatim from
 * tests/e2e/phone-bridge.test.ts.
 */
function registerXbpVendorTsLoader(): void {
	registerHooks({
		resolve(specifier, context, nextResolve) {
			if (
				specifier.endsWith(".js") &&
				context.parentURL?.includes("node_modules")
			) {
				try {
					return nextResolve(specifier, context);
				} catch (err) {
					if (
						err instanceof Error &&
						(err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
					) {
						return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
					}
					throw err;
				}
			}
			return nextResolve(specifier, context);
		},
		load(url, context, nextLoad) {
			if (
				(url.endsWith(".ts") || url.endsWith(".mts")) &&
				url.includes("/node_modules/")
			) {
				const path = fileURLToPath(url);
				const source = readFileSync(path, "utf8");
				const out = ts.transpileModule(source, {
					compilerOptions: {
						module: ts.ModuleKind.ESNext,
						target: ts.ScriptTarget.ES2022,
					},
					fileName: path,
				});
				return { format: "module", source: out.outputText, shortCircuit: true };
			}
			return nextLoad(url, context);
		},
	});
}
registerXbpVendorTsLoader();

// ---------------------------------------------------------------------------
// Shared fixture state
// ---------------------------------------------------------------------------

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let stateDir: string;
let userDataDir: string;

// Local push-stub recorder standing in for Expo's push endpoint.
let pushStub: Server;
let pushStubUrl: string;
const pushBodies: Array<Record<string, unknown>> = [];

function worktreeNav() {
	return page.getByRole("navigation", { name: "Worktree sessions" });
}

function dialog() {
	return page.locator('[data-testid="phone-bridge-dialog"]');
}

type PhoneBridgeStatus = {
	enabled: boolean;
	listening: boolean;
	addr: string | null;
	port: number | null;
	paired: boolean;
	sas: string | null;
	pairing: "idle" | "awaiting-scan" | "awaiting-sas";
	offer: string | null;
	offerExpiresAt: number | null;
	pairedAt: number | null;
	grantedPermissions: string[] | null;
	lastError: string | null;
};

function readStatus(): Promise<PhoneBridgeStatus> {
	return page.evaluate(() =>
		window.ai14all.phoneBridge.status(),
	) as Promise<PhoneBridgeStatus>;
}

// Connects to the offer's own connect.url verbatim first; the host's LAN
// IPv4 discovery can be flaky in a sandboxed test environment, so fall back
// to the loopback address on the same port -- the server binds 0.0.0.0, so
// 127.0.0.1 always reaches it too. Copied verbatim from phone-bridge.test.ts.
async function connectPhoneTransport(
	connectFn: (url: string) => Promise<PhoneTransport>,
	url: string,
	port: number,
): Promise<PhoneTransport> {
	try {
		return await connectFn(url);
	} catch {
		return connectFn(`ws://127.0.0.1:${port}`);
	}
}

const launch = () =>
	electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
			AI14ALL_USER_DATA_PATH: userDataDir,
			// The E2E seam (child spec §1): main-process fetch is invisible to
			// Playwright routing, so the push sender's endpoint override must be
			// an env var read directly by electron/main/index.ts.
			AI14ALL_PUSH_WAKE_ENDPOINT: pushStubUrl,
		},
	});

test.beforeAll(async () => {
	// Local recorder for the push sender's POSTs.
	pushStub = createServer((req, res) => {
		let raw = "";
		req.on("data", (c) => (raw += c));
		req.on("end", () => {
			pushBodies.push(JSON.parse(raw));
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ data: { status: "ok" } }));
		});
	});
	await new Promise<void>((r) => pushStub.listen(0, "127.0.0.1", r));
	pushStubUrl = `http://127.0.0.1:${(pushStub.address() as { port: number }).port}`;

	testRepo = createTestRepo();
	stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-push-wake-")));
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-push-wake-ud-")));
	writeFileSync(
		join(userDataDir, "settings.json"),
		JSON.stringify({
			version: 1,
			phoneBridge: { enabled: true, pushWakeEnabled: true },
		}),
	);

	app = await launch();
	page = await app.firstWindow({ timeout: 60_000 });

	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		worktreeNav().getByRole("button", { name: /main/i }),
	).toBeVisible({ timeout: 15_000 });
	// Select the session -- the chip bar (and the Phone Bridge entry button it
	// hosts) only renders once a session is active.
	await worktreeNav().getByRole("button", { name: /main/i }).click();

	// Same wait as session-attention.spec.ts's beforeAll: the MCP attention
	// bridge needs a live renderer session before report_session_status can
	// reliably resolve the worktree's identity.
	await expect(
		page
			.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
			.first(),
	).toBeVisible({ timeout: 15_000 });

	await expect(
		page.getByRole("button", { name: "Open Phone Bridge panel" }),
	).toBeVisible();
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		await new Promise<void>((resolve) => pushStub.close(() => resolve()));
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(userDataDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

// ---------------------------------------------------------------------------
// MCP client -- connects to the report_session_status tool, mirroring
// session-attention.spec.ts's connectMcpClient()/callReportSessionStatus().
// ---------------------------------------------------------------------------

type McpReportArgs = {
	worktreePath: string;
	state: "active" | "waiting" | "ready" | "failed";
	summary: string;
	nextAction: string | null;
};

type McpReportResult = { ok?: boolean; error?: string };

async function connectMcpClient(): Promise<Client> {
	const portStr = await readFile(
		join(userDataDir, "ai-14all", "mcp-port"),
		"utf8",
	);
	const url = `http://127.0.0.1:${portStr.trim()}/mcp`;
	const client = new Client({ name: "e2e-push-wake", version: "1.0.0" });
	await client.connect(new StreamableHTTPClientTransport(new URL(url)));
	return client;
}

async function callReportSessionStatus(
	client: Client,
	args: McpReportArgs,
): Promise<McpReportResult> {
	const result = await client.callTool({
		name: "report_session_status",
		arguments: args as unknown as Record<string, unknown>,
	});
	return JSON.parse(
		(result.content as Array<{ text: string }>)[0]!.text,
	) as McpReportResult;
}

/**
 * Drive `report_session_status` until it returns ok:true. Unlike
 * session-attention.spec.ts's `reportSessionStatusUntilBridgeReady` (which
 * treats `no_worktree` as a permanent "bridge never ready" and bails
 * immediately), this retries through EVERY error code for the full deadline --
 * this test's worktree was just loaded in `beforeAll`, so an early
 * `no_worktree` here can only be transient identity-discovery lag. Per the
 * brief: extend the readiness poll, never the assertions.
 */
async function driveAttentionUntilReady(
	client: Client,
	args: McpReportArgs,
	deadlineMs = 30_000,
): Promise<void> {
	const deadline = Date.now() + deadlineMs;
	let lastError = "unknown";
	while (Date.now() < deadline) {
		const parsed = await callReportSessionStatus(client, args);
		if (parsed.ok === true) return;
		lastError = parsed.error ?? lastError;
		await page.waitForTimeout(250);
	}
	throw new Error(
		`report_session_status never returned ok:true within ${deadlineMs}ms (last error: ${lastError})`,
	);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test("push-wake attention: waiting fires exactly one banner ping; a live authenticated phone suppresses the next transition", async () => {
	// Four chained expect.poll ceilings (30s each) plus pairing overhead.
	test.setTimeout(180_000);

	const xbp = await import("@xavier/xbp/node");
	const { registerPushTokenCapability, sessionReportCapability } =
		await import("@ai-creed/command-contract");

	await page.getByRole("button", { name: "Open Phone Bridge panel" }).click();
	await expect(dialog()).toBeVisible();

	// -- Pair via QR offer -> SAS confirm (pty-input test's steps, verbatim). --
	await dialog().getByRole("button", { name: "Pair a phone" }).click();
	await expect(dialog().getByTestId("view-scan")).toBeVisible();
	const scanStatus = await readStatus();
	expect(scanStatus.offer).not.toBeNull();
	const offer = JSON.parse(scanStatus.offer as string) as {
		token: string;
		signPubHex: string;
		boxPubHex: string;
		connect: { url: string };
	};
	expect(scanStatus.port).not.toBeNull();

	const backend = await xbp.createNodeSodiumBackend();
	const phone = xbp.generateIdentity(backend);
	const refClient = new xbp.ReferenceClient({ backend, identity: phone });
	const pairT = await connectPhoneTransport(
		xbp.connectWebSocketClient,
		offer.connect.url,
		scanStatus.port as number,
	);
	await pairT.send(refClient.buildPairRequest(offer.token));
	await expect(dialog().getByTestId("view-sas")).toBeVisible();
	await dialog().getByRole("button", { name: "Confirm", exact: true }).click();
	await expect(dialog().getByTestId("view-paired")).toBeVisible();
	await pairT.close();

	// -- Register the push token, then DISCONNECT before any transition: gate
	// 2 (suppressed-connected) must not suppress the first ping. --
	const transport = await connectPhoneTransport(
		xbp.connectWebSocketClient,
		offer.connect.url,
		scanStatus.port as number,
	);
	const peer = new xbp.Peer({ backend, identity: phone, transport });
	const hostNode = peer.addPeer(
		xbp.fromHex(offer.signPubHex),
		xbp.fromHex(offer.boxPubHex),
		[],
	);
	peer.start();

	const result = (await peer.call(hostNode, registerPushTokenCapability, {
		expoPushToken: "ExponentPushToken[e2e-push-wake]",
		platform: "ios",
	})) as { ok: boolean };
	expect(result.ok).toBe(true);

	peer.stop();
	await transport.close(); // disconnect: gate 2 must NOT suppress the first ping

	const client = await connectMcpClient();
	try {
		// -- Drive a "waiting" transition and assert exactly one POST. --
		await driveAttentionUntilReady(client, {
			worktreePath: testRepo.repoPath,
			state: "waiting",
			summary: "e2e push-wake: waiting for approval",
			nextAction: null,
		});

		await expect.poll(() => pushBodies.length, { timeout: 30_000 }).toBe(1);
		expect(pushBodies[0]).toEqual({
			to: "ExponentPushToken[e2e-push-wake]",
			title: "Xavier — something needs you",
			mutableContent: true,
			sound: "default",
		});
		expect(Object.keys(pushBodies[0]!).sort()).toEqual([
			"mutableContent",
			"sound",
			"title",
			"to",
		]);

		// -- Reconnect the SAME fake phone (same keys), refresh the
		// authenticated-connection stamp with one live capability call, then
		// drive a SECOND transition and assert suppression (not coalesce) --
		// gate 2 precedes gate 3, and the audit distinguishes them. --
		let transport2: PhoneTransport | undefined;
		let peer2Handle: { stop(): void } | undefined;
		try {
			transport2 = await connectPhoneTransport(
				xbp.connectWebSocketClient,
				offer.connect.url,
				scanStatus.port as number,
			);
			const peer2 = new xbp.Peer({
				backend,
				identity: phone,
				transport: transport2,
			});
			peer2Handle = peer2;
			const hostNode2 = peer2.addPeer(
				xbp.fromHex(offer.signPubHex),
				xbp.fromHex(offer.boxPubHex),
				[],
			);
			peer2.start();
			await peer2.call(hostNode2, sessionReportCapability, {});

			await driveAttentionUntilReady(client, {
				worktreePath: testRepo.repoPath,
				state: "failed",
				summary: "e2e push-wake: failed while phone connected",
				nextAction: null,
			});

			await expect
				.poll(
					() => {
						try {
							return readFileSync(
								join(userDataDir, "logs", "push-wake-audit.jsonl"),
								"utf8",
							)
								.trim()
								.split("\n")
								.map((l) => JSON.parse(l) as { outcome: string })
								.some((e) => e.outcome === "suppressed-connected");
						} catch {
							return false;
						}
					},
					{ timeout: 30_000 },
				)
				.toBe(true);

			expect(pushBodies).toHaveLength(1); // still exactly one POST
		} finally {
			peer2Handle?.stop();
			if (transport2) await transport2.close();
		}
	} finally {
		await client.close();
	}
});
