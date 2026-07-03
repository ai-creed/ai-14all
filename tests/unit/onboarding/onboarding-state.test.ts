import { describe, expect, it } from "vitest";
import {
	coachmarkVisible,
	computeTourVisible,
	dismissCoachmark,
	nextVisibleCoachmarkId,
	shouldRetroMark,
	tourArmed,
} from "../../../src/features/onboarding/logic/onboarding-state";
import { CURRENT_TOUR_VERSION } from "../../../src/features/onboarding/logic/tour-steps";

const base = {
	tourVersionSeen: null as number | null,
	forceShow: false,
	sessionViewMounted: true,
	migrationChecked: true,
	firstAnchorMeasurable: true,
};

describe("tourArmed", () => {
	it("is armed when never seen or seen an older version", () => {
		expect(tourArmed(null)).toBe(true);
		expect(tourArmed(CURRENT_TOUR_VERSION - 1)).toBe(true);
	});
	it("is not armed once the current version was seen", () => {
		expect(tourArmed(CURRENT_TOUR_VERSION)).toBe(false);
	});
});

describe("computeTourVisible — arm-then-show", () => {
	it("never shows on the setup screen (session view not mounted)", () => {
		expect(computeTourVisible({ ...base, sessionViewMounted: false })).toBe(
			false,
		);
	});
	it("does not auto-show until migration has settled", () => {
		expect(computeTourVisible({ ...base, migrationChecked: false })).toBe(
			false,
		);
	});
	it("does not auto-show until the first tour anchor is measurable", () => {
		expect(computeTourVisible({ ...base, firstAnchorMeasurable: false })).toBe(
			false,
		);
	});
	it("auto-shows for a fresh armed profile once mounted, settled, and anchored", () => {
		expect(computeTourVisible(base)).toBe(true);
	});
	it("stays hidden for a seen profile", () => {
		expect(
			computeTourVisible({ ...base, tourVersionSeen: CURRENT_TOUR_VERSION }),
		).toBe(false);
	});
	it("force-shows a seen profile on replay, bypassing migration and anchor gating", () => {
		expect(
			computeTourVisible({
				tourVersionSeen: CURRENT_TOUR_VERSION,
				forceShow: true,
				sessionViewMounted: true,
				migrationChecked: false,
				firstAnchorMeasurable: false,
			}),
		).toBe(true);
	});
	it("still requires the session view even when force-shown", () => {
		expect(
			computeTourVisible({
				...base,
				forceShow: true,
				sessionViewMounted: false,
			}),
		).toBe(false);
	});
});

describe("shouldRetroMark", () => {
	it("marks an upgrading profile that has workspaces and no flag", () => {
		expect(shouldRetroMark({ tourVersionSeen: null, workspaceCount: 1 })).toBe(
			true,
		);
	});
	it("does not mark a genuinely fresh profile", () => {
		expect(shouldRetroMark({ tourVersionSeen: null, workspaceCount: 0 })).toBe(
			false,
		);
	});
	it("does not re-mark a profile that already has a flag", () => {
		expect(shouldRetroMark({ tourVersionSeen: 1, workspaceCount: 5 })).toBe(
			false,
		);
	});
});

describe("dismissCoachmark", () => {
	it("adds an id", () => {
		expect(dismissCoachmark([], "plugins")).toEqual(["plugins"]);
	});
	it("is idempotent", () => {
		expect(dismissCoachmark(["plugins"], "plugins")).toEqual(["plugins"]);
	});
	it("does not mutate the input", () => {
		const input = ["a"];
		dismissCoachmark(input, "b");
		expect(input).toEqual(["a"]);
	});
});

describe("nextVisibleCoachmarkId", () => {
	it("leads with the first coachmark when none are dismissed", () => {
		expect(nextVisibleCoachmarkId([])).toBe("plugins");
	});
	it("skips dismissed coachmarks in canonical order", () => {
		expect(nextVisibleCoachmarkId(["plugins"])).toBe("telemetry");
		expect(nextVisibleCoachmarkId(["plugins", "telemetry"])).toBe(
			"settings-footer",
		);
	});
	it("returns null once every coachmark is dismissed", () => {
		expect(
			nextVisibleCoachmarkId([
				"plugins",
				"telemetry",
				"settings-footer",
				"command-palette",
			]),
		).toBe(null);
	});
});

describe("coachmarkVisible", () => {
	it("hides while the tour is active", () => {
		expect(coachmarkVisible([], "plugins", true)).toBe(false);
	});
	it("hides once dismissed", () => {
		expect(coachmarkVisible(["plugins"], "plugins", false)).toBe(false);
	});
	it("shows the leading undismissed coachmark when the tour is inactive", () => {
		expect(coachmarkVisible([], "plugins", false)).toBe(true);
	});
	it("shows only the leader — a later, undismissed coachmark stays hidden", () => {
		// Exactly one at a time: plugins leads, so telemetry does not show yet even
		// though it is not dismissed.
		expect(coachmarkVisible([], "telemetry", false)).toBe(false);
	});
	it("advances to the next coachmark once the leader is dismissed", () => {
		expect(coachmarkVisible(["plugins"], "telemetry", false)).toBe(true);
		expect(coachmarkVisible(["plugins"], "settings-footer", false)).toBe(false);
	});
	it("shows nothing once every coachmark is dismissed", () => {
		const all = ["plugins", "telemetry", "settings-footer", "command-palette"];
		expect(coachmarkVisible(all, "command-palette", false)).toBe(false);
	});
});
