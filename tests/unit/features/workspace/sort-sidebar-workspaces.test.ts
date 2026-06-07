import { describe, it, expect } from "vitest";
import type { SessionSidebarWorkspace } from "../../../../src/features/workspace/components/SessionSidebar";
import { sortSidebarWorkspaces } from "../../../../src/features/workspace/logic/sort-sidebar-workspaces";

function ws(
	overrides: Partial<SessionSidebarWorkspace> &
		Pick<SessionSidebarWorkspace, "workspaceId" | "name" | "hydrated">,
): SessionSidebarWorkspace {
	return {
		worktrees: [],
		selectedWorktreeId: null,
		attentionByWorktreeId: {},
		active: false,
		...overrides,
	} as SessionSidebarWorkspace;
}

const names = (list: SessionSidebarWorkspace[]) => list.map((w) => w.name);

describe("sortSidebarWorkspaces", () => {
	it("places loaded (hydrated) workspaces before unloaded ones", () => {
		const sorted = sortSidebarWorkspaces([
			ws({ workspaceId: "a", name: "zeta", hydrated: false }),
			ws({ workspaceId: "b", name: "alpha", hydrated: true }),
		]);
		expect(names(sorted)).toEqual(["alpha", "zeta"]);
		expect(sorted.map((w) => w.hydrated)).toEqual([true, false]);
	});

	it("sorts each group alphabetically, case-insensitively", () => {
		const sorted = sortSidebarWorkspaces([
			ws({ workspaceId: "1", name: "delta", hydrated: false }),
			ws({ workspaceId: "2", name: "Bravo", hydrated: true }),
			ws({ workspaceId: "3", name: "charlie", hydrated: false }),
			ws({ workspaceId: "4", name: "apple", hydrated: true }),
		]);
		// loaded group (Bravo, apple) then unloaded group (charlie, delta)
		expect(names(sorted)).toEqual(["apple", "Bravo", "charlie", "delta"]);
	});

	it("does not let the active flag affect ordering within the loaded group", () => {
		const sorted = sortSidebarWorkspaces([
			ws({ workspaceId: "1", name: "yankee", hydrated: true, active: true }),
			ws({ workspaceId: "2", name: "mike", hydrated: true }),
		]);
		expect(names(sorted)).toEqual(["mike", "yankee"]);
	});

	it("breaks ties on equal names deterministically by workspaceId", () => {
		const sorted = sortSidebarWorkspaces([
			ws({ workspaceId: "w2", name: "repo", hydrated: true }),
			ws({ workspaceId: "w1", name: "repo", hydrated: true }),
		]);
		expect(sorted.map((w) => w.workspaceId)).toEqual(["w1", "w2"]);
	});

	it("returns a new array and does not mutate the input", () => {
		const input = [
			ws({ workspaceId: "a", name: "zeta", hydrated: true }),
			ws({ workspaceId: "b", name: "alpha", hydrated: true }),
		];
		const sorted = sortSidebarWorkspaces(input);
		expect(sorted).not.toBe(input);
		expect(names(input)).toEqual(["zeta", "alpha"]);
	});
});
