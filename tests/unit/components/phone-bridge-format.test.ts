import { describe, it, expect } from "vitest";
import {
	countdownLabel,
	formatSas,
	permissionsLabel,
	relativeTimeSince,
} from "../../../src/components/settings/phone-bridge-format";

describe("formatSas", () => {
	it("groups six digits as 3+3", () => {
		expect(formatSas("048213")).toBe("048 213");
	});
	it("passes non-6-digit values through", () => {
		expect(formatSas("ab12")).toBe("ab12");
	});
});

describe("countdownLabel", () => {
	it("formats m:ss", () => {
		expect(countdownLabel(161_000)).toBe("2:41");
	});
	it("clamps at 0:00", () => {
		expect(countdownLabel(-5)).toBe("0:00");
	});
});

describe("relativeTimeSince", () => {
	const now = 1_700_000_000_000;
	it("reads 'just now' under a minute", () => {
		expect(relativeTimeSince(now - 30_000, now)).toBe("just now");
	});
	it("reads minutes", () => {
		expect(relativeTimeSince(now - 5 * 60_000, now)).toBe("5 minutes ago");
	});
	it("reads hours", () => {
		expect(relativeTimeSince(now - 3 * 3_600_000, now)).toBe("3 hours ago");
	});
	it("reads days", () => {
		expect(relativeTimeSince(now - 3 * 86_400_000, now)).toBe("3 days ago");
	});
});

describe("permissionsLabel", () => {
	it("legacy null grants read as read-only", () => {
		expect(permissionsLabel(null)).toBe("session reports (read-only)");
	});
	it("control:act reads as can-act", () => {
		expect(permissionsLabel(["control:act"])).toContain("can act");
	});
	it("names terminal input when control:pty-write is granted", () => {
		expect(
			permissionsLabel(["session:report", "control:act", "control:pty-write"]),
		).toBe("session reports · can act on workflows · can type into terminals");
		expect(permissionsLabel(["session:report", "control:act"])).toBe(
			"session reports · can act on workflows",
		);
		expect(permissionsLabel(null)).toBe("session reports (read-only)");
	});
});
