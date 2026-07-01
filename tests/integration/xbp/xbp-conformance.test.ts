// tests/integration/xbp/xbp-conformance.test.ts
import { describe, it } from "vitest";
import { conformanceChecks } from "@xavier/xbp/conformance";
import { backendParityChecks, addressedFrameChecks } from "@xavier/xbp";
import { createNodeSodiumBackend } from "@xavier/xbp/node";
import { createAi14allConformanceHarness } from "../../../services/xbp/xbp-conformance-harness.js";

describe("ai-14all XBP host conformance", () => {
	for (const check of conformanceChecks) {
		it(check.name, async () => {
			await check.run((opts) => createAi14allConformanceHarness(opts));
		});
	}
});

describe("ai-14all XBP backend primitives (supplementary)", () => {
	it("passes backend parity + addressed-frame checks", async () => {
		const backend = await createNodeSodiumBackend();
		for (const c of [...backendParityChecks, ...addressedFrameChecks])
			c.run(backend);
	});
});
