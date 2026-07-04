import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
	DEFAULT_PERSISTED_SETTINGS,
	PersistedSettingsV1Schema,
	type PersistedSettingsV1,
	type SettingsPatch,
} from "../../shared/models/persisted-settings.js";
import {
	PersistedWorkspaceStateV1Schema,
	PersistedWorkspaceStateV2Schema,
} from "../../shared/models/persisted-workspace-state.js";

export type PersistenceFsAdapter = {
	mkdir: typeof mkdir;
	writeFile: typeof writeFile;
	rename: typeof rename;
	unlink: typeof unlink;
};
const DEFAULT_FS: PersistenceFsAdapter = { mkdir, writeFile, rename, unlink };

export type SettingsReadResult = {
	settings: PersistedSettingsV1;
	firstRun: boolean;
};

export class SettingsService {
	private writeChain: Promise<void> = Promise.resolve();
	private writeCounter = 0;
	private current: PersistedSettingsV1 | null = null;

	constructor(
		private readonly filePath: string,
		private readonly legacyWorkspaceStatePath: string,
		private readonly fs: PersistenceFsAdapter = DEFAULT_FS,
	) {}

	async readState(): Promise<SettingsReadResult> {
		let raw: string;
		try {
			raw = await readFile(this.filePath, "utf8");
		} catch (error) {
			if (isMissingFileError(error)) {
				const seeded = await this.seedFromLegacy();
				await this.persist(seeded);
				this.current = seeded;
				return { settings: seeded, firstRun: true };
			}
			throw error;
		}

		const outcome = parseSettingsFile(raw);
		if (outcome.kind === "corrupt") {
			// Corrupt file — reset to defaults so the app can start.
			await this.persist(DEFAULT_PERSISTED_SETTINGS);
			this.current = DEFAULT_PERSISTED_SETTINGS;
			return { settings: DEFAULT_PERSISTED_SETTINGS, firstRun: false };
		}
		if (outcome.kind === "unknown") {
			// Unknown (likely newer) schema — serve defaults, do NOT overwrite,
			// so the data survives a downgrade.
			this.current = DEFAULT_PERSISTED_SETTINGS;
			return { settings: DEFAULT_PERSISTED_SETTINGS, firstRun: false };
		}
		this.current = outcome.settings;
		return { settings: outcome.settings, firstRun: false };
	}

	// Synchronous twin of readState(), identical parse/seed semantics, for the
	// preload's synchronous settings:readSync IPC (serves settings.initial
	// before first paint, where an async round-trip isn't available).
	readStateSync(): SettingsReadResult {
		let raw: string;
		try {
			raw = readFileSync(this.filePath, "utf8");
		} catch (error) {
			if (isMissingFileError(error)) {
				const seeded = this.seedFromLegacySync();
				this.persistSync(seeded);
				this.current = seeded;
				return { settings: seeded, firstRun: true };
			}
			throw error;
		}

		const outcome = parseSettingsFile(raw);
		if (outcome.kind === "corrupt") {
			this.persistSync(DEFAULT_PERSISTED_SETTINGS);
			this.current = DEFAULT_PERSISTED_SETTINGS;
			return { settings: DEFAULT_PERSISTED_SETTINGS, firstRun: false };
		}
		if (outcome.kind === "unknown") {
			this.current = DEFAULT_PERSISTED_SETTINGS;
			return { settings: DEFAULT_PERSISTED_SETTINGS, firstRun: false };
		}
		this.current = outcome.settings;
		return { settings: outcome.settings, firstRun: false };
	}

	async writeState(patch: SettingsPatch): Promise<PersistedSettingsV1> {
		if (!this.current) {
			const { settings } = await this.readState();
			this.current = settings;
		}
		// usageTelemetry is nested: a shallow `{...this.current, ...patch}` would
		// replace the whole sub-object with `patch.usageTelemetry`, and zod's
		// per-field `.default()` on UsageTelemetrySettingsSchema would then
		// re-inject defaults (not the current values) for any key the patch
		// omitted — e.g. `{usageTelemetry:{enabled:false}}` would silently reset
		// includeUntracked/chipRange. Deep-merge that one nested object so a
		// partial usageTelemetry patch only touches the keys it specifies. This is
		// the single source of truth for the merge: both the settings:write IPC
		// handler and the usage-settings-bridge funnel through writeState().
		const merged = PersistedSettingsV1Schema.parse({
			...this.current,
			...patch,
			...(patch.usageTelemetry
				? {
						usageTelemetry: {
							...this.current.usageTelemetry,
							...patch.usageTelemetry,
						},
					}
				: {}),
			version: 1,
		});
		this.current = merged;
		const previous = this.writeChain;
		const run = (async () => {
			try {
				await previous;
			} catch {
				/* prior write failed; proceed with ours */
			}
			return this.persist(merged);
		})();
		this.writeChain = run.catch(() => {});
		await run;
		return merged;
	}

	private async seedFromLegacy(): Promise<PersistedSettingsV1> {
		try {
			const raw = await readFile(this.legacyWorkspaceStatePath, "utf8");
			return seedFromLegacyRaw(raw);
		} catch {
			/* legacy unreadable — fall through to defaults */
		}
		return DEFAULT_PERSISTED_SETTINGS;
	}

	private seedFromLegacySync(): PersistedSettingsV1 {
		try {
			const raw = readFileSync(this.legacyWorkspaceStatePath, "utf8");
			return seedFromLegacyRaw(raw);
		} catch {
			/* legacy unreadable — fall through to defaults */
		}
		return DEFAULT_PERSISTED_SETTINGS;
	}

	private async persist(state: PersistedSettingsV1): Promise<void> {
		await this.fs.mkdir(dirname(this.filePath), { recursive: true });
		this.writeCounter += 1;
		const tmp = `${this.filePath}.${process.pid}.${this.writeCounter}.${randomUUID()}.ai-14all.tmp`;
		await this.fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
		try {
			await this.fs.rename(tmp, this.filePath);
		} catch (err) {
			await this.fs.unlink(tmp).catch(() => {});
			throw err;
		}
	}

	private persistSync(state: PersistedSettingsV1): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		this.writeCounter += 1;
		const tmp = `${this.filePath}.${process.pid}.${this.writeCounter}.${randomUUID()}.ai-14all.tmp`;
		writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
		try {
			renameSync(tmp, this.filePath);
		} catch (err) {
			try {
				unlinkSync(tmp);
			} catch {
				/* best-effort cleanup */
			}
			throw err;
		}
	}
}

type ParseOutcome =
	| { kind: "corrupt" }
	| { kind: "unknown" }
	| { kind: "ok"; settings: PersistedSettingsV1 };

// Shared by readState() and readStateSync() so both paths apply identical
// corrupt/unknown-schema/ok classification to the same raw file contents.
function parseSettingsFile(raw: string): ParseOutcome {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { kind: "corrupt" };
	}
	const result = PersistedSettingsV1Schema.safeParse(parsed);
	if (!result.success) return { kind: "unknown" };
	return { kind: "ok", settings: result.data };
}

// Shared by seedFromLegacy() and seedFromLegacySync() so both paths derive
// identical settings from the same legacy workspace-state contents.
function seedFromLegacyRaw(raw: string): PersistedSettingsV1 {
	const parsed: unknown = JSON.parse(raw);
	const v2 = PersistedWorkspaceStateV2Schema.safeParse(parsed);
	if (v2.success) {
		return PersistedSettingsV1Schema.parse({
			version: 1,
			restorePreference: v2.data.restorePreference,
			...(v2.data.usageTelemetry
				? { usageTelemetry: v2.data.usageTelemetry }
				: {}),
		});
	}
	// Fall back to the v1 workspace-state shape (pre-multi-workspace): it also
	// carries restorePreference but has no usageTelemetry field at all.
	const v1 = PersistedWorkspaceStateV1Schema.safeParse(parsed);
	if (v1.success) {
		return PersistedSettingsV1Schema.parse({
			version: 1,
			restorePreference: v1.data.restorePreference,
		});
	}
	return DEFAULT_PERSISTED_SETTINGS;
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	);
}
