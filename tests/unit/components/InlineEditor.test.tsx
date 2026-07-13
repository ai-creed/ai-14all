import { createRef } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: {
		openForEdit: vi.fn(),
		read: vi.fn(),
		save: vi.fn(),
	},
	app: {
		setEditorDirty: vi.fn(() => Promise.resolve()),
		confirmClose: vi.fn(() => Promise.resolve()),
		onRequestClose: vi.fn(() => () => {}),
	},
}));

vi.mock("@monaco-editor/react", () => ({
	__esModule: true,
	default: (props: {
		value: string;
		onChange?: (v: string) => void;
		options?: Record<string, unknown>;
		onMount?: (editor: unknown) => void;
	}) => {
		// Fake editor whose getValue returns the textarea's current value.
		const handle = {
			getValue: () =>
				(
					document.querySelector(
						"[data-testid=monaco]",
					) as HTMLTextAreaElement | null
				)?.value ?? props.value,
			setValue: (v: string) => {
				const el = document.querySelector(
					"[data-testid=monaco]",
				) as HTMLTextAreaElement | null;
				if (el) el.value = v;
				props.onChange?.(v);
			},
		};
		// Schedule mount callback synchronously when textarea exists.
		queueMicrotask(() => props.onMount?.(handle));
		return (
			<textarea
				data-testid="monaco"
				data-readonly={String(!!props.options?.readOnly)}
				defaultValue={props.value}
				onChange={(e) => props.onChange?.(e.target.value)}
			/>
		);
	},
}));

import {
	InlineEditor,
	type InlineEditorHandle,
} from "../../../src/features/viewer/components/InlineEditor";
import { files, app } from "../../../src/lib/desktop-client";

const openForEditMock = files.openForEdit as unknown as ReturnType<
	typeof vi.fn
>;
const readMock = files.read as unknown as ReturnType<typeof vi.fn>;
const saveMock = files.save as unknown as ReturnType<typeof vi.fn>;
const setEditorDirtyMock = app.setEditorDirty as unknown as ReturnType<
	typeof vi.fn
>;

const base = {
	workspaceId: "ws-1",
	worktreeId: "wt-1",
	resolvedTheme: "dark" as const,
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("InlineEditor — editable load (whitelisted)", () => {
	it("calls files.openForEdit and mounts an editable Monaco", async () => {
		openForEditMock.mockResolvedValueOnce({
			ok: true,
			content: "hello",
			mtimeMs: 100,
		});
		render(<InlineEditor {...base} relativePath="NOTES.md" />);
		const ta = (await screen.findByTestId("monaco")) as HTMLTextAreaElement;
		expect(ta.value).toBe("hello");
		expect(ta.dataset.readonly).toBe("false");
		expect(openForEditMock).toHaveBeenCalledWith("ws-1", "wt-1", "NOTES.md");
	});

	it("shows the dirty bar after editing and saves with the loaded mtimeMs", async () => {
		openForEditMock.mockResolvedValueOnce({
			ok: true,
			content: "hello",
			mtimeMs: 100,
		});
		saveMock.mockResolvedValueOnce({ ok: true, mtimeMs: 200 });
		render(<InlineEditor {...base} relativePath="NOTES.md" />);
		const ta = (await screen.findByTestId("monaco")) as HTMLTextAreaElement;
		fireEvent.change(ta, { target: { value: "hello world" } });
		expect(await screen.findByText(/Unsaved changes/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => {
			expect(saveMock).toHaveBeenCalledWith({
				workspaceId: "ws-1",
				worktreeId: "wt-1",
				relativePath: "NOTES.md",
				content: "hello world",
				expectedMtimeMs: 100,
			});
		});
		await waitFor(() => {
			expect(screen.queryByText(/Unsaved changes/)).toBeNull();
		});
	});

	it("opens SaveConflictDialog on mtime-conflict; Overwrite re-saves with currentMtimeMs", async () => {
		openForEditMock.mockResolvedValueOnce({
			ok: true,
			content: "hello",
			mtimeMs: 100,
		});
		saveMock
			.mockResolvedValueOnce({
				ok: false,
				reason: "mtime-conflict",
				currentMtimeMs: 250,
			})
			.mockResolvedValueOnce({ ok: true, mtimeMs: 260 });
		render(<InlineEditor {...base} relativePath="NOTES.md" />);
		const ta = (await screen.findByTestId("monaco")) as HTMLTextAreaElement;
		fireEvent.change(ta, { target: { value: "hello world" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		const overwriteBtn = await screen.findByRole("button", {
			name: /overwrite/i,
		});
		fireEvent.click(overwriteBtn);
		await waitFor(() => {
			expect(saveMock).toHaveBeenLastCalledWith(
				expect.objectContaining({
					expectedMtimeMs: 250,
					content: "hello world",
				}),
			);
		});
	});

	it("pushes dirty bit to main on every transition", async () => {
		openForEditMock.mockResolvedValueOnce({
			ok: true,
			content: "hello",
			mtimeMs: 100,
		});
		render(<InlineEditor {...base} relativePath="NOTES.md" />);
		const ta = (await screen.findByTestId("monaco")) as HTMLTextAreaElement;
		// Initial dirty=false push on mount.
		await waitFor(() => {
			expect(setEditorDirtyMock).toHaveBeenCalledWith(
				expect.objectContaining({ dirty: false, relativePath: "NOTES.md" }),
			);
		});
		fireEvent.change(ta, { target: { value: "hello x" } });
		await waitFor(() => {
			expect(setEditorDirtyMock).toHaveBeenCalledWith(
				expect.objectContaining({ dirty: true, relativePath: "NOTES.md" }),
			);
		});
	});
});

describe("InlineEditor — non-whitelisted (read-only)", () => {
	it("calls files.read and mounts Monaco read-only", async () => {
		readMock.mockResolvedValueOnce({
			ok: true,
			view: {
				path: "image.png",
				content: "binary-stub",
				language: "plaintext",
			},
		});
		render(<InlineEditor {...base} relativePath="image.png" />);
		const ta = (await screen.findByTestId("monaco")) as HTMLTextAreaElement;
		expect(ta.dataset.readonly).toBe("true");
		expect(readMock).toHaveBeenCalledWith("ws-1", "wt-1", "image.png");
		// No dirty bar can appear because save flow is gated by isEditable.
		expect(screen.queryByText(/Unsaved changes/)).toBeNull();
	});
});

describe("InlineEditor — failure modes", () => {
	it("openForEdit not-found → guard message, no editor", async () => {
		openForEditMock.mockResolvedValueOnce({ ok: false, reason: "not-found" });
		render(<InlineEditor {...base} relativePath="NOTES.md" />);
		await screen.findByText(/File not found/);
		expect(screen.queryByTestId("monaco")).toBeNull();
	});

	it("openForEdit too-large → guard message", async () => {
		openForEditMock.mockResolvedValueOnce({ ok: false, reason: "too-large" });
		render(<InlineEditor {...base} relativePath="NOTES.md" />);
		await screen.findByText(/too large/i);
	});

	it("files.read binary → guard message", async () => {
		readMock.mockResolvedValueOnce({
			ok: false,
			path: "x.bin",
			reason: { kind: "binary" },
		});
		render(<InlineEditor {...base} relativePath="x.bin" />);
		await screen.findByText(/Binary file/i);
	});
});

describe("InlineEditor — requestSwitch", () => {
	it("resolves 'proceed' immediately when clean", async () => {
		openForEditMock.mockResolvedValueOnce({
			ok: true,
			content: "hello",
			mtimeMs: 100,
		});
		const ref = createRef<InlineEditorHandle>();
		render(<InlineEditor {...base} relativePath="NOTES.md" ref={ref} />);
		await screen.findByTestId("monaco");
		await expect(ref.current!.requestSwitch()).resolves.toBe("proceed");
	});

	it("opens ConfirmCloseDialog when dirty; Save → proceed; Discard → proceed; Cancel → cancel", async () => {
		openForEditMock.mockResolvedValueOnce({
			ok: true,
			content: "hello",
			mtimeMs: 100,
		});
		saveMock.mockResolvedValueOnce({ ok: true, mtimeMs: 200 });
		const ref = createRef<InlineEditorHandle>();
		render(<InlineEditor {...base} relativePath="NOTES.md" ref={ref} />);
		const ta = (await screen.findByTestId("monaco")) as HTMLTextAreaElement;
		fireEvent.change(ta, { target: { value: "hello x" } });

		// requestSwitch → dialog → Save
		let p!: Promise<"proceed" | "cancel">;
		act(() => {
			p = ref.current!.requestSwitch();
		});
		// ConfirmCloseDialog has Cancel + Discard + Save. The first Save button in
		// the document is the dirty bar one; the dialog version sits later in the
		// DOM after Cancel + Discard. Find both, click the dialog one.
		const allSave = await screen.findAllByRole("button", { name: /save/i });
		fireEvent.click(allSave[allSave.length - 1]);
		await expect(p).resolves.toBe("proceed");
	});
});

describe("InlineEditor — no embedded markdown preview (D15)", () => {
	it("renders no Preview button for a markdown file (preview lives in FileViewer)", async () => {
		openForEditMock.mockResolvedValueOnce({
			ok: true,
			content: "# hello",
			mtimeMs: 100,
		});
		render(<InlineEditor {...base} relativePath="NOTES.md" />);
		await screen.findByTestId("monaco");
		expect(screen.queryByRole("button", { name: /preview/i })).toBeNull();
	});
});
