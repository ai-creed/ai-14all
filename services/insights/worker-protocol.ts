import type { Completeness, WhisperRunRow } from "./store/views.js";

export interface InsightsWorkerConfig {
	userDataDir: string;
	whisperDbPath: string | null;
	pollIntervalMs: number;
}

export interface InsightsStatus {
	lastPollAt: number | null;
	observationCount: number;
	whisperAvailable: boolean;
	firstCaptureAt: number | null;
}

export type InsightsQuery = {
	name: "whisperRuns";
	range: { fromMs: number; toMs: number };
};

export type MainToInsightsWorker =
	| { kind: "config"; config: InsightsWorkerConfig }
	| { kind: "setEnabled"; enabled: boolean }
	| { kind: "closeStore"; requestId: string }
	| { kind: "query"; requestId: string; query: InsightsQuery }
	| { kind: "flush" };

export type InsightsWorkerToMain =
	| { kind: "status"; status: InsightsStatus }
	| {
			kind: "queryResult";
			requestId: string;
			result: { runs: WhisperRunRow[]; completeness: Completeness };
	  }
	| { kind: "storeClosed"; requestId: string }
	| { kind: "firstCapture" }
	| { kind: "error"; scope: string; message: string };
