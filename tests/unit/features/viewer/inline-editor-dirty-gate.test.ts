import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	__resetInlineEditorRegistry,
	registerInlineEditor,
	runInlineEditorDirtyGate,
} from "../../../../src/features/viewer/inline-editor-registry";

beforeEach(() => {
	__resetInlineEditorRegistry();
});

afterEach(() => {
	__resetInlineEditorRegistry();
});

describe("runInlineEditorDirtyGate", () => {
	it("returns 'proceed' when no editor is registered", async () => {
		await expect(runInlineEditorDirtyGate()).resolves.toBe("proceed");
	});

	it("returns 'proceed' when the only editor clears", async () => {
		const requestSwitch = vi.fn(async () => "proceed" as const);
		registerInlineEditor(
			{ workspaceId: "ws", worktreeId: "wt", relativePath: "a.md" },
			{ requestSwitch },
		);
		await expect(runInlineEditorDirtyGate()).resolves.toBe("proceed");
		expect(requestSwitch).toHaveBeenCalledTimes(1);
	});

	it("returns 'cancel' the first time any editor cancels and short-circuits", async () => {
		const first = vi.fn(async () => "cancel" as const);
		const second = vi.fn(async () => "proceed" as const);
		registerInlineEditor(
			{ workspaceId: "ws", worktreeId: "wt", relativePath: "a.md" },
			{ requestSwitch: first },
		);
		registerInlineEditor(
			{ workspaceId: "ws", worktreeId: "wt", relativePath: "b.md" },
			{ requestSwitch: second },
		);
		await expect(runInlineEditorDirtyGate()).resolves.toBe("cancel");
		expect(first).toHaveBeenCalledTimes(1);
		// Short-circuit: second editor must not be asked once the first cancels.
		expect(second).not.toHaveBeenCalled();
	});

	it("walks every editor when each clears", async () => {
		const a = vi.fn(async () => "proceed" as const);
		const b = vi.fn(async () => "proceed" as const);
		registerInlineEditor(
			{ workspaceId: "ws", worktreeId: "wt", relativePath: "a.md" },
			{ requestSwitch: a },
		);
		registerInlineEditor(
			{ workspaceId: "ws", worktreeId: "wt", relativePath: "b.md" },
			{ requestSwitch: b },
		);
		await expect(runInlineEditorDirtyGate()).resolves.toBe("proceed");
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
	});
});
