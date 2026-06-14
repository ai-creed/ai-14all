import type { ProbeResult } from "../../../shared/models/ecosystem-plugin.js";
import type { EcosystemPlugin, PluginContext } from "../plugin-registry.js";

export type CortexDriverOptions = {
	probeImpl: () => Promise<ProbeResult>;
	/**
	 * Fired on every enable/disable transition (the registry calls start() on
	 * enable and stop() on disable). The wiring broadcasts a
	 * `code-nav:availabilityChanged` event so the renderer re-queries worktree
	 * status and the code-nav gate flips live. No background watcher otherwise:
	 * the gate's source of truth is pluginConfig, read at the code-nav IPC
	 * boundary via getCortexEnabled.
	 */
	onAvailabilityChanged: () => void;
};

export function createCortexDriver(
	options: CortexDriverOptions,
): EcosystemPlugin {
	return {
		id: "cortex",
		capabilities: ["code-nav-index"],
		probe: () => options.probeImpl(),
		async start(_ctx: PluginContext) {
			options.onAvailabilityChanged();
		},
		async stop() {
			options.onAvailabilityChanged();
		},
	};
}
