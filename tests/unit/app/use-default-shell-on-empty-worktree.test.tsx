import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDefaultShellOnEmptyWorktree } from "../../../src/app/hooks/use-default-shell-on-empty-worktree";

const base = {
	startupMode: "ready",
	activeWorktreeId: "w1",
	activeSessionProcessCount: 0,
	hasActiveSession: true,
	agentsAvailable: false,
	createDefaultShell: () => Promise.resolve(),
};

describe("useDefaultShellOnEmptyWorktree", () => {
	it("creates a default shell on an empty worktree when no agents are available", () => {
		const createDefaultShell = vi.fn(() => Promise.resolve());
		renderHook(() =>
			useDefaultShellOnEmptyWorktree({ ...base, createDefaultShell }),
		);
		expect(createDefaultShell).toHaveBeenCalledTimes(1);
	});

	it("does NOT create a default shell when agents are available (leave slot empty)", () => {
		// Agent providers detected: the worktree should open with an empty slot the
		// user fills with an agent (or the start-a-shell CTA), not a redundant shell.
		const createDefaultShell = vi.fn(() => Promise.resolve());
		renderHook(() =>
			useDefaultShellOnEmptyWorktree({
				...base,
				agentsAvailable: true,
				createDefaultShell,
			}),
		);
		expect(createDefaultShell).not.toHaveBeenCalled();
	});

	it("defers (no shell yet) while agent detection is still pending (null)", () => {
		// Guards the race: agent CLI probes load async, so until detection resolves
		// we must not create a default shell we might have skipped.
		const createDefaultShell = vi.fn(() => Promise.resolve());
		renderHook(() =>
			useDefaultShellOnEmptyWorktree({
				...base,
				agentsAvailable: null,
				createDefaultShell,
			}),
		);
		expect(createDefaultShell).not.toHaveBeenCalled();
	});

	it("does not create a default shell when the worktree already has processes", () => {
		const createDefaultShell = vi.fn(() => Promise.resolve());
		renderHook(() =>
			useDefaultShellOnEmptyWorktree({
				...base,
				activeSessionProcessCount: 2,
				createDefaultShell,
			}),
		);
		expect(createDefaultShell).not.toHaveBeenCalled();
	});

	it("does not create a default shell before startup is ready", () => {
		const createDefaultShell = vi.fn(() => Promise.resolve());
		renderHook(() =>
			useDefaultShellOnEmptyWorktree({
				...base,
				startupMode: "loading",
				createDefaultShell,
			}),
		);
		expect(createDefaultShell).not.toHaveBeenCalled();
	});
});
