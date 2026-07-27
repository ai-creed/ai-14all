import type { Completeness, WhisperRunRow } from "./store/views.js";
import type { ObservationInput } from "./store/observations.js";

export interface InsightsWorkerConfig {
	userDataDir: string;
	whisperDbPath: string | null;
	pollIntervalMs: number;
}

// Slimmed to the fields with a consumer (E1): the host reads firstCaptureAt
// for the notice re-drive; lastPollAt is the liveness stamp. The old
// observationCount / whisperAvailable fields cost a COUNT(*) and a whisper-DB
// enumeration per 3s tick and had no reader anywhere.
export interface InsightsStatus {
	lastPollAt: number | null;
	firstCaptureAt: number | null;
}

/** Aggregated app-time read result (spec §7). */
export interface AppTimeResult {
	focusedMs: number;
	engagedMs: number;
	completeness: Completeness;
}

export type InsightsQuery =
	| { name: "whisperRuns"; range: { fromMs: number; toMs: number } }
	| { name: "appTime"; range: { fromMs: number; toMs: number } };

export type MainToInsightsWorker =
	| { kind: "config"; config: InsightsWorkerConfig }
	| { kind: "setEnabled"; enabled: boolean }
	| { kind: "closeStore"; requestId: string }
	| { kind: "query"; requestId: string; query: InsightsQuery }
	// Live-producer delivery (spec §6). The worker inserts it in one transaction
	// and acks by id only after that transaction commits.
	| { kind: "producerEvent"; eventId: string; observation: ObservationInput }
	| { kind: "flush" };

export type InsightsWorkerToMain =
	| { kind: "status"; status: InsightsStatus }
	| {
			kind: "queryResult";
			requestId: string;
			result: { runs: WhisperRunRow[]; completeness: Completeness };
	  }
	// A separate kind (rather than widening `queryResult`) keeps the Phase-1
	// whisper read contract and its tests untouched.
	| { kind: "appTimeResult"; requestId: string; result: AppTimeResult }
	| { kind: "ack"; eventId: string }
	| { kind: "storeClosed"; requestId: string }
	| { kind: "firstCapture" }
	| { kind: "error"; scope: string; message: string };
