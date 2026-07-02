import { describe, it, expect } from "vitest";
import {
	CONTROL_ACT,
	sessionReportCapability,
} from "@ai-creed/command-contract";
import {
	NEW_PAIRING_GRANTS,
	grantsForStoredDevice,
} from "../../../services/xbp/xbp-grants";

describe("xbp grants (decision 8)", () => {
	it("mints control:act only for new pairings", () => {
		expect(NEW_PAIRING_GRANTS).toEqual([
			sessionReportCapability.permission,
			CONTROL_ACT,
		]);
	});

	it("replays stored grants verbatim", () => {
		expect(
			grantsForStoredDevice({
				signPubHex: "aa",
				boxPubHex: "bb",
				pairedAt: 1,
				grantedPermissions: [sessionReportCapability.permission, CONTROL_ACT],
			}),
		).toEqual([sessionReportCapability.permission, CONTROL_ACT]);
	});

	it("loads a pre-2b.2 record (no grantedPermissions) fail-closed as read-only", () => {
		expect(
			grantsForStoredDevice({ signPubHex: "aa", boxPubHex: "bb", pairedAt: 1 }),
		).toEqual([sessionReportCapability.permission]);
	});
});
