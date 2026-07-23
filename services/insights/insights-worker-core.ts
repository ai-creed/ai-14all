import type Database from "better-sqlite3";
import type { WhisperStoreReader } from "../plugins/whisper/whisper-store-reader.js";
import { getMeta, setMetaOnce } from "./store/meta.js";
import { insertObservation } from "./store/observations.js";
import { getWhisperRuns } from "./store/views.js";
import { archiveOnce } from "./whisper/archiver.js";
import { pruneRetention } from "./retention.js";
import type {
	InsightsStatus,
	InsightsWorkerToMain,
	MainToInsightsWorker,
} from "./worker-protocol.js";

export interface WorkerCoreDeps {
	db: Database.Database;
	reader: Pick<
		WhisperStoreReader,
		"listCollabIds" | "readAllWorkflows" | "readSchemaVersion"
	>;
	now: () => number;
	post: (msg: InsightsWorkerToMain) => void;
}

/**
 * The insights worker's testable "brain": ticking (archive + prune + status +
 * once-only first-capture signal) and message handling (flush/query/closeStore).
 * Runs on plain Node — no Electron utilityProcess dependency — so it can be
 * exercised directly in unit tests. The Electron shell that wires this to a
 * real utilityProcess and forwards config/setEnabled lives in Task 10.
 */
export function createInsightsWorkerCore(deps: WorkerCoreDeps) {
	// Seed from the store so a worker restarted after a prior first capture does
	// not re-announce it.
	let firstCaptureAnnounced = getMeta(deps.db, "first_capture_at") != null;

	function status(lastPollAt: number | null): InsightsStatus {
		const fca = getMeta(deps.db, "first_capture_at");
		const countRow = deps.db
			.prepare("SELECT COUNT(*) c FROM observations")
			.get() as { c: number };
		return {
			lastPollAt,
			observationCount: countRow.c,
			whisperAvailable: deps.reader.listCollabIds().length > 0,
			firstCaptureAt: fca ? Number(fca) : null,
		};
	}

	function tick(): void {
		const now = deps.now();
		try {
			const res = archiveOnce(deps.db, deps.reader, { nowMs: now });
			pruneRetention(deps.db, now);
			deps.post({ kind: "status", status: status(now) });
			if (res.firstCaptureAt != null && !firstCaptureAnnounced) {
				firstCaptureAnnounced = true;
				deps.post({ kind: "firstCapture" });
			}
		} catch (e) {
			deps.post({
				kind: "error",
				scope: "tick",
				message: String((e as Error).message ?? e),
			});
		}
	}

	function handleMessage(msg: MainToInsightsWorker): void {
		switch (msg.kind) {
			case "flush":
				tick();
				return;
			case "query": {
				try {
					const result = getWhisperRuns(deps.db, msg.query.range);
					deps.post({ kind: "queryResult", requestId: msg.requestId, result });
				} catch (e) {
					deps.post({
						kind: "error",
						scope: "query",
						message: String((e as Error).message ?? e),
					});
				}
				return;
			}
			// Live producer delivery (spec §6): ONE transaction covering the insert
			// and the first_capture_at marker, then ack. Because it is atomic, a
			// crash leaves the store fully-before or fully-after — never a row
			// without its marker — so a replay is a clean no-op or a clean write.
			case "producerEvent": {
				try {
					const tx = deps.db.transaction(() => {
						// `ingestedAt` is stamped HERE: only the worker knows when the row
						// actually landed (main sends a 0 placeholder).
						const wrote = insertObservation(deps.db, {
							...msg.observation,
							ingestedAt: deps.now(),
						});
						if (wrote)
							setMetaOnce(deps.db, "first_capture_at", String(deps.now()));
					});
					tx();
					// Ack ONLY after the transaction commits.
					deps.post({ kind: "ack", eventId: msg.eventId });
				} catch (e) {
					// No ack: a rejected event stays buffered (bounded by the outbox cap)
					// rather than being silently reported as written.
					deps.post({
						kind: "error",
						scope: "producerEvent",
						message: String((e as Error).message ?? e),
					});
				}
				return;
			}
			case "closeStore": {
				try {
					deps.db.close();
				} finally {
					deps.post({ kind: "storeClosed", requestId: msg.requestId });
				}
				return;
			}
			case "config":
			case "setEnabled":
				// Handled by the Electron shell (Task 10); no-op at the core level.
				return;
		}
	}

	return { handleMessage, tick, status };
}
