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
		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed = PersistedWorkspaceStateSchema.safeParse(JSON.parse(raw));
			if (parsed.success) return parsed.data;
		} catch (error) {
			if (isMissingFileError(error)) {
				return DEFAULT_PERSISTED_WORKSPACE_STATE;
			}
		}

		await this.writeState(DEFAULT_PERSISTED_WORKSPACE_STATE);
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
