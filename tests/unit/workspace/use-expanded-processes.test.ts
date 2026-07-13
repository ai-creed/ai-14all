import { describe, expect, it, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useExpandedProcesses } from "../../../src/features/workspace/logic/use-expanded-processes";

afterEach(() => localStorage.clear());

describe("useExpandedProcesses", () => {
	it("defaults to empty", () => {
		const { result } = renderHook(() => useExpandedProcesses());
		expect(result.current.expandedIds).toEqual([]);
	});

	it("toggles a worktree id on and persists to storage", () => {
		const { result } = renderHook(() => useExpandedProcesses());
		act(() => result.current.toggle("wt-1"));
		expect(result.current.expandedIds).toEqual(["wt-1"]);
		expect(localStorage.getItem("ai14all.expandedProcessWorktrees")).toContain(
			"wt-1",
		);
	});

	it("toggles a worktree id off and removes from storage", () => {
		const { result } = renderHook(() => useExpandedProcesses());
		act(() => result.current.toggle("wt-1"));
		act(() => result.current.toggle("wt-1"));
		expect(result.current.expandedIds).toEqual([]);
	});

	it("persists across remounts", () => {
		const first = renderHook(() => useExpandedProcesses());
		act(() => first.result.current.toggle("wt-a"));
		expect(first.result.current.expandedIds).toEqual(["wt-a"]);

		const second = renderHook(() => useExpandedProcesses());
		expect(second.result.current.expandedIds).toEqual(["wt-a"]);

		act(() => second.result.current.toggle("wt-a"));
		expect(second.result.current.expandedIds).toEqual([]);
	});
});
