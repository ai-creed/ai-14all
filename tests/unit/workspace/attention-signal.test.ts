import { describe, expect, it } from "vitest";
import {
	NEEDS_YOU_LABEL,
	needsYouLabel,
} from "../../../src/features/workspace/logic/attention-signal";

describe("needsYouLabel", () => {
	it("returns the label only for actionRequired", () => {
		expect(needsYouLabel("actionRequired")).toBe(NEEDS_YOU_LABEL);
		expect(needsYouLabel("ready")).toBeNull();
		expect(needsYouLabel("activity")).toBeNull();
		expect(needsYouLabel("idle")).toBeNull();
	});
});
