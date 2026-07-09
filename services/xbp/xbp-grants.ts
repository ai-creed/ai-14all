import {
	CONTROL_ACT,
	CONTROL_NOTIFY,
	sessionReportCapability,
} from "@ai-creed/command-contract";
import type { PairedDevice } from "./xbp-paired-device-store.js";

// Decision 8: the grant set minted for a NEW pairing. Pairing is the only place
// control:act / control:notify are created; nothing else may widen a device's
// grants — a pre-v3 stored record stays without control:notify until re-paired.
export const NEW_PAIRING_GRANTS: readonly string[] = [
	sessionReportCapability.permission,
	CONTROL_ACT,
	CONTROL_NOTIFY,
];

// Grants replayed for a persisted device on startup re-attach. A pre-2b.2
// record has no grantedPermissions field and loads fail-closed as read-only;
// re-pairing is the only upgrade path.
export function grantsForStoredDevice(device: PairedDevice): string[] {
	return device.grantedPermissions ?? [sessionReportCapability.permission];
}
