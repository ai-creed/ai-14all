import { describe, expect, it } from "vitest";
import { probeSamantha } from "../../../../services/plugins/samantha/samantha-probe";

describe("probeSamantha", () => {
	it("always reports installed so absence is never terminal", async () => {
		const result = await probeSamantha();
		expect(result.kind).toBe("installed");
	});
});
