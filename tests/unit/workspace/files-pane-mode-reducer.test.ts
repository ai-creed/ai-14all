import { describe, expect, it } from "vitest";
import {
	createWorkspaceState,
	workspaceReducer,
} from "../../../src/features/workspace/logic/workspace-state";
import { buildWorkspaceSnapshot } from "../../../src/features/workspace/logic/workspace-persistence";
import { PersistedWorktreeSessionSchema } from "../../../shared/models/persisted-workspace-state";

const worktree = {
	id: "wt1",
	repositoryId: "repo-1",
	branchName: "main",
	path: "/repo",
	label: "main",
	isMain: true,
};

describe("filesPaneMode reducer + snapshot", () => {
	it("defaults a new session to files mode", () => {
		const state = createWorkspaceState([worktree]);
		expect(state.sessionsByWorktreeId["wt1"]!.filesPaneMode).toBe("files");
	});

	it("setFilesPaneMode switches the session to symbols", () => {
		let state = createWorkspaceState([worktree]);
		state = workspaceReducer(state, {
			type: "session/setFilesPaneMode",
			worktreeId: "wt1",
			filesPaneMode: "symbols",
		});
		expect(state.sessionsByWorktreeId["wt1"]!.filesPaneMode).toBe("symbols");
	});

	it("serializes filesPaneMode into the snapshot", () => {
		let state = createWorkspaceState([worktree]);
		state = workspaceReducer(state, {
			type: "session/setFilesPaneMode",
			worktreeId: "wt1",
			filesPaneMode: "symbols",
		});
		const snapshot = buildWorkspaceSnapshot("/repo", "repo-1", state);
		expect(snapshot.worktreeSessions[0]!.filesPaneMode).toBe("symbols");
	});

	// Spec edge case 8 — the FULL round trip in one committed test, so a bug in
	// any single layer (writer, schema, restore) fails here rather than only in a
	// manual check: buildWorkspaceSnapshot → Zod parse → session/restoreSnapshot.
	it("round-trips symbols mode through snapshot → schema parse → restore", () => {
		let state = createWorkspaceState([worktree]);
		state = workspaceReducer(state, {
			type: "session/setFilesPaneMode",
			worktreeId: "wt1",
			filesPaneMode: "symbols",
		});
		const snapshot = buildWorkspaceSnapshot("/repo", "repo-1", state);
		const parsedSession = PersistedWorktreeSessionSchema.parse(
			snapshot.worktreeSessions[0],
		);

		const fresh = createWorkspaceState([worktree]);
		const restored = workspaceReducer(fresh, {
			type: "session/restoreSnapshot",
			snapshot: parsedSession,
			workspaceId: "repo-1",
		});
		expect(restored.sessionsByWorktreeId["wt1"]!.filesPaneMode).toBe("symbols");
	});

	// Back-compat: a snapshot written before this feature has no filesPaneMode.
	// Zod defaults it to "files" and restore must hydrate that default, never crash.
	it("hydrates a pre-feature snapshot (no filesPaneMode) to the files default", () => {
		const state = createWorkspaceState([worktree]);
		const snapshot = buildWorkspaceSnapshot("/repo", "repo-1", state);
		const raw = { ...snapshot.worktreeSessions[0]! };
		delete (raw as { filesPaneMode?: unknown }).filesPaneMode;
		const parsedSession = PersistedWorktreeSessionSchema.parse(raw);
		expect(parsedSession.filesPaneMode).toBe("files");

		const restored = workspaceReducer(createWorkspaceState([worktree]), {
			type: "session/restoreSnapshot",
			snapshot: parsedSession,
			workspaceId: "repo-1",
		});
		expect(restored.sessionsByWorktreeId["wt1"]!.filesPaneMode).toBe("files");
	});
});
