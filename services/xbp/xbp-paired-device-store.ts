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

export interface PairedDevice {
	signPubHex: string;
	boxPubHex: string;
	pairedAt: number;
	// Decision 8: permissions granted to this device, minted at pairing time and
	// replayed verbatim on startup re-attach. Absent on records persisted before
	// slice 2b.2 — readers must treat absence as read-only (control:read).
	grantedPermissions?: string[];
}

export class XbpPairedDeviceStore {
	private readonly path: string;
	constructor(
		private readonly opts: { dir: string; secureStorage: SecureStorage },
	) {
		this.path = join(opts.dir, "paired-device.enc");
	}

	load(): PairedDevice | null {
		if (!existsSync(this.path)) return null;
		if (!this.opts.secureStorage.isEncryptionAvailable())
			throw new XbpSecureStorageUnavailableError();
		return JSON.parse(
			this.opts.secureStorage.decryptString(readFileSync(this.path)),
		) as PairedDevice;
	}

	save(device: PairedDevice): void {
		if (!this.opts.secureStorage.isEncryptionAvailable())
			throw new XbpSecureStorageUnavailableError();
		mkdirSync(this.opts.dir, { recursive: true });
		writeFileSync(
			this.path,
			this.opts.secureStorage.encryptString(JSON.stringify(device)),
		);
	}

	clear(): void {
		if (existsSync(this.path)) rmSync(this.path);
	}
}
