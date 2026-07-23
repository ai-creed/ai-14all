import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createNodeSodiumBackend,
	deriveHostId,
	fromHex,
	generateIdentity,
	toHex,
} from "@xavier/xbp/node";
import { XbpHostService } from "../../../services/xbp/xbp-host-service";
import { XbpSecureStorageUnavailableError } from "../../../services/xbp/xbp-identity-store";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { XbpPairedDeviceStore } from "../../../services/xbp/xbp-paired-device-store";
import { XbpPushTokenStore } from "../../../services/xbp/xbp-push-token-store";
import type { RelayControlSocket } from "../../../services/xbp/relay-registration";
import type { AttachableSocket } from "../../../services/xbp/attachable-transport";

const okStorage = {
	isEncryptionAvailable: () => true,
	encryptString: (s: string) => Buffer.from(s, "utf8"),
	decryptString: (b: Buffer) => b.toString("utf8"),
};

function makeService(
	opts: {
		storage?: typeof okStorage;
		dir?: string;
		initialRelayBaseUrl?: string;
		relaySocketFactory?: (url: string) => RelayControlSocket;
		relayJitter?: () => number;
		relayAcceptDial?: (
			url: string,
			attach: (socket: AttachableSocket) => void,
		) => void;
		onStatusChange?: () => void;
	} = {},
) {
	const {
		storage = okStorage,
		dir = mkdtempSync(join(tmpdir(), "xbp-svc-")),
		...rest
	} = opts;
	return new XbpHostService({
		dir,
		secureStorage: storage,
		getSessionReport: async () => ({
			mode: "ready",
			focus: null,
			sessions: [],
		}),
		subscribeChanges: () => () => {},
		...rest,
	});
}

// Schema-valid hex fixtures: RelayHostBound (vendor protocol/relay.ts) pins
// hostIdHex/nonceHex at 64 hex chars and tokenHex at 32 — the machine parses
// every relay frame, so short/non-hex placeholders would fail PARSE and close
// 4400 before reaching the service. See relay-registration.test.ts for the
// same adaptation.
const HOST_ID_HEX = "ab".repeat(32); // 64 hex chars
const NONCE_HEX = "00".repeat(32); // 64 hex chars
const TOKEN_HEX = "cd".repeat(16); // 32 hex chars

// A scripted relay control socket the service dials through relaySocketFactory,
// letting the test drive the relay's open/message/close events with no network.
// Mirrors the ws close semantics (a local close() also fires the close event).
function relayHarness() {
	const dialed: string[] = [];
	const closedWith: number[] = [];
	let sock: {
		open: () => void;
		message: (m: unknown) => void;
		closeFromRelay: (code: number) => void;
	} | null = null;

	const factory = (url: string): RelayControlSocket => {
		dialed.push(url);
		let onOpen: (() => void) | null = null;
		let onMessage: ((d: unknown) => void) | null = null;
		let onClose: ((c: number) => void) | null = null;
		const s: RelayControlSocket = {
			send: () => {},
			close: (code) => {
				closedWith.push(code ?? 1000);
				onClose?.(code ?? 1000);
			},
			onOpen: (cb) => {
				onOpen = cb;
			},
			onMessage: (cb) => {
				onMessage = cb;
			},
			onClose: (cb) => {
				onClose = cb;
			},
		};
		sock = {
			open: () => onOpen?.(),
			message: (m) => onMessage?.(JSON.stringify(m)),
			closeFromRelay: (c) => onClose?.(c),
		};
		return s;
	};

	// Drive the full happy-path handshake to "registered".
	const register = () => {
		sock!.open();
		sock!.message({ t: "challenge", nonceHex: NONCE_HEX });
		sock!.message({ t: "registered", hostId: HOST_ID_HEX });
	};

	// A no-op attachable socket the accept-dial seam can hand to lan.attach().
	const attachableStub = (): AttachableSocket => ({
		send: () => {},
		close: () => {},
		onMessage: () => {},
		onClose: () => {},
	});

	return {
		factory,
		dialed,
		closedWith,
		register,
		attachableStub,
		sock: () => sock!,
	};
}

let svc: XbpHostService | undefined;
afterEach(async () => {
	await svc?.stop();
	svc = undefined;
});

describe("XbpHostService", () => {
	it("starts a LAN listener and reports status", async () => {
		svc = makeService();
		const res = await svc.start();
		expect(res.listening).toBe(true);
		expect(res.port).toBeGreaterThan(0);
		expect(svc.getStatus().enabled).toBe(true);
	});

	it("fails closed when secure storage is unavailable", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-svc-"));
		svc = new XbpHostService({
			dir,
			secureStorage: { ...okStorage, isEncryptionAvailable: () => false },
			getSessionReport: async () => ({
				mode: "ready",
				focus: null,
				sessions: [],
			}),
			subscribeChanges: () => () => {},
		});
		await expect(svc.start()).rejects.toBeInstanceOf(
			XbpSecureStorageUnavailableError,
		);
		expect(svc.getStatus().listening).toBe(false);
		// AC6: the safeStorage-unavailable refusal must be written to the audit log.
		const audit = new XbpAuditSink({ dir });
		expect(audit.entries()).toContainEqual(
			expect.objectContaining({
				outcome: "rejected",
				reason: "safe-storage-unavailable",
			}),
		);
	});

	it("disable (setEnabled false) stops listening and drops the session", async () => {
		svc = makeService();
		await svc.start();
		await svc.setEnabled(false);
		expect(svc.getStatus().listening).toBe(false);
	});

	it("setKillSwitch(true) leaves the bridge listening and forwards to the pairing host", async () => {
		svc = makeService();
		await svc.start();
		svc.setKillSwitch(true);
		expect(svc.getStatus().listening).toBe(true);
		// pairing host refuses sealed frames under kill: exercised end-to-end in
		// tests/integration/xbp/kill-switch.test.ts; here we assert no teardown.
		svc.setKillSwitch(false);
		expect(svc.getStatus().listening).toBe(true);
	});

	it("reports sas:null before any pair-request arrives", async () => {
		svc = makeService();
		await svc.start();
		expect(svc.getStatus().sas).toBeNull();
	});

	it("re-attaches a persisted paired device on restart (paired survives a fresh start)", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-restart-"));
		const phone = generateIdentity(backend);
		new XbpPairedDeviceStore({ dir, secureStorage: okStorage }).save({
			signPubHex: toHex(phone.sign.publicKey),
			boxPubHex: toHex(phone.box.publicKey),
			pairedAt: 1,
		});
		svc = new XbpHostService({
			dir,
			secureStorage: okStorage,
			getSessionReport: async () => ({
				mode: "ready",
				focus: null,
				sessions: [],
			}),
			subscribeChanges: () => () => {},
		});
		await svc.start();
		expect(svc.getStatus().paired).toBe(true);
	});

	it("forgetDevice() clears the paired device, push token, audits once, emits status, and stays enabled", async () => {
		const backend = await createNodeSodiumBackend();
		const dir = mkdtempSync(join(tmpdir(), "xbp-forget-"));
		const phone = generateIdentity(backend);
		new XbpPairedDeviceStore({ dir, secureStorage: okStorage }).save({
			signPubHex: toHex(phone.sign.publicKey),
			boxPubHex: toHex(phone.box.publicKey),
			pairedAt: 1,
		});
		const pushTokenStore = new XbpPushTokenStore({
			dir,
			secureStorage: okStorage,
		});
		pushTokenStore.save({
			expoPushToken: "ExponentPushToken[forget-me]",
			platform: "ios",
			registeredAt: 1,
		});
		let statusChanges = 0;
		svc = new XbpHostService({
			dir,
			secureStorage: okStorage,
			getSessionReport: async () => ({
				mode: "ready",
				focus: null,
				sessions: [],
			}),
			subscribeChanges: () => () => {},
			onStatusChange: () => {
				statusChanges++;
			},
			pushTokenStore,
		});
		await svc.start();
		expect(svc.getStatus().paired).toBe(true);
		expect(pushTokenStore.exists()).toBe(true);
		const changesBefore = statusChanges;

		await svc.forgetDevice();

		const status = svc.getStatus();
		expect(status.paired).toBe(false);
		expect(status.enabled).toBe(true);
		expect(status.listening).toBe(true);
		expect(status.sas).toBeNull();
		expect(
			new XbpPairedDeviceStore({ dir, secureStorage: okStorage }).load(),
		).toBeNull();
		expect(pushTokenStore.exists()).toBe(false);
		expect(statusChanges).toBe(changesBefore + 1);

		// Exactly one accepted device-forgotten entry, zero rejected noise.
		const entries = new XbpAuditSink({ dir }).entries();
		expect(
			entries.filter(
				(e) => e.outcome === "accepted" && e.reason === "device-forgotten",
			),
		).toHaveLength(1);
		expect(entries.filter((e) => e.outcome === "rejected")).toHaveLength(0);
	});

	it("forgetDevice() is idempotent when nothing is paired", async () => {
		svc = makeService();
		await svc.start();
		await svc.forgetDevice();
		await svc.forgetDevice();
		expect(svc.getStatus().paired).toBe(false);
		expect(svc.getStatus().enabled).toBe(true);
		expect(svc.getStatus().listening).toBe(true);
	});

	it("offer carries only the LAN URL when relayBaseUrl is unset", async () => {
		svc = makeService();
		await svc.start();
		const offer = await svc.startPairing();
		expect(offer.connect.urls).toHaveLength(1);
		expect(offer.connect.urls[0]).toMatch(/^ws:\/\//);
	});

	it("offer carries LAN first, relay /connect/<hostId> second when set", async () => {
		svc = makeService({ initialRelayBaseUrl: "wss://relay.example.com" });
		await svc.start();
		const offer = await svc.startPairing();
		expect(offer.connect.urls).toHaveLength(2);
		expect(offer.connect.urls[0]).toMatch(/^ws:\/\//);
		const backend = await createNodeSodiumBackend();
		const expectedHostId = deriveHostId(backend, fromHex(offer.signPubHex));
		expect(offer.connect.urls[1]).toBe(
			`wss://relay.example.com/connect/${expectedHostId}`,
		);
	});
});

describe("XbpHostService relay registration lifecycle", () => {
	const BASE = "wss://relay.example.com";

	it("start() with initialRelayBaseUrl dials <base>/host and registers", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-relay-"));
		const h = relayHarness();
		svc = makeService({
			dir,
			initialRelayBaseUrl: BASE,
			relaySocketFactory: h.factory,
			relayJitter: () => 1,
		});
		await svc.start();
		expect(h.dialed).toEqual([`${BASE}/host`]);
		expect(svc.getStatus().relay).toBe("retrying"); // dialed (connecting), not yet registered

		h.register();
		expect(svc.getStatus().relay).toBe("registered");

		expect(new XbpAuditSink({ dir }).entries()).toContainEqual(
			expect.objectContaining({
				event: "relay-registered",
				level: "info",
				outcome: "accepted",
				cap: null,
			}),
		);
	});

	it("start() without a relayBaseUrl performs zero relay dials and relay is off", async () => {
		const h = relayHarness();
		svc = makeService({ relaySocketFactory: h.factory });
		await svc.start();
		expect(h.dialed).toEqual([]);
		expect(svc.getStatus().relay).toBe("off");
	});

	it("relay close after registration flips relay to retrying and audits the loss", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-relay-"));
		const h = relayHarness();
		svc = makeService({
			dir,
			initialRelayBaseUrl: BASE,
			relaySocketFactory: h.factory,
			relayJitter: () => 1,
		});
		await svc.start();
		h.register();
		expect(svc.getStatus().relay).toBe("registered");

		h.sock().closeFromRelay(1006);
		expect(svc.getStatus().relay).toBe("retrying");

		expect(new XbpAuditSink({ dir }).entries()).toContainEqual(
			expect.objectContaining({
				event: "relay-registration-lost",
				level: "info",
			}),
		);
	});

	it("incoming-session dials the accept URL once and audits when the socket lands", async () => {
		const dir = mkdtempSync(join(tmpdir(), "xbp-relay-"));
		const h = relayHarness();
		const acceptDials: {
			url: string;
			attach: (socket: AttachableSocket) => void;
		}[] = [];
		svc = makeService({
			dir,
			initialRelayBaseUrl: BASE,
			relaySocketFactory: h.factory,
			relayJitter: () => 1,
			relayAcceptDial: (url, attach) => acceptDials.push({ url, attach }),
		});
		await svc.start();
		h.register();

		h.sock().message({ t: "incoming-session", token: TOKEN_HEX });
		expect(acceptDials).toHaveLength(1);
		expect(acceptDials[0].url).toBe(`${BASE}/accept/${TOKEN_HEX}`);

		// No audit until the accept socket actually opens (attach callback fires).
		expect(
			new XbpAuditSink({ dir })
				.entries()
				.some((e) => e.event === "relay-session-accepted"),
		).toBe(false);

		acceptDials[0].attach(h.attachableStub());
		expect(new XbpAuditSink({ dir }).entries()).toContainEqual(
			expect.objectContaining({
				event: "relay-session-accepted",
				level: "info",
			}),
		);
	});

	it("applyRelayBaseUrl: no-op on same value, teardown on '', restart on change, emits status", async () => {
		const h = relayHarness();
		let statusChanges = 0;
		svc = makeService({
			initialRelayBaseUrl: BASE,
			relaySocketFactory: h.factory,
			relayJitter: () => 1,
			onStatusChange: () => {
				statusChanges++;
			},
		});
		await svc.start();
		h.register();
		expect(svc.getStatus().relay).toBe("registered");

		// Same value: no teardown, no extra dial, no status emit.
		const dialsBefore = h.dialed.length;
		const changesBeforeNoop = statusChanges;
		svc.applyRelayBaseUrl(BASE);
		expect(h.dialed).toHaveLength(dialsBefore);
		expect(statusChanges).toBe(changesBeforeNoop);
		expect(svc.getStatus().relay).toBe("registered");

		// Empty string tears down.
		const changesBeforeTeardown = statusChanges;
		svc.applyRelayBaseUrl("");
		expect(svc.getStatus().relay).toBe("off");
		expect(statusChanges).toBeGreaterThan(changesBeforeTeardown);

		// New base restarts registration against the new host.
		svc.applyRelayBaseUrl("wss://other.example");
		expect(h.dialed.at(-1)).toBe("wss://other.example/host");
		expect(svc.getStatus().relay).toBe("retrying"); // connecting maps to retrying
	});

	it("stop() tears down relay registration and closes the control channel", async () => {
		const h = relayHarness();
		svc = makeService({
			initialRelayBaseUrl: BASE,
			relaySocketFactory: h.factory,
			relayJitter: () => 1,
		});
		await svc.start();
		h.register();
		expect(svc.getStatus().relay).toBe("registered");

		await svc.stop();
		expect(svc.getStatus().relay).toBe("off");
		expect(h.closedWith.length).toBeGreaterThan(0);
		svc = undefined; // already stopped; skip afterEach double-stop
	});

	it("setKillSwitch(true) does NOT tear down relay registration", async () => {
		const h = relayHarness();
		svc = makeService({
			initialRelayBaseUrl: BASE,
			relaySocketFactory: h.factory,
			relayJitter: () => 1,
		});
		await svc.start();
		h.register();
		expect(svc.getStatus().relay).toBe("registered");

		svc.setKillSwitch(true);
		expect(svc.getStatus().relay).toBe("registered");
	});

	it("applyRelayBaseUrl while disabled is inert (zero dials, relay off); a later start() picks up the stored base", async () => {
		const h = relayHarness();
		svc = makeService({ relaySocketFactory: h.factory });
		// start() was never called: the bridge is disabled.
		expect(() => svc!.applyRelayBaseUrl(BASE)).not.toThrow();
		expect(h.dialed).toEqual([]);
		expect(svc.getStatus().relay).toBe("off");

		// The base is stored regardless: start() dials it once the bridge comes up.
		await svc.start();
		expect(h.dialed).toEqual([`${BASE}/host`]);
	});

	it("applyRelayBaseUrl after a failed setEnabled(true) does not throw and leaves relay off", async () => {
		const h = relayHarness();
		const dir = mkdtempSync(join(tmpdir(), "xbp-svc-"));
		svc = new XbpHostService({
			dir,
			// Fails-closed inside start(): identity/backend never get set, but
			// setEnabled(true) already flipped `enabled` before awaiting start().
			secureStorage: { ...okStorage, isEncryptionAvailable: () => false },
			getSessionReport: async () => ({
				mode: "ready",
				focus: null,
				sessions: [],
			}),
			subscribeChanges: () => () => {},
			relaySocketFactory: h.factory,
		});
		await expect(svc.setEnabled(true)).rejects.toThrow();

		expect(() => svc!.applyRelayBaseUrl(BASE)).not.toThrow();
		expect(h.dialed).toEqual([]);
		expect(svc.getStatus().relay).toBe("off");
	});
});
