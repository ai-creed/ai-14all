import type { Repository } from "../../shared/models/repository.js";

export class WorkspaceRegistryService {
	private readonly byWorkspaceId = new Map<string, Repository>();

	register(entry: { workspaceId: string; repository: Repository }) {
		for (const [workspaceId, repository] of this.byWorkspaceId) {
			if (
				(repository.repoId && repository.repoId === entry.repository.repoId) ||
				repository.rootPath === entry.repository.rootPath
			) {
				return { workspaceId, repository };
			}
		}
		this.byWorkspaceId.set(entry.workspaceId, entry.repository);
		return entry;
	}

	get(workspaceId: string): Repository {
		const repository = this.byWorkspaceId.get(workspaceId);
		if (!repository) throw new Error(`Unknown workspace: ${workspaceId}`);
		return repository;
	}
}
