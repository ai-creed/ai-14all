import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveNodeId,
  deserializeIdentity,
  generateIdentity,
  serializeIdentity,
  type Identity,
  type SodiumBackend,
} from "@xavier/xbp/node";

export interface SecureStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class XbpSecureStorageUnavailableError extends Error {
  constructor() {
    super("OS secure storage is unavailable; refusing to persist XBP keys in plaintext");
    this.name = "XbpSecureStorageUnavailableError";
  }
}

export class XbpIdentityStore {
  private readonly path: string;
  constructor(
    private readonly opts: { dir: string; backend: SodiumBackend; secureStorage: SecureStorage },
  ) {
    this.path = join(opts.dir, "identity.enc");
  }

  load(): { identity: Identity; nodeId: string } {
    if (!this.opts.secureStorage.isEncryptionAvailable()) {
      throw new XbpSecureStorageUnavailableError();
    }
    mkdirSync(this.opts.dir, { recursive: true });
    let identity: Identity;
    if (existsSync(this.path)) {
      const plain = this.opts.secureStorage.decryptString(readFileSync(this.path));
      identity = deserializeIdentity(JSON.parse(plain));
    } else {
      identity = generateIdentity(this.opts.backend);
      const cipher = this.opts.secureStorage.encryptString(JSON.stringify(serializeIdentity(identity)));
      writeFileSync(this.path, cipher);
    }
    const nodeId = deriveNodeId(this.opts.backend, identity.sign.publicKey);
    return { identity, nodeId };
  }
}
