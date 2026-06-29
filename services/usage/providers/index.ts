import type { AgentProviderId } from "../../../shared/models/agent-provider.js";
import { antigravityDriver } from "./antigravity.js";
import { claudeDriver } from "./claude.js";
import { codexDriver } from "./codex.js";
import { cursorDriver } from "./cursor.js";
import { ezioDriver } from "./ezio.js";
import type { TelemetryDriver } from "./types.js";

// Ordered to match AGENT_PROVIDERS in shared/models/agent-provider.ts.
export const TELEMETRY_DRIVERS: readonly TelemetryDriver[] = [
	claudeDriver,
	codexDriver,
	ezioDriver,
	cursorDriver,
	antigravityDriver,
];

export const jsonlDrivers: readonly TelemetryDriver[] =
	TELEMETRY_DRIVERS.filter((d) => d.capabilities.storeKind === "jsonl-tree");

export function driverFor(id: AgentProviderId): TelemetryDriver | undefined {
	return TELEMETRY_DRIVERS.find((d) => d.id === id);
}
