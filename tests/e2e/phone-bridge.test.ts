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

// Connects to the offer's own connect.url (what a scanned phone uses)
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
		connect: { url: string };
	};
	expect(scanStatus.port).not.toBeNull();

	const backend = await xbp.createNodeSodiumBackend();
	const phone = xbp.generateIdentity(backend);
	const refClient = new xbp.ReferenceClient({ backend, identity: phone });
	const transport = await connectPhoneTransport(
		xbp.connectWebSocketClient,
		offer.connect.url,
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

test("pty-input: host disarm switch gates a paired phone's terminal input", async () => {
	const xbp = await import("@xavier/xbp/node");
	const { ptyInputCapability } = await import("@ai-creed/command-contract");

	// -- Pair afresh (the previous test unpaired). Same flow as test 2.
	await dialog().getByRole("button", { name: "Pair a phone" }).click();
	await expect(dialog().getByTestId("view-scan")).toBeVisible();
	const scanStatus = await readStatus();
	const offer = JSON.parse(scanStatus.offer as string) as {
		token: string;
		signPubHex: string;
		boxPubHex: string;
		connect: { url: string };
	};
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

	// New pairing carries control:pty-write — visible in the permissions line.
	await expect(dialog()).toContainText("can type into terminals");

	// -- Register a REAL terminal as a live agent PTY (renderer-side, exactly
	// how agent detection publishes it in production).
	const target = await page.evaluate(async (repoPath: string) => {
		const ai = (window as unknown as { ai14all: typeof window.ai14all })
			.ai14all;
		const ws = await ai.workspace.openRepository(repoPath);
		const worktrees = await ai.repository.listWorktrees(ws.workspaceId);
		const wt =
			worktrees.find((w: { path: string }) => w.path === repoPath) ??
			worktrees[0];
		const session = await ai.terminals.create(ws.workspaceId, wt.id, repoPath);
		await ai.agentPtys.upsert({
			worktreeId: wt.id,
			agentId: "e2e-agent",
			terminalSessionId: session.id,
			provider: null,
			label: "e2e agent",
			live: true,
			agentDetected: true,
		});
		return { worktreeId: wt.id, agentId: "e2e-agent" };
	}, testRepo.repoPath);

	// -- Phone-side Peer against the live LAN listener, keys from the offer.
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

	type SendResult =
		| { ok: true; appliedAt: number }
		| { ok: false; code: string };
	const send = (): Promise<SendResult> =>
		peer.call(hostNode, ptyInputCapability, {
			worktreeId: target.worktreeId,
			agentId: target.agentId,
			chunks: [{ text: "echo pty-input-e2e" }, { key: "enter" }],
		}) as Promise<SendResult>;

	try {
		// Armed (default): input applies to the real shell PTY.
		await expect.poll(async () => (await send()).ok).toBe(true);

		// Disarm on the host → the same request is refused in-band.
		const inputSwitch = dialog().getByRole("switch", {
			name: "Allow phone terminal input",
		});
		await inputSwitch.click();
		await expect(inputSwitch).not.toBeChecked();
		await expect
			.poll(async () => {
				const res = await send();
				return res.ok ? "ok" : res.code;
			})
			.toBe("pty-input-disabled");

		// Re-arm → input applies again.
		await inputSwitch.click();
		await expect(inputSwitch).toBeChecked();
		await expect.poll(async () => (await send()).ok).toBe(true);
	} finally {
		peer.stop();
		await transport.close();
	}
});
