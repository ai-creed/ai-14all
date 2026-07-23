import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createNodeSodiumBackend,
	generateIdentity,
	toHex,
} from "@xavier/xbp/node";
import { XbpHostService } from "../../../services/xbp/xbp-host-service";
import { XbpSecureStorageUnavailableError } from "../../../services/xbp/xbp-identity-store";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { XbpPairedDeviceStore } from "../../../services/xbp/xbp-paired-device-store";
import { XbpPushTokenStore } from "../../../services/xbp/xbp-push-token-store";

const okStorage = {
	isEncryptionAvailable: () => true,
	encryptString: (s: string) => Buffer.from(s, "utf8"),
	decryptString: (b: Buffer) => b.toString("utf8"),
};

function makeService(
	opts: { storage?: typeof okStorage; initialRelayBaseUrl?: string } = {},
) {
	const { storage = okStorage, ...rest } = opts;
	return new XbpHostService({
		dir: mkdtempSync(join(tmpdir(), "xbp-svc-")),
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

	it("kill switch (setEnabled false) stops listening and drops the session", async () => {
		svc = makeService();
		await svc.start();
		await svc.setEnabled(false);
		expect(svc.getStatus().listening).toBe(false);
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
		expect(offer.connect.urls[1]).toMatch(
			/^wss:\/\/relay\.example\.com\/connect\/.+$/,
		);
	});
});
