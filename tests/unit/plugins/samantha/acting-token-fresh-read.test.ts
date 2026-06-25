import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createActingTokenVerifier } from "../../../../services/plugins/samantha/acting-token-verifier";

let dir: string;
let tokenPath: string;

// Mirrors the production wiring in electron/main/index.ts:324-330 so the test
// exercises the same read path the app uses.
function readSecret(): string | null {
	try {
		return readFileSync(tokenPath, "utf8").trim() || null;
	} catch {
		return null;
	}
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "sam-token-"));
	tokenPath = join(dir, "connector-token");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("acting token verifier reads fresh each verify (rotation + late file)", () => {
	it("denies when the file is absent, then accepts once it appears (ai-14all booted first)", () => {
		const verifier = createActingTokenVerifier({ readSecret });
		expect(verifier.verify("secret-a")).toBe(false); // no file yet — default-deny, no throw
		writeFileSync(tokenPath, "secret-a", { mode: 0o600 });
		expect(verifier.verify("secret-a")).toBe(true); // file appeared, read fresh
	});

	it("follows a rotated secret without reconstructing the verifier", () => {
		writeFileSync(tokenPath, "secret-a", { mode: 0o600 });
		const verifier = createActingTokenVerifier({ readSecret });
		expect(verifier.verify("secret-a")).toBe(true);
		// Samantha restarts and regenerates: same path, new secret.
		writeFileSync(tokenPath, "secret-b", { mode: 0o600 });
		expect(verifier.verify("secret-a")).toBe(false); // old secret no longer valid
		expect(verifier.verify("secret-b")).toBe(true); // new secret accepted, read fresh
	});

	it("default-denies after the file is deleted, without throwing", () => {
		writeFileSync(tokenPath, "secret-a", { mode: 0o600 });
		const verifier = createActingTokenVerifier({ readSecret });
		expect(verifier.verify("secret-a")).toBe(true);
		unlinkSync(tokenPath);
		expect(verifier.verify("secret-a")).toBe(false);
	});
});
