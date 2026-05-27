import { describe, expect, it } from "vitest";
import {
	formatReset,
	formatTokens,
	gaugeColor,
} from "../../../src/features/telemetry/format.js";

describe("formatTokens", () => {
	it("abbreviates millions/thousands", () => {
		expect(formatTokens(12_914_402)).toBe("12.9M");
		expect(formatTokens(706_658)).toBe("0.7M");
		expect(formatTokens(4_200)).toBe("4.2K");
		expect(formatTokens(42)).toBe("42");
	});
	it("degrades undefined/NaN to 0", () => {
		expect(formatTokens(undefined as unknown as number)).toBe("0");
		expect(formatTokens(NaN)).toBe("0");
	});
});

describe("gaugeColor", () => {
	it("maps percent to threshold class", () => {
		expect(gaugeColor(10)).toBe("ok");
		expect(gaugeColor(75)).toBe("warn");
		expect(gaugeColor(95)).toBe("hot");
	});
});

describe("formatReset", () => {
	it("formats a future reset as relative time, empty when null", () => {
		const now = 1_000_000_000_000;
		expect(formatReset(now + 90 * 60_000, now)).toBe("1h30m");
		expect(formatReset(now + 3 * 24 * 3_600_000, now)).toBe("3d");
		expect(formatReset(now - 5000, now)).toBe("now");
		expect(formatReset(null, now)).toBe("");
	});
});
