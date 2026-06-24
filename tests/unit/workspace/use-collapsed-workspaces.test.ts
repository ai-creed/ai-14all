import { describe, expect, it, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCollapsedWorkspaces } from "../../../src/features/workspace/logic/use-collapsed-workspaces";

beforeEach(() => localStorage.clear());

describe("useCollapsedWorkspaces", () => {
	it("toggles ids and persists across remounts", () => {
		const first = renderHook(() => useCollapsedWorkspaces());
		act(() => first.result.current.toggle("ws-a"));
		expect(first.result.current.collapsedIds).toEqual(["ws-a"]);

		const second = renderHook(() => useCollapsedWorkspaces());
		expect(second.result.current.collapsedIds).toEqual(["ws-a"]);

		act(() => second.result.current.toggle("ws-a"));
		expect(second.result.current.collapsedIds).toEqual([]);
	});
});
