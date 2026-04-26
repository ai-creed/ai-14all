import type { Repository } from "../../shared/models/repository.js";

export class WorkspaceRegistryService {
	private readonly byWorkspaceId = new Map<string, Repository>();
	private readonly listeners = new Set<() => void>();

	register(entry: { workspaceId: string; repository: Repository }) {
		for (const [workspaceId, repository] of this.byWorkspaceId) {
			if (
				(repository.repoId && repository.repoId === entry.repository.repoId) ||
				repository.rootPath === entry.repository.rootPath
			) {
				// Update the stored entry so the backend reflects the latest path/metadata.
				this.byWorkspaceId.set(workspaceId, entry.repository);
				this.emit();
				return { workspaceId, repository: entry.repository };
			}
		}
		this.byWorkspaceId.set(entry.workspaceId, entry.repository);
		this.emit();
		return entry;
	}

	get(workspaceId: string): Repository {
		const repository = this.byWorkspaceId.get(workspaceId);
		if (!repository) throw new Error(`Unknown workspace: ${workspaceId}`);
		return repository;
	}

	listRepositories(): Repository[] {
		return [...this.byWorkspaceId.values()];
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				// Swallow errors
			}
		}
	}
}
