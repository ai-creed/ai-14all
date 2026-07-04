import { describe, expect, it } from "vitest";
import { pickNextHydration } from "../../../src/features/workspace/logic/background-hydration";
import type { AppWorkspacesState } from "../../../src/features/workspace/logic/app-workspaces-state";

function ws(
	id: string,
	opts: { state?: boolean; loadError?: string | null } = {},
) {
	return {
		workspaceId: id,
		repository: { id, name: id, rootPath: `/repos/${id}`, repoId: id },
		worktrees: [],
		workspaceState: opts.state ? ({} as never) : null,
		persistedSnapshot: null,
		hydrationState: opts.state
			? ("inactiveLive" as const)
			: ("dormant" as const),
		loadError: opts.loadError ?? null,
	};
}

function make(
	order: string[],
	active: string,
	entries: ReturnType<typeof ws>[],
): AppWorkspacesState {
	return {
		activeWorkspaceId: active,
		workspaceOrder: order,
		workspacesById: Object.fromEntries(entries.map((e) => [e.workspaceId, e])),
	};
}

describe("pickNextHydration", () => {
	it("returns the first dormant non-active workspace in order", () => {
		const s = make(["a", "b", "c"], "a", [
			ws("a", { state: true }),
			ws("b"),
			ws("c"),
		]);
		expect(pickNextHydration(s)).toBe("b");
	});
	it("skips hydrated and errored workspaces", () => {
		const s = make(["a", "b", "c"], "a", [
			ws("a", { state: true }),
			ws("b", { state: true }),
			ws("c", { loadError: "ENOENT" }),
		]);
		expect(pickNextHydration(s)).toBe(null);
	});
	it("never returns the active workspace even if dormant-shaped", () => {
		const s = make(["a"], "a", [ws("a")]);
		expect(pickNextHydration(s)).toBe(null);
	});
});
