import { describe, it, expect } from "vitest";
import {
	CONTROL_ACT,
	CONTROL_INSPECT,
	CONTROL_NOTIFY,
	sessionReportCapability,
} from "@ai-creed/command-contract";
import {
	NEW_PAIRING_GRANTS,
	grantsForStoredDevice,
} from "../../../services/xbp/xbp-grants";

describe("xbp grants (decision 8)", () => {
	it("mints control:act and control:notify for new pairings", () => {
		expect(NEW_PAIRING_GRANTS).toEqual([
			sessionReportCapability.permission,
			CONTROL_ACT,
			CONTROL_NOTIFY,
			CONTROL_INSPECT,
		]);
	});

	it("mints control:inspect for new pairings (spec §4; existing pairings re-pair)", () => {
		expect(NEW_PAIRING_GRANTS).toContain(CONTROL_INSPECT);
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

	it("does NOT silently add control:notify to a stored pre-v3 grant set", () => {
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
