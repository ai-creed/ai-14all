import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PushWakeSeenState } from "./push-wake-detector.js";

const FILE_NAME = "push-wake-state.json";
const TMP_NAME = "push-wake-state.json.tmp";

export type PushWakeAttentionSeenState = {
	sessions: Record<string, "waiting" | "failed">;
};

// Composite watcher state (child spec §2). Each namespace is independently
// nullable: null = "this detector never completed a successful baseline
// pass" — durably distinct from established-but-empty, which fires
// first-sight. lastPingAt is the §3 coalesce timestamp (last ATTEMPT).
export type PushWakeWatcherStateV2 = {
	version: 2;
	whisper: PushWakeSeenState | null;
	attention: PushWakeAttentionSeenState | null;
	lastPingAt: number | null;
};

type FsSeam = {
	mkdirSync: typeof mkdirSync;
	readFileSync: typeof readFileSync;
	writeFileSync: typeof writeFileSync;
	renameSync: typeof renameSync;
};

function isLegacyV1(v: unknown): v is PushWakeSeenState {
	if (typeof v !== "object" || v === null) return false;
	const s = v as PushWakeSeenState;
	return (
		typeof s.workflows === "object" &&
		s.workflows !== null &&
		Array.isArray(s.pingedWorkflows) &&
		Array.isArray(s.pingedChains)
	);
}

function isAttentionNamespace(v: unknown): v is PushWakeAttentionSeenState {
	if (typeof v !== "object" || v === null) return false;
	const sessions = (v as PushWakeAttentionSeenState).sessions;
	if (typeof sessions !== "object" || sessions === null) return false;
	return Object.values(sessions).every(
		(s) => s === "waiting" || s === "failed",
	);
}

function isV2(v: unknown): v is PushWakeWatcherStateV2 {
	if (typeof v !== "object" || v === null) return false;
	const s = v as PushWakeWatcherStateV2;
	if (s.version !== 2) return false;
	if (s.whisper !== null && !isLegacyV1(s.whisper)) return false;
	if (s.attention !== null && !isAttentionNamespace(s.attention)) return false;
	return s.lastPingAt === null || typeof s.lastPingAt === "number";
}

// On any read problem we fall back to null: both namespaces read as
// never-baselined, which records without firing (§2 null-baseline rule) —
// the required fail-direction (never re-pings).
export class PushWakeStateStore {
	private readonly dir: string;
	private readonly path: string;
	private readonly tmpPath: string;
	private readonly fs: FsSeam;
	constructor(opts: { dir: string; fsImpl?: FsSeam }) {
		this.dir = opts.dir;
		this.path = join(opts.dir, FILE_NAME);
		this.tmpPath = join(opts.dir, TMP_NAME);
		this.fs = opts.fsImpl ?? {
			mkdirSync,
			readFileSync,
			writeFileSync,
			renameSync,
		};
	}

	load(): PushWakeWatcherStateV2 | null {
		try {
			const parsed = JSON.parse(
				this.fs.readFileSync(this.path, "utf8") as string,
			) as unknown;
			if (isV2(parsed)) return parsed;
			if (isLegacyV1(parsed)) {
				// v1 migration: attention is established-and-EMPTY, not null —
				// nothing attention-related was ever pinged before v2, so
				// first-sight firing there is a first ping, not a duplicate.
				return {
					version: 2,
					whisper: parsed,
					attention: { sessions: {} },
					lastPingAt: null,
				};
			}
			return null;
		} catch {
			return null;
		}
	}

	// Same-directory temp write + atomic rename: a crash at any point before
	// the rename leaves the prior valid file intact (§2 atomic mechanism).
	save(state: PushWakeWatcherStateV2): boolean {
		try {
			this.fs.mkdirSync(this.dir, { recursive: true });
			this.fs.writeFileSync(this.tmpPath, JSON.stringify(state));
			this.fs.renameSync(this.tmpPath, this.path);
			return true;
		} catch (e) {
			console.warn("[push-wake] failed to persist watcher state:", e);
			return false;
		}
	}
}
