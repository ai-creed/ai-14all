import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	DEFAULT_PERSISTED_WORKSPACE_STATE,
	PersistedWorkspaceStateSchema,
	type PersistedWorkspaceState,
} from "../../shared/models/persisted-workspace-state.js";

export class WorkspacePersistenceService {
	constructor(private readonly filePath: string) {}

	async readState(): Promise<PersistedWorkspaceState> {
		let raw: string;
		try {
			raw = await readFile(this.filePath, "utf8");
		} catch (error) {
			if (isMissingFileError(error)) {
				return DEFAULT_PERSISTED_WORKSPACE_STATE;
			}
			throw error;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			// File contains invalid JSON — overwrite with a clean default so the
			// app can start and future writes produce valid output.
			await this.writeState(DEFAULT_PERSISTED_WORKSPACE_STATE);
			return DEFAULT_PERSISTED_WORKSPACE_STATE;
		}

		const result = PersistedWorkspaceStateSchema.safeParse(parsed);
		if (result.success) return result.data;

		// File is valid JSON but does not match the current schema (e.g. written
		// by a newer app version).  Return the default without overwriting so
		// the data survives a downgrade.
		return DEFAULT_PERSISTED_WORKSPACE_STATE;
	}

	async writeState(state: PersistedWorkspaceState): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFile(
			this.filePath,
			`${JSON.stringify(state, null, 2)}\n`,
			"utf8",
		);
	}
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	);
}
