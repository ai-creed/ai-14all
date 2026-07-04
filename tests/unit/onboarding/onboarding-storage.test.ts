import { beforeEach, describe, expect, it } from "vitest";
import {
	clearDismissedCoachmarks,
	readDismissedCoachmarks,
	readTourVersionSeen,
	writeDismissedCoachmarks,
	writeTourVersionSeen,
} from "../../../src/features/onboarding/logic/onboarding-storage";

beforeEach(() => localStorage.clear());

describe("tourVersionSeen storage", () => {
	it("returns null when unset", () => {
		expect(readTourVersionSeen()).toBeNull();
	});
	it("round-trips a number", () => {
		writeTourVersionSeen(1);
		expect(readTourVersionSeen()).toBe(1);
	});
	it("returns null for a corrupt (non-numeric) value", () => {
		localStorage.setItem("ai14all.onboarding.tourVersionSeen", "not-a-number");
		expect(readTourVersionSeen()).toBeNull();
	});
});

describe("dismissedCoachmarks storage", () => {
	it("returns [] when unset", () => {
		expect(readDismissedCoachmarks()).toEqual([]);
	});
	it("round-trips an array", () => {
		writeDismissedCoachmarks(["plugins", "telemetry"]);
		expect(readDismissedCoachmarks()).toEqual(["plugins", "telemetry"]);
	});
	it("returns [] for malformed JSON", () => {
		localStorage.setItem("ai14all.onboarding.dismissedCoachmarks", "{not json");
		expect(readDismissedCoachmarks()).toEqual([]);
	});
	it("filters non-string entries", () => {
		localStorage.setItem(
			"ai14all.onboarding.dismissedCoachmarks",
			JSON.stringify(["plugins", 3, null, "telemetry"]),
		);
		expect(readDismissedCoachmarks()).toEqual(["plugins", "telemetry"]);
	});
	it("clears the set", () => {
		writeDismissedCoachmarks(["plugins"]);
		clearDismissedCoachmarks();
		expect(readDismissedCoachmarks()).toEqual([]);
	});
});
