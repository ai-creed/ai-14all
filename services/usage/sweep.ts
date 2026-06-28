import { existsSync } from "node:fs";
import { processInBatches } from "./batch.js";
import {
	type DailyLedger,
	type SessionState,
	applyContribution,
	createLedger,
	createSession,
	ingestEvent,
} from "./ledger.js";
import {
	type OffsetCache,
	type ScanHandlers,
	listJsonlFiles,
	processJsonlFile,
} from "./scanner.js";
import type { TelemetryDriver } from "./providers/types.js";
import type { AgentProviderId } from "../../shared/models/agent-provider.js";
import type { ProviderRateLimits } from "../../shared/models/usage.js";

export interface SweepState {
	ledger: DailyLedger;
	session: SessionState;
	offsets: OffsetCache;
	providersWithData: Set<AgentProviderId>;
	codexLimits: ProviderRateLimits | null;
}

export function createSweepState(offsets: OffsetCache = new Map()): SweepState {
	return {
		ledger: createLedger(),
		session: createSession(),
		offsets,
		providersWithData: new Set(),
		codexLimits: null,
	};
}

function resetState(s: SweepState): void {
	s.ledger = createLedger();
	s.session = createSession();
	s.offsets.clear();
	s.providersWithData.clear();
	s.codexLimits = null;
}

// Scan every driver's files into `state`, chunked via processInBatches (yields to
// the event loop; fires onProgress after each batch). Append-only reads and active
// truncations are idempotent (the scanner subtracts a truncated active file's
// contribution before re-reading). A SEALED-file truncation (contribution dropped)
// cannot be reconciled in isolation, so it triggers the spec §4.3 safe recovery:
// reset ALL state and rescan from byte 0. The rescan runs against cleared offsets,
// so no further truncation can fire and the rebuilt ledger never double-counts.
export async function sweepFiles(
	state: SweepState,
	drivers: readonly TelemetryDriver[],
	home: string,
	launchMs: number,
	batchSize: number,
	onProgress?: () => void,
): Promise<{ rebuilt: boolean }> {
	let sealedTruncation = false;
	const handlers: ScanHandlers = {
		ingest: (e) => {
			ingestEvent(state.ledger, state.session, e, launchMs);
			state.providersWithData.add(e.provider);
		},
		onLimits: (id, rl) => {
			if (
				id === "codex" &&
				(!state.codexLimits || rl.capturedAtMs >= state.codexLimits.capturedAtMs)
			) {
				state.codexLimits = rl;
			}
		},
		onSubtract: (contrib) => applyContribution(state.ledger, contrib, -1),
		onSealedTruncation: () => {
			sealedTruncation = true;
		},
	};

	const scanPass = async (): Promise<void> => {
		for (const driver of drivers) {
			for (const root of driver.roots(home)) {
				const files = existsSync(root) ? listJsonlFiles(root) : [];
				await processInBatches(
					files,
					batchSize,
					(file) => {
						if (!sealedTruncation) processJsonlFile(driver, file, state.offsets, handlers);
					},
					onProgress,
				);
				if (sealedTruncation) return;
			}
		}
	};

	await scanPass();
	if (sealedTruncation) {
		resetState(state);
		sealedTruncation = false;
		await scanPass(); // clean rebuild from byte 0 — no contribution to subtract
		return { rebuilt: true };
	}
	return { rebuilt: false };
}
