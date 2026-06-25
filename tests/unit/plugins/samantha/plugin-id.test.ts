import { describe, expect, it } from "vitest";
import { ECOSYSTEM_PLUGIN_IDS } from "../../../../shared/models/ecosystem-plugin";

describe("ecosystem plugin ids", () => {
	it("includes samantha as a known plugin id", () => {
		expect(ECOSYSTEM_PLUGIN_IDS).toContain("samantha");
	});
});
