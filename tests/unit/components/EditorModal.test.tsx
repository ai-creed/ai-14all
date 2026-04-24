import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EditorModal } from "../../../src/features/viewer/EditorModal";
import { files } from "../../../src/lib/desktop-client";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: {
		save: vi.fn(),
		openForEdit: vi.fn(),
	},
}));

const saveMock = files.save as unknown as ReturnType<typeof vi.fn>;
const openForEditMock = files.openForEdit as unknown as ReturnType<
	typeof vi.fn
>;

vi.mock("@monaco-editor/react", () => ({
	__esModule: true,
	default: (props: {
		value: string;
		onChange?: (v: string) => void;
		options?: Record<string, unknown>;
		theme?: string;
	}) => (
		<textarea
			data-testid="monaco"
			data-theme={props.theme}
			data-fontsize={String(props.options?.fontSize)}
			value={props.value}
			onChange={(e) => props.onChange?.(e.target.value)}
		/>
	),
}));

const baseProps = {
	workspaceId: "workspace:test",
	worktreeId: "wt-1",
	relativePath: "NOTES.md",
	initialContent: "hello",
	initialMtimeMs: 100,
	theme: "dark" as const,
	onClose: vi.fn(),
};

describe("EditorModal", () => {
	it("mounts with content and passes theme + fontSize to Monaco", () => {
		render(<EditorModal {...baseProps} />);
		const m = screen.getByTestId("monaco") as HTMLTextAreaElement;
		expect(m.value).toBe("hello");
		expect(m.dataset.theme).toBe("vs-dark");
		expect(m.dataset.fontsize).toBe("11");
	});

	it("closes immediately when clean and user clicks Close", async () => {
		const onClose = vi.fn();
		render(<EditorModal {...baseProps} onClose={onClose} />);
		await userEvent.click(screen.getByRole("button", { name: /close/i }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("uses vs theme when theme prop is light", () => {
		render(<EditorModal {...baseProps} theme="light" />);
		expect(screen.getByTestId("monaco").dataset.theme).toBe("vs");
	});
});

describe("EditorModal save flow", () => {
	beforeEach(() => {
		saveMock.mockReset();
		openForEditMock.mockReset();
	});

	it("disables Save when clean", () => {
		render(<EditorModal {...baseProps} />);
		expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
	});

	it("enables Save after typing", async () => {
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), " world");
		expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
	});

	it("calls files.save with expectedMtimeMs on click", async () => {
		saveMock.mockResolvedValueOnce({ ok: true, mtimeMs: 200 });
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		expect(saveMock).toHaveBeenCalledWith({
			workspaceId: "workspace:test",
			worktreeId: "wt-1",
			relativePath: "NOTES.md",
			content: "hellox",
			expectedMtimeMs: 100,
		});
	});

	it("shows Saved status and disables Save on success", async () => {
		saveMock.mockResolvedValueOnce({ ok: true, mtimeMs: 200 });
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		expect(await screen.findByText(/saved/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
	});

	it("ignores a second Save press while in-flight", async () => {
		let resolve!: (v: unknown) => void;
		saveMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		const btn = screen.getByRole("button", { name: /save/i });
		await userEvent.click(btn);
		await userEvent.click(btn);
		expect(saveMock).toHaveBeenCalledTimes(1);
		resolve({ ok: true, mtimeMs: 200 });
	});

	it("shows inline error and keeps Save enabled on write failure", async () => {
		saveMock.mockResolvedValueOnce({ ok: false, reason: "permission-denied" });
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		expect(await screen.findByText(/permission/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
	});
});

describe("EditorModal mtime conflict", () => {
	beforeEach(() => {
		saveMock.mockReset();
		openForEditMock.mockReset();
	});

	it("shows SaveConflictDialog when save returns mtime-conflict", async () => {
		saveMock.mockResolvedValueOnce({
			ok: false,
			reason: "mtime-conflict",
			currentMtimeMs: 500,
		});
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		expect(
			await screen.findByText(/file changed on disk/i),
		).toBeInTheDocument();
	});

	it("Overwrite re-saves with currentMtimeMs", async () => {
		saveMock
			.mockResolvedValueOnce({
				ok: false,
				reason: "mtime-conflict",
				currentMtimeMs: 500,
			})
			.mockResolvedValueOnce({ ok: true, mtimeMs: 600 });
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		await userEvent.click(
			await screen.findByRole("button", { name: /overwrite/i }),
		);
		expect(saveMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ expectedMtimeMs: 500 }),
		);
	});

	it("Cancel dismisses dialog and leaves buffer dirty", async () => {
		saveMock.mockResolvedValueOnce({
			ok: false,
			reason: "mtime-conflict",
			currentMtimeMs: 500,
		});
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		await userEvent.click(
			await screen.findByRole("button", { name: /cancel/i }),
		);
		expect(screen.queryByText(/file changed on disk/i)).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
	});

	it("Reload with dirty buffer shows ConfirmCloseDialog instead of reloading immediately", async () => {
		saveMock.mockResolvedValueOnce({
			ok: false,
			reason: "mtime-conflict",
			currentMtimeMs: 500,
		});
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		await userEvent.click(
			await screen.findByRole("button", { name: /reload/i }),
		);
		// Should show confirm dialog, not reload yet
		expect(await screen.findByText(/unsaved changes/i)).toBeInTheDocument();
		expect(openForEditMock).not.toHaveBeenCalled();
	});

	it("Reload Discard replaces buffer with disk content and clears dirty", async () => {
		saveMock.mockResolvedValueOnce({
			ok: false,
			reason: "mtime-conflict",
			currentMtimeMs: 500,
		});
		openForEditMock.mockResolvedValueOnce({
			ok: true,
			content: "from-disk",
			mtimeMs: 500,
		});
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		await userEvent.click(
			await screen.findByRole("button", { name: /reload/i }),
		);
		// ConfirmCloseDialog is now shown — click Discard
		await userEvent.click(
			await screen.findByRole("button", { name: /discard/i }),
		);
		expect(openForEditMock).toHaveBeenCalledWith(
			"workspace:test",
			"wt-1",
			"NOTES.md",
		);
		await waitFor(() => {
			expect((screen.getByTestId("monaco") as HTMLTextAreaElement).value).toBe(
				"from-disk",
			);
		});
		expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
	});
});

describe("EditorModal save error recovery", () => {
	beforeEach(() => {
		saveMock.mockReset();
		openForEditMock.mockReset();
	});

	it("handleSave: files.save throws → saving resets to false, error status shown", async () => {
		saveMock.mockRejectedValueOnce(new Error("IPC error"));
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		// saving must reset — button re-enabled (buffer still dirty)
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
		});
		expect(
			screen.getByText("Save failed: unexpected error"),
		).toBeInTheDocument();
	});

	it("handleOverwrite: files.save throws → saving resets to false, error status shown", async () => {
		saveMock
			.mockResolvedValueOnce({
				ok: false,
				reason: "mtime-conflict",
				currentMtimeMs: 500,
			})
			.mockRejectedValueOnce(new Error("disk error"));
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		await userEvent.click(
			await screen.findByRole("button", { name: /overwrite/i }),
		);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
		});
		expect(
			screen.getByText("Save failed: unexpected error"),
		).toBeInTheDocument();
	});
});

describe("EditorModal reload pending-reload flow", () => {
	beforeEach(() => {
		saveMock.mockReset();
		openForEditMock.mockReset();
	});

	it("Save-then-reload path: saves then reloads without calling onClose", async () => {
		saveMock
			.mockResolvedValueOnce({
				ok: false,
				reason: "mtime-conflict",
				currentMtimeMs: 500,
			})
			.mockResolvedValueOnce({ ok: true, mtimeMs: 600 });
		openForEditMock.mockResolvedValueOnce({
			ok: true,
			content: "saved-then-reloaded",
			mtimeMs: 700,
		});
		const onClose = vi.fn();
		render(<EditorModal {...baseProps} onClose={onClose} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		// Trigger mtime-conflict
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		// Click Reload to enter pending-reload state
		await userEvent.click(
			await screen.findByRole("button", { name: /reload/i }),
		);
		// ConfirmCloseDialog open — click Save
		await userEvent.click(
			await screen.findByRole("button", { name: /^save$/i }),
		);
		// Should reload, not close
		expect(onClose).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(openForEditMock).toHaveBeenCalledWith(
				"workspace:test",
				"wt-1",
				"NOTES.md",
			),
		);
	});

	it("Cancel from pending-reload ConfirmCloseDialog clears pendingReload without reload or close", async () => {
		saveMock.mockResolvedValueOnce({
			ok: false,
			reason: "mtime-conflict",
			currentMtimeMs: 500,
		});
		const onClose = vi.fn();
		render(<EditorModal {...baseProps} onClose={onClose} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		await userEvent.click(
			await screen.findByRole("button", { name: /reload/i }),
		);
		await userEvent.click(
			await screen.findByRole("button", { name: /cancel/i }),
		);
		expect(onClose).not.toHaveBeenCalled();
		expect(openForEditMock).not.toHaveBeenCalled();
		expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
	});
});

describe("EditorModal shortcuts and confirm-close", () => {
	beforeEach(() => {
		saveMock.mockReset();
		openForEditMock.mockReset();
	});

	function findEditorDialog(): HTMLElement {
		// The first role="dialog" in DOM is the editor modal
		return screen.getAllByRole("dialog")[0];
	}

	function fireKey(
		target: HTMLElement,
		key: string,
		meta = true,
	): KeyboardEvent {
		const ev = new KeyboardEvent("keydown", {
			key,
			metaKey: meta,
			cancelable: true,
			bubbles: true,
		});
		target.dispatchEvent(ev);
		return ev;
	}

	it("Cmd+S when clean is a no-op but still prevents default", async () => {
		render(<EditorModal {...baseProps} />);
		const ev = fireKey(findEditorDialog(), "s");
		expect(saveMock).not.toHaveBeenCalled();
		expect(ev.defaultPrevented).toBe(true);
	});

	it("Cmd+S when dirty calls save and prevents default", async () => {
		saveMock.mockResolvedValueOnce({ ok: true, mtimeMs: 200 });
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		const ev = fireKey(findEditorDialog(), "s");
		expect(saveMock).toHaveBeenCalledTimes(1);
		expect(ev.defaultPrevented).toBe(true);
	});

	it("Cmd+E is swallowed and prevents default", async () => {
		render(<EditorModal {...baseProps} />);
		const ev = fireKey(findEditorDialog(), "e");
		expect(ev.defaultPrevented).toBe(true);
	});

	it("Cmd+S is disabled while SaveConflictDialog is open", async () => {
		saveMock.mockResolvedValueOnce({
			ok: false,
			reason: "mtime-conflict",
			currentMtimeMs: 500,
		});
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		await screen.findByText(/file changed on disk/i);
		fireKey(findEditorDialog(), "s");
		expect(saveMock).toHaveBeenCalledTimes(1); // no additional call
	});

	it("close clean dismisses immediately", async () => {
		const onClose = vi.fn();
		render(<EditorModal {...baseProps} onClose={onClose} />);
		await userEvent.click(screen.getByRole("button", { name: /close/i }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("close dirty shows ConfirmCloseDialog", async () => {
		render(<EditorModal {...baseProps} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /close/i }));
		expect(await screen.findByText(/unsaved changes/i)).toBeInTheDocument();
	});

	it("Discard from ConfirmCloseDialog calls onClose", async () => {
		const onClose = vi.fn();
		render(<EditorModal {...baseProps} onClose={onClose} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /close/i }));
		await userEvent.click(
			await screen.findByRole("button", { name: /discard/i }),
		);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("Save from ConfirmCloseDialog saves then closes", async () => {
		saveMock.mockResolvedValueOnce({ ok: true, mtimeMs: 200 });
		const onClose = vi.fn();
		render(<EditorModal {...baseProps} onClose={onClose} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /close/i }));
		await userEvent.click(
			await screen.findByRole("button", { name: /^save$/i }),
		);
		expect(saveMock).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

describe("EditorModal onFileSaved callback", () => {
	beforeEach(() => {
		saveMock.mockReset();
		openForEditMock.mockReset();
	});

	it("calls onFileSaved after a successful save", async () => {
		saveMock.mockResolvedValueOnce({ ok: true, mtimeMs: 200 });
		const onFileSaved = vi.fn();
		render(<EditorModal {...baseProps} onFileSaved={onFileSaved} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		await screen.findByText(/saved/i);
		expect(onFileSaved).toHaveBeenCalledTimes(1);
	});

	it("does not call onFileSaved when save fails", async () => {
		saveMock.mockResolvedValueOnce({ ok: false, reason: "permission-denied" });
		const onFileSaved = vi.fn();
		render(<EditorModal {...baseProps} onFileSaved={onFileSaved} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));
		await screen.findByText(/permission denied/i);
		expect(onFileSaved).not.toHaveBeenCalled();
	});

	it("calls onFileSaved after overwrite resolves conflict", async () => {
		saveMock.mockResolvedValueOnce({
			ok: false,
			reason: "mtime-conflict",
			currentMtimeMs: 500,
		});
		const onFileSaved = vi.fn();
		render(<EditorModal {...baseProps} onFileSaved={onFileSaved} />);
		await userEvent.type(screen.getByTestId("monaco"), "x");
		await userEvent.click(screen.getByRole("button", { name: /save/i }));

		saveMock.mockResolvedValueOnce({ ok: true, mtimeMs: 600 });
		await userEvent.click(
			await screen.findByRole("button", { name: /overwrite/i }),
		);
		await screen.findByText(/saved/i);
		expect(onFileSaved).toHaveBeenCalledTimes(1);
	});
});
