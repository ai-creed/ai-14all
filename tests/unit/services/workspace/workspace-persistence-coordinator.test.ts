// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePersistenceCoordinator } from "../../../../services/workspace/workspace-persistence-coordinator.js";
import type { PersistedWorkspaceStateV2 } from "../../../../shared/models/persisted-workspace-state.js";

const fixture = (
	overrides: Partial<{ activeWorkspaceId: string | null }> = {},
): PersistedWorkspaceStateV2 => ({
	version: 2,
	restorePreference: "prompt",
	activeWorkspaceId: null,
	workspaceOrder: [],
	workspaces: [],
	...overrides,
});

describe("WorkspacePersistenceCoordinator", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("coalesces multiple enqueueWrite calls within the debounce window into one write", async () => {
		const writeState = vi.fn().mockResolvedValue(undefined);
		const coord = new WorkspacePersistenceCoordinator({ writeState }, 250);

		coord.enqueueWrite(fixture({ activeWorkspaceId: "a" }));
		coord.enqueueWrite(fixture({ activeWorkspaceId: "b" }));
		coord.enqueueWrite(fixture({ activeWorkspaceId: "c" }));

		expect(writeState).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(250);
		expect(writeState).toHaveBeenCalledTimes(1);
		expect(writeState).toHaveBeenCalledWith(
			expect.objectContaining({ activeWorkspaceId: "c" }),
		);
	});

	it("flush() writes immediately when a debounce timer is pending", async () => {
		const writeState = vi.fn().mockResolvedValue(undefined);
		const coord = new WorkspacePersistenceCoordinator({ writeState }, 250);

		coord.enqueueWrite(fixture({ activeWorkspaceId: "x" }));
		await coord.flush();

		expect(writeState).toHaveBeenCalledTimes(1);
		expect(writeState).toHaveBeenCalledWith(
			expect.objectContaining({ activeWorkspaceId: "x" }),
		);
	});

	it("flush() is a no-op when no write is pending", async () => {
		const writeState = vi.fn().mockResolvedValue(undefined);
		const coord = new WorkspacePersistenceCoordinator({ writeState }, 250);

		await coord.flush();
		expect(writeState).not.toHaveBeenCalled();
	});
});
