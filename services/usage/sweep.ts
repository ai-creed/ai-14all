import { existsSync, statSync } from "node:fs";
import { processInBatches } from "./batch.js";
import { parseCodexRateLimits } from "./codex-source.js";
import { readNewLines } from "./incremental-reader.js";
import { codexDriver } from "./providers/codex.js";
import {
	type DailyLedger,
	type SessionState,
	applyContribution,
	createLedger,
	createSession,
	ingestEvent,
} from "./ledger.js";
import { loadState } from "./ledger-store.js";
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

// Load the persisted combined state (ledger + offset cache). They are written as
// ONE atomic file, so a successful load is always a consistent pair; a missing/
// corrupt/old-format file returns a FRESH state so the next sweep rebuilds from
// byte 0 (spec §4.3: the persisted ledger must never double-count, even across a
// crash between writes — which is now impossible since there is a single atomic file).
export function loadPersistedState(statePath: string): SweepState {
	const st = loadState(statePath);
	if (!st) return createSweepState();
	const state = createSweepState(st.offsets);
	state.ledger = st.ledger;
	state.codexLimits = st.codexLimits; // restore the Codex-limits gauge across restarts
	return state;
}

const LIMITS_TAIL_BYTES = 256_000;

// Recover the latest codex rate-limit reading directly from the logs (newest files
// first), INDEPENDENT of the incremental read offset. The "Codex limits" gauge
// reflects the latest known limit, which always lives in the logs — but the sweep
// only reads NEWLY appended bytes, so after a restart the last rate-limit line is
// already behind the saved offset and is never re-read. This one-time launch scan
// of the tail of the few newest codex files restores the gauge WITHOUT re-ingesting
// any tokens (it parses rate-limit lines only and never touches the ledger/offsets).
export function recoverCodexLimits(home: string): ProviderRateLimits | null {
	const files: { path: string; mtime: number }[] = [];
	for (const root of codexDriver.roots(home)) {
		if (!existsSync(root)) continue;
		for (const path of listJsonlFiles(root)) {
			try {
				files.push({ path, mtime: statSync(path).mtimeMs });
			} catch {
				/* unreadable — skip */
			}
		}
	}
	files.sort((a, b) => b.mtime - a.mtime); // newest first
	let best: ProviderRateLimits | null = null;
	for (const { path } of files.slice(0, 3)) {
		let size: number;
		try {
			size = statSync(path).size;
		} catch {
			continue;
		}
		// Read only the tail (the latest rate-limit line sits near the end); a partial
		// first line just fails to parse and is skipped.
		const { lines } = readNewLines(path, Math.max(0, size - LIMITS_TAIL_BYTES), (l) =>
			l.includes('"rate_limits"'),
		);
		for (const line of lines) {
			const rl = parseCodexRateLimits(line);
			if (rl && (!best || rl.capturedAtMs > best.capturedAtMs)) best = rl;
		}
	}
	return best;
}
