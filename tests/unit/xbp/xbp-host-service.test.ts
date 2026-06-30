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
import { XbpPairedDeviceStore } from "../../../services/xbp/xbp-paired-device-store";

const okStorage = {
	isEncryptionAvailable: () => true,
	encryptString: (s: string) => Buffer.from(s, "utf8"),
	decryptString: (b: Buffer) => b.toString("utf8"),
};

function makeService(storage = okStorage) {
	return new XbpHostService({
		dir: mkdtempSync(join(tmpdir(), "xbp-svc-")),
		secureStorage: storage,
		getSessionReport: async () => ({
			mode: "ready",
			focus: null,
			sessions: [],
		}),
		subscribeChanges: () => () => {},
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
		svc = makeService({ ...okStorage, isEncryptionAvailable: () => false });
		await expect(svc.start()).rejects.toBeInstanceOf(
			XbpSecureStorageUnavailableError,
		);
		expect(svc.getStatus().listening).toBe(false);
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
});
