import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	XbpSecureStorageUnavailableError,
	type SecureStorage,
} from "../../../services/xbp/xbp-identity-store";
import { XbpPairedDeviceStore } from "../../../services/xbp/xbp-paired-device-store";

function fakeSecureStorage(available = true): SecureStorage {
	return {
		isEncryptionAvailable: () => available,
		encryptString: (plain) => Buffer.from(plain, "utf8"),
		decryptString: (buf) => buf.toString("utf8"),
	};
}

describe("XbpPairedDeviceStore", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "xbp-pd-"));
	});

	it("returns null before anything is paired", () => {
		expect(
			new XbpPairedDeviceStore({
				dir,
				secureStorage: fakeSecureStorage(),
			}).load(),
		).toBeNull();
	});

	it("saves and reloads the paired device across instances (survives restart)", () => {
		const device = { signPubHex: "aa11", boxPubHex: "bb22", pairedAt: 1234 };
		new XbpPairedDeviceStore({ dir, secureStorage: fakeSecureStorage() }).save(
			device,
		);
		const reloaded = new XbpPairedDeviceStore({
			dir,
			secureStorage: fakeSecureStorage(),
		}).load();
		expect(reloaded).toEqual(device);
	});

	it("saves and reloads a device with grantedPermissions intact (decision 8)", () => {
		const device = {
			signPubHex: "aa11",
			boxPubHex: "bb22",
			pairedAt: 1234,
			grantedPermissions: ["control:read", "control:act"],
		};
		new XbpPairedDeviceStore({ dir, secureStorage: fakeSecureStorage() }).save(
			device,
		);
		const reloaded = new XbpPairedDeviceStore({
			dir,
			secureStorage: fakeSecureStorage(),
		}).load();
		expect(reloaded).toEqual(device);
	});

	it("clear() forgets the device", () => {
		const store = new XbpPairedDeviceStore({
			dir,
			secureStorage: fakeSecureStorage(),
		});
		store.save({ signPubHex: "aa", boxPubHex: "bb", pairedAt: 1 });
		store.clear();
		expect(store.load()).toBeNull();
	});

	it("fails closed on save when secure storage is unavailable — never writes plaintext", () => {
		const store = new XbpPairedDeviceStore({
			dir,
			secureStorage: fakeSecureStorage(false),
		});
		expect(() =>
			store.save({ signPubHex: "aa", boxPubHex: "bb", pairedAt: 1 }),
		).toThrow(XbpSecureStorageUnavailableError);
	});
});
