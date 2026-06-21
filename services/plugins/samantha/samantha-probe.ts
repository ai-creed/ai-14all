import type { ProbeResult } from "../../../shared/models/ecosystem-plugin";

/**
 * Samantha is a desktop app with no CLI/version to probe, and her server may
 * boot after 14all. The probe is therefore lenient: it always reports the
 * plugin as installed-when-enabled (the cortex no-op probe shape). Live
 * reachability is owned by the driver's connection-health channel, not here —
 * a `degraded`/`not-installed` probe result would latch the plugin off until a
 * reprobe, which is wrong for a peer that legitimately starts later.
 */
export function probeSamantha(): Promise<ProbeResult> {
	return Promise.resolve({
		kind: "installed",
		version: "",
		installPath: "",
		protocolVersion: "",
	});
}
