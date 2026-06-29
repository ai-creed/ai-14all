import type { TelemetryDriver } from "./types.js";

// Inert: cursor keeps no usable token log on disk. Declared so it appears in the
// providers list (grayed out), never scanned.
export const cursorDriver: TelemetryDriver = {
	id: "cursor",
	capabilities: {
		tokenLog: false,
		storeKind: "none",
		timeSource: "none",
		cwdSource: "none",
		nativeLimits: false,
	},
	roots: () => [],
};
