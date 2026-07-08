import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	XbpSecureStorageUnavailableError,
	type SecureStorage,
} from "./xbp-identity-store.js";

export type StoredPushToken = {
	expoPushToken: string;
	platform: "ios" | "android";
	registeredAt: number;
};

// One slot (one device), at rest via safeStorage, fail-closed. Mirrors
// XbpPairedDeviceStore; lives beside identity.enc / paired-device.enc.
export class XbpPushTokenStore {
	private readonly path: string;
	constructor(
		private readonly opts: { dir: string; secureStorage: SecureStorage },
	) {
		this.path = join(opts.dir, "push-token.enc");
	}

	exists(): boolean {
		return existsSync(this.path);
	}

	load(): StoredPushToken | null {
		if (!existsSync(this.path)) return null;
		if (!this.opts.secureStorage.isEncryptionAvailable())
			throw new XbpSecureStorageUnavailableError();
		return JSON.parse(
			this.opts.secureStorage.decryptString(readFileSync(this.path)),
		) as StoredPushToken;
	}

	save(record: StoredPushToken): void {
		if (!this.opts.secureStorage.isEncryptionAvailable())
			throw new XbpSecureStorageUnavailableError();
		mkdirSync(this.opts.dir, { recursive: true });
		writeFileSync(
			this.path,
			this.opts.secureStorage.encryptString(JSON.stringify(record)),
		);
	}

	clear(): void {
		if (existsSync(this.path)) rmSync(this.path);
	}
}
