import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PushWakeSeenState } from "./push-wake-detector.js";

const FILE_NAME = "push-wake-state.json";

// Last-seen + last-pinged bookkeeping for the push-wake watcher. Lives in
// ai-14all's own XBP dir — whisper's state.db is a read-only contract. On any
// read problem we fall back to null (fresh baseline): the baseline never
// re-pings, which is the required fail-direction.
export class PushWakeStateStore {
	private readonly dir: string;
	private readonly path: string;
	constructor(opts: { dir: string }) {
		this.dir = opts.dir;
		this.path = join(opts.dir, FILE_NAME);
	}

	load(): PushWakeSeenState | null {
		try {
			const parsed = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				typeof (parsed as PushWakeSeenState).workflows !== "object" ||
				(parsed as PushWakeSeenState).workflows === null ||
				!Array.isArray((parsed as PushWakeSeenState).pingedWorkflows) ||
				!Array.isArray((parsed as PushWakeSeenState).pingedChains)
			)
				return null;
			return parsed as PushWakeSeenState;
		} catch {
			return null;
		}
	}

	save(state: PushWakeSeenState): void {
		try {
			mkdirSync(this.dir, { recursive: true });
			writeFileSync(this.path, JSON.stringify(state));
		} catch (e) {
			console.warn("[push-wake] failed to persist watcher state:", e);
		}
	}
}
