import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	XbpSecureStorageUnavailableError,
	type SecureStorage,
} from "../../../services/xbp/xbp-identity-store";
import {
	XbpPushTokenStore,
	type StoredPushToken,
} from "../../../services/xbp/xbp-push-token-store";

// Reversing "cipher": enough to prove the file holds transformed bytes,
// not the raw token.
function fakeSecureStorage(available = true): SecureStorage {
	return {
		isEncryptionAvailable: () => available,
		encryptString: (plain) =>
			Buffer.from([...plain].reverse().join(""), "utf8"),
		decryptString: (buf) => [...buf.toString("utf8")].reverse().join(""),
	};
}

const record: StoredPushToken = {
	expoPushToken: "ExponentPushToken[secret-abc-123]",
	platform: "ios",
	registeredAt: 1751932800000,
};

describe("XbpPushTokenStore", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "xbp-pt-"));
	});

	it("returns null / exists()=false before anything is registered", () => {
		const store = new XbpPushTokenStore({
			dir,
			secureStorage: fakeSecureStorage(),
		});
		expect(store.load()).toBeNull();
		expect(store.exists()).toBe(false);
	});

	it("saves one slot, reloads across instances, exists()=true", () => {
		new XbpPushTokenStore({ dir, secureStorage: fakeSecureStorage() }).save(
			record,
		);
		const again = new XbpPushTokenStore({
			dir,
			secureStorage: fakeSecureStorage(),
		});
		expect(again.exists()).toBe(true);
		expect(again.load()).toEqual(record);
	});

	it("overwrites on re-register (one slot)", () => {
		const store = new XbpPushTokenStore({
			dir,
			secureStorage: fakeSecureStorage(),
		});
		store.save(record);
		store.save({ ...record, expoPushToken: "ExponentPushToken[second]" });
		expect(store.load()?.expoPushToken).toBe("ExponentPushToken[second]");
	});

	it("clear() empties the slot", () => {
		const store = new XbpPushTokenStore({
			dir,
			secureStorage: fakeSecureStorage(),
		});
		store.save(record);
		store.clear();
		expect(store.load()).toBeNull();
		expect(store.exists()).toBe(false);
	});

	it("at-rest bytes never contain the raw token (no plaintext)", () => {
		new XbpPushTokenStore({ dir, secureStorage: fakeSecureStorage() }).save(
			record,
		);
		const raw = readFileSync(join(dir, "push-token.enc"), "utf8");
		expect(raw).not.toContain("secret-abc-123");
		expect(raw).not.toContain(record.expoPushToken);
	});

	it("fails closed when secure storage is unavailable — nothing persisted", () => {
		const store = new XbpPushTokenStore({
			dir,
			secureStorage: fakeSecureStorage(false),
		});
		expect(() => store.save(record)).toThrow(XbpSecureStorageUnavailableError);
		expect(existsSync(join(dir, "push-token.enc"))).toBe(false);
		expect(() =>
			new XbpPushTokenStore({ dir, secureStorage: fakeSecureStorage() }).save(
				record,
			),
		).not.toThrow();
		expect(() =>
			new XbpPushTokenStore({
				dir,
				secureStorage: fakeSecureStorage(false),
			}).load(),
		).toThrow(XbpSecureStorageUnavailableError);
	});
});
