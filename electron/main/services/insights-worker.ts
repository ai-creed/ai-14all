// utilityProcess child shell: wires parentPort <-> the testable core, owning the
// poll timer + SQLite store lifecycle. Electron-only (uses process.parentPort), so
// it is NOT host-Node unit-tested — it is verified via the InsightsHost unit test
// (fake proc) plus the Task 14 e2e build/run. Keep it a thin shell: all analytics
// logic lives in the electron-free, unit-tested createInsightsWorkerCore.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "../../../services/insights/store/schema.js";
import { createInsightsWorkerCore } from "../../../services/insights/insights-worker-core.js";
import { WhisperStoreReader } from "../../../services/plugins/whisper/whisper-store-reader.js";
import type {
	InsightsWorkerConfig,
	InsightsWorkerToMain,
	MainToInsightsWorker,
} from "../../../services/insights/worker-protocol.js";

// utilityProcess child <-> parent channel. Typed via a cast so we don't depend on
// Electron's ambient process augmentation in the node typecheck project (mirrors
// usage-worker.ts).
const parentPort = (
	process as unknown as {
		parentPort: {
			on(
				event: "message",
				cb: (e: { data: MainToInsightsWorker }) => void,
			): void;
			postMessage(message: InsightsWorkerToMain): void;
		};
	}
).parentPort;

let db: Database.Database | null = null;
let core: ReturnType<typeof createInsightsWorkerCore> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function boot(config: InsightsWorkerConfig): void {
	mkdirSync(join(config.userDataDir, "insights"), { recursive: true });
	db = new Database(join(config.userDataDir, "insights", "insights.db"));
	db.pragma("journal_mode = WAL");
	migrate(db);
	const reader = new WhisperStoreReader(config.whisperDbPath ?? "");
	core = createInsightsWorkerCore({
		db,
		reader,
		now: () => Date.now(),
		post: (m) => parentPort.postMessage(m),
	});
	core.tick();
	timer = setInterval(() => core?.tick(), config.pollIntervalMs);
}

parentPort.on("message", (e: { data: MainToInsightsWorker }) => {
	const msg = e.data;
	if (msg.kind === "config") {
		boot(msg.config);
		return;
	}
	// closeStore: stop polling before the core closes the SQLite handle, so no tick
	// can touch a closed db; the core then posts `storeClosed` back to the host.
	if (msg.kind === "closeStore" && timer) {
		clearInterval(timer);
		timer = null;
	}
	core?.handleMessage(msg);
});
