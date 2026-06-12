import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import { useWhisperState } from "../../../src/features/workflows/hooks/use-whisper-state";

const state = (status: string): WhisperWorktreeState => ({
	worktreeId: "wt-1",
	collabId: "c1",
	daemonAlive: true,
	liveFeed: "polling",
	bindings: [],
	handoffs: [],
	workflow: {
		workflowId: "wf1",
		workflowType: "sdd",
		status,
		currentPhaseIndex: 0,
		phaseName: "implementation",
		currentChainId: null,
		round: null,
		haltReason: status === "halted" ? "boom" : null,
		updatedAt: "t",
	},
	escalation: null,
});

describe("useWhisperState", () => {
	it("stores pushed states and dispatches attention on halt transitions", () => {
		let push: ((s: WhisperWorktreeState[]) => void) | null = null;
		const onWhisperStateChanged = vi.fn((cb) => {
			push = cb;
			return () => {};
		});
		const dispatch = vi.fn();
		const { result } = renderHook(() =>
			useWhisperState({ onWhisperStateChanged, dispatch }),
		);
		act(() => push?.([state("running")]));
		expect(result.current.get("wt-1")?.workflow?.status).toBe("running");
		expect(dispatch).not.toHaveBeenCalled();
		act(() => push?.([state("halted")]));
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "session/reportAgentAttention",
				worktreeId: "wt-1",
				reason: expect.objectContaining({
					source: "workflow",
					state: "waiting",
					summary: "boom",
				}),
			}),
		);
		act(() => push?.([state("running")]));
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "session/clearSessionAgentAttention",
				worktreeId: "wt-1",
				source: "workflow",
			}),
		);
	});

	it("clears state for worktrees that disappear from a push", () => {
		let push: ((s: WhisperWorktreeState[]) => void) | null = null;
		const { result } = renderHook(() =>
			useWhisperState({
				onWhisperStateChanged: (cb) => {
					push = cb;
					return () => {};
				},
				dispatch: vi.fn(),
			}),
		);
		act(() => push?.([state("running")]));
		act(() => push?.([]));
		expect(result.current.get("wt-1")).toBeUndefined();
	});

	it("marks the row stale when reads fail mid-daemon (workflow null, daemon alive)", () => {
		let push: ((s: WhisperWorktreeState[]) => void) | null = null;
		const { result } = renderHook(() =>
			useWhisperState({
				onWhisperStateChanged: (cb) => {
					push = cb;
					return () => {};
				},
				dispatch: vi.fn(),
			}),
		);
		act(() => push?.([state("running")]));
		act(() => push?.([{ ...state("running"), workflow: null }]));
		const entry = result.current.get("wt-1");
		expect(entry?.stale).toBe(true);
		expect(entry?.workflow?.workflowId).toBe("wf1"); // last-known retained
	});
});
