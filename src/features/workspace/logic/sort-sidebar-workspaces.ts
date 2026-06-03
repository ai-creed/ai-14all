import type { SessionSidebarWorkspace } from "../components/SessionSidebar";

/**
 * Order sidebar workspaces so loaded (hydrated) workspaces come first, then
 * unloaded ones. Within each group, sort alphabetically by name
 * (case-insensitive), with a stable workspaceId tiebreak for equal names.
 * Returns a new array; the input is not mutated.
 */
export function sortSidebarWorkspaces(
	workspaces: SessionSidebarWorkspace[],
): SessionSidebarWorkspace[] {
	return [...workspaces].sort((a, b) => {
		if (a.hydrated !== b.hydrated) return a.hydrated ? -1 : 1;
		const byName = a.name.localeCompare(b.name, undefined, {
			sensitivity: "base",
		});
		if (byName !== 0) return byName;
		return a.workspaceId.localeCompare(b.workspaceId);
	});
}
