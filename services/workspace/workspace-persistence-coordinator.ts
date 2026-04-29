import type { PersistedWorkspaceStateV2 } from "../../shared/models/persisted-workspace-state.js";
import type { WorkspacePersistenceService } from "./workspace-persistence-service.js";

export class WorkspacePersistenceCoordinator {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private pending: PersistedWorkspaceStateV2 | null = null;
	private pendingResolvers: Array<() => void> = [];
	private pendingRejectors: Array<(err: unknown) => void> = [];

	constructor(
		private readonly service: Pick<WorkspacePersistenceService, "writeState">,
		private readonly debounceMs = 250,
	) {}

	/**
	 * Enqueue a write. Returns a promise that resolves once the next coalesced
	 * write completes (whether via debounce timer fire or `flush()`).
	 */
	enqueueWrite(state: PersistedWorkspaceStateV2): Promise<void> {
		this.pending = state;
		const completion = new Promise<void>((resolve, reject) => {
			this.pendingResolvers.push(resolve);
			this.pendingRejectors.push(reject);
		});
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			void this.drain();
		}, this.debounceMs);
		return completion;
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
		const resolvers = this.pendingResolvers;
		const rejectors = this.pendingRejectors;
		this.pending = null;
		this.timer = null;
		this.pendingResolvers = [];
		this.pendingRejectors = [];
		if (!state) {
			for (const resolve of resolvers) resolve();
			return;
		}
		try {
			await this.service.writeState(state);
			for (const resolve of resolvers) resolve();
		} catch (err) {
			for (const reject of rejectors) reject(err);
			throw err;
		}
	}
}
