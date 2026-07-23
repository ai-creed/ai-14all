/**
 * E2E proof for the redesigned Phone Bridge dialog (spec 2026-07-15): the
 * single-view state machine driven by main-process PhoneBridgeStatus, and a
 * real end-to-end pairing against the live XbpHostService LAN listener.
 *
 * Test 1 drives the UI-only edges of the state machine: idle -> off -> idle
 * -> scan -> cancel. Test 2 drives a full pairing round trip — a second
 * process (standing in for "the phone") speaks the XBP protocol directly
 * against the app's LAN websocket, using the offer the QR encodes (read back
 * via the app's own `phoneBridge.status()` API rather than decoding the QR
 * image) — through SAS confirmation, the paired-device card, and unpair.
 *
 * Harness copied from tests/e2e/settings-persistence.test.ts (electron.launch
 * env seams, createTestRepo, closeApp) and tests/e2e/session-chip-bar.test.ts
 * (the Browse -> Load -> select-session sequence needed before the chip bar,
 * and therefore the Phone Bridge entry button, renders — MainColumnChrome
 * only mounts SessionChipBar when `activeWorktree && activeSession`).
 *
 * The phone-side protocol driving mirrors tests/integration/xbp/pairing-helpers.ts
 * `pairPhone`: createNodeSodiumBackend + generateIdentity + ReferenceClient +
 * connectWebSocketClient from `@xavier/xbp/node`, sending a pair-request frame
 * built from the offer's token. No response frame needs to be read back on the
 * test side — the SAS shows up on the host UI as soon as the host processes the
 * frame, and confirmation happens from the host side via the "Confirm" button,
 * exactly as pairPhone's `svc.confirmPairing(true)` does for the host-only
 * integration tests.
 *
 * CRITICAL (recorded project gotcha): AI14ALL_USER_DATA_PATH must be set, or
 * the app shares the real dev app's userData — including its real
 * settings.json and any real paired phone. settings.json is seeded with
 * `phoneBridge.enabled: true` BEFORE launch (the entry button renders nothing
 * when the flag is off — PhoneBridgeEntryButton.tsx).
 *
 * ENVIRONMENT NOTE: `@xavier/xbp` (vendor/xavier-xbp-*.tgz) ships raw .ts
 * source with no compiled dist — its package.json "exports" map points
 * straight at src/*.ts. Vitest (tests/integration/xbp) transforms that via
 * esbuild without complaint, but this Playwright run is Node 26 + Playwright
 * 1.59, and BOTH refuse to touch TypeScript files under node_modules: Node's
 * native type-stripping loader throws "Stripping types is currently
 * unsupported for files under node_modules", and Playwright's own transform
 * deliberately skips node_modules too (transform/compilationCache.js
 * belongsToNodeModules), falling through to that same native loader.
 * `registerXbpVendorTsLoader()` below installs a scoped `node:module`
 * `registerHooks()` customization — active for this file's process only,
 * never touching non-node_modules files — that transpiles just the vendor
 * package's .ts files with the (already-a-devDependency) `typescript`
 * compiler and resolves its `./foo.js` relative specifiers to the co-located
 * `./foo.ts` source when no compiled .js exists. `@xavier/xbp/node` is then
 * imported dynamically (never as a static top-level import, which would
 * resolve before this file's own module body — and this hook install — runs).
 */
import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import ts from "typescript";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";
// Plain ws + node https fixture (Task 8): no vendored TS, so it transforms
// under Playwright's loader without the registerHooks dance above.
import { startFakeRelay } from "../fixtures/fake-relay";

// Minimal shape of the vendor Transport this file needs — kept local instead
// of a static `import type { Transport } from "@xavier/xbp/node"` so nothing
// in this file resolves the vendor package before registerXbpVendorTsLoader()
// runs (a static import, type-only or not, is hoisted to link time).
type PhoneTransport = {
	send(frame: Uint8Array): Promise<void>;
	close(): Promise<void>;
};

/**
 * Scoped to node_modules on both sides (resolve: only when the importing
 * module is itself under node_modules; load: only for a .ts/.mts URL under
 * node_modules) so this can never intercept this suite's own spec/fixture
 * files — only the vendor package's TypeScript source.
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

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let stateDir: string;
let userDataDir: string;

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

// Connects to the offer's own connect.urls[0] (what a scanned phone uses)
// verbatim first; the host's LAN IPv4 discovery can be flaky in a sandboxed
// test environment, so fall back to the loopback address on the same port —
// the server binds 0.0.0.0, so 127.0.0.1 always reaches it too.
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
		},
	});

test.beforeAll(async () => {
	testRepo = createTestRepo();
	stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phone-bridge-")));
	userDataDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-phone-bridge-ud-")),
	);
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
	// Select the session — the chip bar (and the Phone Bridge entry button it
	// hosts) only renders once a session is active.
	await worktreeNav().getByRole("button", { name: /main/i }).click();
	await expect(
		page.getByRole("button", { name: "Open Phone Bridge panel" }),
	).toBeVisible();
}, 90_000);

test.afterAll(async () => {
	if (app) await closeApp(app);
	rmSync(stateDir, { recursive: true, force: true });
	rmSync(userDataDir, { recursive: true, force: true });
	testRepo?.cleanup();
});

test("dialog walks the state machine: idle -> off -> idle -> scan -> cancel", async () => {
	await page.getByRole("button", { name: "Open Phone Bridge panel" }).click();
	await expect(dialog()).toBeVisible();

	// Booted with phoneBridge.enabled true and no paired device: idle, and the
	// host's own LAN listener address is reflected in the status strip.
	await expect(dialog().getByTestId("view-idle")).toBeVisible();
	// Tolerant matcher: primaryLanIPv4() returns null on a loopback-only
	// runner (xbp-host-service.ts getStatus() has no loopback fallback for
	// `addr`), so don't hard-require a dotted-quad IPv4 shape here.
	await expect(dialog()).toContainText(/Listening on \S+:\d+/);

	const enableSwitch = dialog().getByRole("switch", {
		name: "Enable phone bridge",
	});

	await enableSwitch.click();
	await expect(dialog().getByTestId("view-off")).toBeVisible();
	await expect(dialog()).toContainText("Bridge off");

	await enableSwitch.click();
	await expect(dialog().getByTestId("view-idle")).toBeVisible();

	await dialog().getByRole("button", { name: "Pair a phone" }).click();
	await expect(dialog().getByTestId("view-scan")).toBeVisible();
	await expect(dialog().getByTestId("pairing-qr")).toBeVisible();
	await expect(dialog()).toContainText(/Expires in \d+:\d{2}/);

	await dialog().getByRole("button", { name: "Cancel" }).click();
	await expect(dialog().getByTestId("view-idle")).toBeVisible();
});

test("full pairing: QR offer -> SAS confirm -> paired card -> unpair", async () => {
	// Dynamic, not static: registerXbpVendorTsLoader() must already be
	// installed (it is, at module top level) before this resolves.
	const xbp = await import("@xavier/xbp/node");

	await dialog().getByRole("button", { name: "Pair a phone" }).click();
	await expect(dialog().getByTestId("view-scan")).toBeVisible();
	await expect(dialog().getByTestId("pairing-qr")).toBeVisible();

	// Read the offer the QR encodes via the app's own API rather than
	// decoding the rendered QR image.
	const scanStatus = await readStatus();
	expect(scanStatus.offer).not.toBeNull();
	const offer = JSON.parse(scanStatus.offer as string) as {
		token: string;
		connect: { urls: string[] };
	};
	expect(scanStatus.port).not.toBeNull();

	const backend = await xbp.createNodeSodiumBackend();
	const phone = xbp.generateIdentity(backend);
	const refClient = new xbp.ReferenceClient({ backend, identity: phone });
	const transport = await connectPhoneTransport(
		xbp.connectWebSocketClient,
		offer.connect.urls[0],
		scanStatus.port as number,
	);

	try {
		await transport.send(refClient.buildPairRequest(offer.token));

		await expect(dialog().getByTestId("view-sas")).toBeVisible();
		const sasText = await dialog()
			.locator(".phone-bridge__sas-digits")
			.textContent();
		expect(sasText?.trim()).toMatch(/^\d{3} \d{3}$/);

		await dialog()
			.getByRole("button", { name: "Confirm", exact: true })
			.click();

		await expect(dialog().getByTestId("view-paired")).toBeVisible();
		await expect(dialog()).toContainText("Phone paired");
		await expect(dialog()).toContainText("Paired just now");
		await expect(dialog()).toContainText(
			"Permissions: session reports · can act on workflows",
		);

		await dialog().getByRole("button", { name: "Unpair" }).click();
		await expect(dialog().getByTestId("unpair-confirm")).toBeVisible();

		await dialog()
			.getByRole("button", { name: "Confirm unpair", exact: true })
			.click();
		await expect(dialog().getByTestId("view-idle")).toBeVisible();
	} finally {
		await transport.close();
	}
});

// Drives the app from a freshly-loaded window to the visible Phone Bridge
// entry button: Browse (auto-filled via AI14ALL_E2E_PICK_PATH) -> Load ->
// select the `main` session (the chip bar that hosts the entry button only
// mounts once a session is active). Parameterised on `p` so it can run against
// a second/relaunched window without touching the shared module-level `page`.
async function reachPhoneBridgeButton(p: Page, repoPath: string): Promise<void> {
	const nav = p.getByRole("navigation", { name: "Worktree sessions" });
	await p.getByRole("button", { name: "Browse" }).click();
	await expect(p.locator("#repo-path")).toHaveValue(repoPath);
	await p.getByRole("button", { name: "Load" }).click();
	await expect(nav.getByRole("button", { name: /main/i })).toBeVisible({
		timeout: 15_000,
	});
	await nav.getByRole("button", { name: /main/i }).click();
	await expect(
		p.getByRole("button", { name: "Open Phone Bridge panel" }),
	).toBeVisible();
}

/**
 * Off-LAN relay settings, end to end through the REAL main -> IPC -> renderer
 * bridge. Proves all three XbpStatus.relay values surface in the panel's
 * status line, that the base URL persists across a relaunch, and that Task 9's
 * boot wiring (initialRelayBaseUrl) re-registers on startup:
 *
 *   empty field -> "Relay: off"
 *   fill fake-relay URL + blur (live-apply) -> "Relay: registered"
 *   relaunch (same userData, relay still up) -> field persisted + registered
 *   relay.close() (connection lost, backoff redial refused) -> "Relay: retrying"
 *   clear field + blur (live-apply teardown) -> "Relay: off"
 *
 * Runs its OWN isolated app instance (own repo/state/userData) rather than the
 * shared beforeAll app: it must relaunch, and the beforeAll app is still alive
 * here — separate git state avoids worktree contention. NODE_TLS_REJECT_UNAUTHORIZED
 * is set on THIS launch only so the app process trusts the fake relay's
 * self-signed fixture cert (tests/fixtures/tls).
 */
test("relay status: off -> registered -> persists -> retrying -> off via the real bridge", async () => {
	// Two full launches + a backoff wait exceed the 60s default test timeout.
	test.setTimeout(240_000);

	const relayRepo = createTestRepo();
	const relayStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-relay-")));
	const relayUserData = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-relay-ud-")),
	);
	writeFileSync(
		join(relayUserData, "settings.json"),
		JSON.stringify({
			version: 1,
			phoneBridge: { enabled: true, pushWakeEnabled: true, relayBaseUrl: "" },
		}),
	);

	// A FRESH workspace-state path per launch: settings.json (relayUserData) is
	// what must persist across the relaunch, not workspace state. Reusing one
	// state file would auto-restore the loaded workspace on boot 2, skipping the
	// Browse/pick screen that reachPhoneBridgeButton drives. The relay URL still
	// persists because relayUserData is shared across launches.
	let launchSeq = 0;
	const launchRelayApp = () =>
		electron.launch({
			args: ["out/main/index.js"],
			env: {
				...process.env,
				AI14ALL_E2E: "1",
				AI14ALL_E2E_PICK_PATH: relayRepo.repoPath,
				AI14ALL_WORKSPACE_STATE_PATH: join(
					relayStateDir,
					`workspace-state-${++launchSeq}.json`,
				),
				AI14ALL_USER_DATA_PATH: relayUserData,
				// Trust the fake relay's self-signed fixture cert — this app process
				// only, not the shared beforeAll launch.
				NODE_TLS_REJECT_UNAUTHORIZED: "0",
			},
		});

	const relay = await startFakeRelay();
	let relayClosed = false;
	let relayApp: ElectronApplication | undefined;
	let relayPage: Page;

	const dlg = () => relayPage.locator('[data-testid="phone-bridge-dialog"]');
	const relayInput = () => dlg().locator("#phone-bridge-relay-url");
	// The status line is a bare <span>Relay: {status.relay}</span>; locate it by
	// its rendered text (the only element matching this shape).
	const statusLine = () =>
		dlg().getByText(/^Relay: (off|registered|retrying)$/);

	async function openPanel(): Promise<void> {
		await reachPhoneBridgeButton(relayPage, relayRepo.repoPath);
		await relayPage
			.getByRole("button", { name: "Open Phone Bridge panel" })
			.click();
		await expect(dlg()).toBeVisible();
		await expect(dlg().getByTestId("view-idle")).toBeVisible();
	}

	try {
		// --- Boot 1: no relay configured -> off ---
		relayApp = await launchRelayApp();
		relayPage = await relayApp.firstWindow({ timeout: 60_000 });
		await openPanel();
		await expect(relayInput()).toHaveValue("");
		await expect(statusLine()).toHaveText("Relay: off");

		// --- Live-apply: fill base URL + blur -> registered ---
		await relayInput().fill(relay.baseUrl);
		await relayInput().blur();
		await expect(statusLine()).toHaveText(/registered/, { timeout: 15_000 });

		// --- Relaunch (same userData, relay still up): persistence + boot wiring ---
		await closeApp(relayApp);
		relayApp = await launchRelayApp();
		relayPage = await relayApp.firstWindow({ timeout: 60_000 });
		await openPanel();
		// Field value proves persistence; the registered status proves Task 9's
		// initialRelayBaseUrl re-registered on boot, not merely a restored string.
		await expect(relayInput()).toHaveValue(relay.baseUrl);
		await expect(statusLine()).toHaveText(/registered/, { timeout: 15_000 });

		// --- Loss: relay goes away -> backoff redial refused -> retrying ---
		await relay.close();
		relayClosed = true;
		await expect(statusLine()).toHaveText(/retrying/, { timeout: 20_000 });

		// --- Live-apply teardown: clear field + blur -> off (no relaunch) ---
		await relayInput().fill("");
		await relayInput().blur();
		await expect(statusLine()).toHaveText("Relay: off");
	} finally {
		await closeApp(relayApp);
		if (!relayClosed) await relay.close().catch(() => {});
		rmSync(relayStateDir, { recursive: true, force: true });
		rmSync(relayUserData, { recursive: true, force: true });
		relayRepo.cleanup();
	}
});
