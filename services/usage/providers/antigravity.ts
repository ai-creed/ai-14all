import type { TelemetryDriver } from "./types.js";

// Inert: antigravity stores usage as protobuf blobs in SQLite. Declared for the
// providers list; a future sqlite-dir driver could decode it.
export const antigravityDriver: TelemetryDriver = {
	id: "antigravity",
	capabilities: {
		tokenLog: false,
		storeKind: "sqlite-dir",
		timeSource: "none",
		cwdSource: "none",
		nativeLimits: false,
	},
	roots: () => [],
};
