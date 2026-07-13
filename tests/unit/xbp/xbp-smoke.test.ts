import { describe, it, expect } from "vitest";
import { createNodeSodiumBackend } from "@xavier/xbp/node";
import { sessionReportCapability } from "@ai-creed/command-contract";
import { conformanceChecks } from "@xavier/xbp/conformance";

describe("xbp vendored surface", () => {
	it("loads the node backend and seals/opens a round-trip", async () => {
		const backend = await createNodeSodiumBackend();
		const box = backend.generateBoxKeyPair();
		const msg = backend.randomBytes(8);
		const sealed = backend.seal(msg, box.publicKey);
		const opened = backend.open(sealed, box.publicKey, box.privateKey);
		expect(opened).not.toBeNull();
		expect([...opened!]).toEqual([...msg]);
	});

	it("exposes the conformance checks and the session-report capability", () => {
		expect(conformanceChecks.length).toBeGreaterThan(0);
		expect(sessionReportCapability.permission).toBe("control:read");
	});
});
