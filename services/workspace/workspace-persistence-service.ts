import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	DEFAULT_PERSISTED_WORKSPACE_STATE,
	PersistedWorkspaceStateV1Schema,
	PersistedWorkspaceStateV2Schema,
	type PersistedWorkspaceStateV2,
} from "../../shared/models/persisted-workspace-state.js";

function migratePersistedWorkspaceState(
	raw: unknown,
): PersistedWorkspaceStateV2 {
	const parsedV1 = PersistedWorkspaceStateV1Schema.safeParse(raw);
	if (parsedV1.success) {
		const snapshot = parsedV1.data.snapshot;
		if (!snapshot) {
			return {
				version: 2,
				restorePreference: parsedV1.data.restorePreference,
				activeWorkspaceId: null,
				workspaceOrder: [],
				workspaces: [],
			};
		}
		const workspaceId = snapshot.repoId
			? `workspace:${snapshot.repoId}`
			: `workspace:${snapshot.repositoryPath}`;
		return {
			version: 2,
			restorePreference: parsedV1.data.restorePreference,
			activeWorkspaceId: workspaceId,
			workspaceOrder: [workspaceId],
			workspaces: [
				{
					workspaceId,
					repositoryPath: snapshot.repositoryPath,
					repoId: snapshot.repoId,
					snapshot,
				},
			],
		};
	}

	const parsedV2 = PersistedWorkspaceStateV2Schema.safeParse(raw);
	if (parsedV2.success) return parsedV2.data;

	throw new Error("Unsupported persisted workspace schema");
}

export class WorkspacePersistenceService {
	constructor(private readonly filePath: string) {}

	async readState(): Promise<PersistedWorkspaceStateV2> {
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

		try {
			return migratePersistedWorkspaceState(parsed);
		} catch {
			// File is valid JSON but does not match any known schema (e.g. written
			// by a newer app version).  Return the default without overwriting so
			// the data survives a downgrade.
			return DEFAULT_PERSISTED_WORKSPACE_STATE;
		}
	}

	async writeState(state: PersistedWorkspaceStateV2): Promise<void> {
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
