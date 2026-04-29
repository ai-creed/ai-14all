import type { PersistedWorkspaceStateV2 } from "../../shared/models/persisted-workspace-state.js";
import type { WorkspacePersistenceService } from "./workspace-persistence-service.js";

export class WorkspacePersistenceCoordinator {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private pending: PersistedWorkspaceStateV2 | null = null;

	constructor(
		private readonly service: Pick<WorkspacePersistenceService, "writeState">,
		private readonly debounceMs = 250,
	) {}

	enqueueWrite(state: PersistedWorkspaceStateV2): void {
		this.pending = state;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			void this.drain();
		}, this.debounceMs);
	}

	async flush(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		await this.drain();
	}

	private async drain(): Promise<void> {
		const state = this.pending;
		this.pending = null;
		this.timer = null;
		if (!state) return;
		await this.service.writeState(state);
	}
}
