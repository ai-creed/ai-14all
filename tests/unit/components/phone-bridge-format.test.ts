import { describe, it, expect } from "vitest";
import {
	capabilityRows,
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

// Mirrors NEW_PAIRING_GRANTS (services/xbp/xbp-grants.ts:14) — every phone
// paired since slice 2b.2 carries exactly this set.
const FULL_GRANTS = [
	"session:report",
	"control:act",
	"control:notify",
	"control:inspect",
	"control:pty-write",
];
const BOTH_ON = { pushWakeEnabled: true, ptyInputEnabled: true };

describe("capabilityRows", () => {
	it("full grants yield four rows in a fixed order", () => {
		const rows = capabilityRows(FULL_GRANTS, BOTH_ON);
		expect(rows.map((r) => r.key)).toEqual(["reports", "act", "notify", "pty"]);
		expect(rows.map((r) => r.granted)).toEqual([true, true, true, true]);
		expect(rows.map((r) => r.armed)).toEqual([null, null, true, true]);
	});

	// A single symmetric case passes even if both rows read the SAME flag.
	// These two cases are what make a crossed wire detectable.
	it("notify reads pushWakeEnabled and pty reads ptyInputEnabled", () => {
		const a = capabilityRows(FULL_GRANTS, {
			pushWakeEnabled: false,
			ptyInputEnabled: true,
		});
		expect(a.find((r) => r.key === "notify")!.armed).toBe(false);
		expect(a.find((r) => r.key === "pty")!.armed).toBe(true);

		const b = capabilityRows(FULL_GRANTS, {
			pushWakeEnabled: true,
			ptyInputEnabled: false,
		});
		expect(b.find((r) => r.key === "notify")!.armed).toBe(true);
		expect(b.find((r) => r.key === "pty")!.armed).toBe(false);
	});

	// Flags deliberately TRUE: with them false this passes vacuously against a
	// model that ignores `granted`.
	it("null perms fail closed with no armed control anywhere", () => {
		const rows = capabilityRows(null, BOTH_ON);
		expect(rows.map((r) => r.granted)).toEqual([true, false, false, false]);
		expect(rows.map((r) => r.armed)).toEqual([null, null, null, null]);
	});

	it("empty perms fail closed identically to null", () => {
		expect(capabilityRows([], BOTH_ON)).toEqual(capabilityRows(null, BOTH_ON));
	});

	it("a partial grant set arms only what was granted", () => {
		const rows = capabilityRows(["control:act"], BOTH_ON);
		const by = (k: string) => rows.find((r) => r.key === k)!;
		expect(by("act")).toMatchObject({ granted: true, armed: null });
		expect(by("notify")).toMatchObject({ granted: false, armed: null });
		expect(by("pty")).toMatchObject({ granted: false, armed: null });
	});

	it("distinguishes a disarmed control from an absent grant", () => {
		const disarmed = capabilityRows(FULL_GRANTS, {
			pushWakeEnabled: false,
			ptyInputEnabled: false,
		}).find((r) => r.key === "pty")!;
		const denied = capabilityRows(["control:act"], BOTH_ON).find(
			(r) => r.key === "pty",
		)!;
		expect(disarmed).toMatchObject({ granted: true, armed: false });
		expect(denied).toMatchObject({ granted: false, armed: null });
	});

	it("carries user-facing labels and hints", () => {
		const rows = capabilityRows(FULL_GRANTS, BOTH_ON);
		expect(rows.map((r) => r.label)).toEqual([
			"Read session reports",
			"Act on workflows",
			"Send notifications to this phone",
			"Type into terminals",
		]);
		expect(rows.find((r) => r.key === "notify")!.hint).toBe(
			"Pings the phone when a workflow finishes or needs you.",
		);
		expect(rows.find((r) => r.key === "pty")!.hint).toBe(
			"Sends keystrokes to running agents.",
		);
	});

	// The property PhoneBridgePanel's element choice depends on (spec §5).
	it("invariant: armed !== null implies granted", () => {
		const cases: Array<[string[] | null, { pushWakeEnabled: boolean; ptyInputEnabled: boolean }]> = [
			[FULL_GRANTS, BOTH_ON],
			[FULL_GRANTS, { pushWakeEnabled: false, ptyInputEnabled: true }],
			[FULL_GRANTS, { pushWakeEnabled: true, ptyInputEnabled: false }],
			[FULL_GRANTS, { pushWakeEnabled: false, ptyInputEnabled: false }],
			[null, BOTH_ON],
			[[], BOTH_ON],
			[["control:act"], BOTH_ON],
			[["control:notify"], BOTH_ON],
			[["control:pty-write"], BOTH_ON],
		];
		for (const [perms, flags] of cases) {
			for (const row of capabilityRows(perms, flags)) {
				if (row.armed !== null) expect(row.granted).toBe(true);
			}
		}
	});
});
