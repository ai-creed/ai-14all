import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeSodiumBackend } from "@xavier/xbp/node";
import {
	XbpIdentityStore,
	XbpSecureStorageUnavailableError,
	type SecureStorage,
} from "../../../services/xbp/xbp-identity-store";

// A fake safeStorage: "encrypt" = utf8 bytes; "decrypt" = back to string.
function fakeSecureStorage(available = true): SecureStorage {
	return {
		isEncryptionAvailable: () => available,
		encryptString: (plain) => Buffer.from(plain, "utf8"),
		decryptString: (buf) => buf.toString("utf8"),
	};
}

describe("XbpIdentityStore", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "xbp-id-"));
	});

	it("generates, persists, and reloads a stable identity (stable NodeId)", async () => {
		const backend = await createNodeSodiumBackend();
		const a = new XbpIdentityStore({
			dir,
			backend,
			secureStorage: fakeSecureStorage(),
		}).load();
		const b = new XbpIdentityStore({
			dir,
			backend,
			secureStorage: fakeSecureStorage(),
		}).load();
		expect(b.nodeId).toBe(a.nodeId);
		expect([...b.identity.sign.publicKey]).toEqual([
			...a.identity.sign.publicKey,
		]);
	});

	it("fails closed when secure storage is unavailable — never writes plaintext", async () => {
		const backend = await createNodeSodiumBackend();
		const store = new XbpIdentityStore({
			dir,
			backend,
			secureStorage: fakeSecureStorage(false),
		});
		expect(() => store.load()).toThrow(XbpSecureStorageUnavailableError);
	});
});
