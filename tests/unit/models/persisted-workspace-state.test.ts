import { describe, it, expect } from "vitest";
import { WorkspaceSnapshotSchema } from "../../../shared/models/persisted-workspace-state";

function snapshotWith(preset: Record<string, unknown>) {
	return {
		repositoryPath: "/repo",
		selectedWorktreeId: null,
		commandPresets: [preset],
		worktreeSessions: [],
	};
}

describe("WorkspaceSnapshotSchema command preset target", () => {
	it('defaults a preset without `target` to "pinned"', () => {
		const parsed = WorkspaceSnapshotSchema.parse(
			snapshotWith({ id: "p", label: "x", command: "echo x" }),
		);
		expect(parsed.commandPresets[0].target).toBe("pinned");
	});

	it("round-trips an explicit `throwaway` target", () => {
		const parsed = WorkspaceSnapshotSchema.parse(
			snapshotWith({
				id: "p",
				label: "x",
				command: "echo x",
				target: "throwaway",
			}),
		);
		expect(parsed.commandPresets[0].target).toBe("throwaway");
	});
});
