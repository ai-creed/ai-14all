import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type FakeInnerEditor = {
	getContentHeight: ReturnType<typeof vi.fn>;
	onDidContentSizeChange: ReturnType<typeof vi.fn>;
};

type FakeDiffEditor = {
	getModifiedEditor: ReturnType<typeof vi.fn>;
	getOriginalEditor: ReturnType<typeof vi.fn>;
	setModel: ReturnType<typeof vi.fn>;
};

const mountedEditors: FakeDiffEditor[] = [];

// Monaco DiffEditor won't load in jsdom — mock it. Real @monaco-editor/react
// fires onMount only once per editor instance, NOT on every render. The mock
// uses useRef so onMount fires once and the same fake editor sticks across
// re-renders — required to surface bugs that depend on stable editor identity.
vi.mock("@monaco-editor/react", async () => {
	const { useRef } = await import("react");
	return {
		DiffEditor: (props: {
			theme?: string;
			height?: string;
			options?: { fontSize?: number };
			onMount?: (editor: FakeDiffEditor) => void;
		}) => {
			const ref = useRef<FakeDiffEditor | null>(null);
			if (!ref.current) {
				const makeInner = (): FakeInnerEditor => ({
					getContentHeight: vi.fn(() => 0),
					onDidContentSizeChange: vi.fn(() => ({ dispose: vi.fn() })),
				});
				const modifiedInner = makeInner();
				const originalInner = makeInner();
				const fakeEditor: FakeDiffEditor = {
					getModifiedEditor: vi.fn(() => modifiedInner),
					getOriginalEditor: vi.fn(() => originalInner),
					setModel: vi.fn(),
				};
				ref.current = fakeEditor;
				mountedEditors.push(fakeEditor);
				props.onMount?.(fakeEditor);
			}
			return (
				<div
					data-testid="mock-diff-editor"
					data-theme={props.theme}
					data-height={props.height}
					data-font-size={String(props.options?.fontSize ?? "")}
				/>
			);
		},
	};
});

// Mock the desktop client's per-file diff fetch — CommitDiffStack now lazy-
// loads each section's content on expand instead of receiving it in the
// initial detail payload.
vi.mock("../../../src/lib/desktop-client", () => ({
	git: {
		readCommitFileDiff: vi.fn(),
	},
}));

import { CommitDiffStack } from "../../../src/features/git/components/CommitDiffStack";
import { git } from "../../../src/lib/desktop-client";

const mockReadCommitFileDiff = vi.mocked(git.readCommitFileDiff);

const detail = {
	sha: "abc",
	shortSha: "abc",
	subject: "feature commit",
	files: [{ path: "src/index.ts", oldPath: null, status: "M" as const }],
};

const multiFileDetail = {
	...detail,
	files: [
		...detail.files,
		{ path: "src/shell.css", oldPath: null, status: "M" as const },
	],
};

function diffFor(path: string) {
	const map: Record<string, { original: string; modified: string }> = {
		"src/index.ts": {
			original: 'export const hello = "world";\n',
			modified: 'export const hello = "phase-2";\n',
		},
		"src/shell.css": {
			original: ".shell {}\n",
			modified: ".shell { color: red; }\n",
		},
	};
	const { original, modified } = map[path] ?? { original: "", modified: "" };
	return {
		path,
		oldPath: null,
		status: "M" as const,
		originalContent: original,
		modifiedContent: modified,
	};
}

beforeEach(() => {
	mockReadCommitFileDiff.mockReset();
	mockReadCommitFileDiff.mockImplementation(
		async (_ws: string, _wt: string, _sha: string, file: { path: string }) =>
			diffFor(file.path),
	);
});

describe("CommitDiffStack", () => {
	it("renders a section for each file and auto-expands the focused one", async () => {
		render(
			<CommitDiffStack
				workspaceId="ws"
				worktreeId="wt"
				detail={detail}
				focusedPath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);

		expect(screen.getByText("src/index.ts")).toBeInTheDocument();
		expect(
			screen.getByTestId("commit-diff-section-src/index.ts"),
		).toHaveAttribute("data-focused", "true");
		const editor = await screen.findByTestId("mock-diff-editor");
		expect(editor).toHaveAttribute("data-theme", "vs-dark");
		expect(editor).toHaveAttribute("data-height", "100%");
		expect(editor).toHaveAttribute("data-font-size", "12");
	});

	it("re-expands a collapsed section when focusedPath targets it", async () => {
		const { rerender } = render(
			<CommitDiffStack
				workspaceId="ws"
				worktreeId="wt"
				detail={detail}
				focusedPath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);

		await screen.findByTestId("mock-diff-editor");

		// Collapse the section
		await userEvent.click(screen.getByText("src/index.ts"));
		expect(screen.queryByTestId("mock-diff-editor")).not.toBeInTheDocument();

		rerender(
			<CommitDiffStack
				workspaceId="ws"
				worktreeId="wt"
				detail={detail}
				focusedPath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);
		// focusedPath alone won't re-expand if it didn't change; bump it via null
		// then back — emulating a deselect + reselect.
		rerender(
			<CommitDiffStack
				workspaceId="ws"
				worktreeId="wt"
				detail={detail}
				focusedPath={null}
				resolvedTheme="dark"
			/>,
		);
		rerender(
			<CommitDiffStack
				workspaceId="ws"
				worktreeId="wt"
				detail={detail}
				focusedPath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);
		expect(await screen.findByTestId("mock-diff-editor")).toBeInTheDocument();
	});

	it("scrolls the focused file section into view", async () => {
		const scrollIntoView = vi.fn();
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoView,
		});

		const { rerender } = render(
			<CommitDiffStack
				workspaceId="ws"
				worktreeId="wt"
				detail={multiFileDetail}
				focusedPath={null}
				resolvedTheme="dark"
			/>,
		);

		rerender(
			<CommitDiffStack
				workspaceId="ws"
				worktreeId="wt"
				detail={multiFileDetail}
				focusedPath="src/shell.css"
				resolvedTheme="dark"
			/>,
		);

		await waitFor(() => {
			expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
		});
	});

	it("starts every section collapsed in the multi-file case (no eager editors)", () => {
		render(
			<CommitDiffStack
				workspaceId="ws"
				worktreeId="wt"
				detail={multiFileDetail}
				focusedPath={null}
				resolvedTheme="dark"
			/>,
		);

		// Both sections present, but no DiffEditor mounted until the user expands.
		expect(screen.getByText("src/index.ts")).toBeInTheDocument();
		expect(screen.getByText("src/shell.css")).toBeInTheDocument();
		expect(screen.queryAllByTestId("mock-diff-editor")).toHaveLength(0);
	});

	it("does not detach the diff model when the parent re-renders with a new onEditorUnmount ref", async () => {
		mountedEditors.length = 0;
		const { rerender } = render(
			<CommitDiffStack
				workspaceId="ws"
				worktreeId="wt"
				detail={detail}
				focusedPath="src/index.ts"
				resolvedTheme="dark"
				onEditorUnmount={() => {}}
			/>,
		);
		await screen.findByTestId("mock-diff-editor");
		expect(mountedEditors).toHaveLength(1);
		const editor = mountedEditors[0]!;
		editor.setModel.mockClear();

		rerender(
			<CommitDiffStack
				workspaceId="ws"
				worktreeId="wt"
				detail={detail}
				focusedPath="src/index.ts"
				resolvedTheme="dark"
				onEditorUnmount={() => {}}
			/>,
		);

		expect(editor.setModel).not.toHaveBeenCalled();
	});

	it("detaches the diff model on unmount before unregister to avoid Monaco lifecycle error", async () => {
		mountedEditors.length = 0;
		const onUnmount = vi.fn();
		render(
			<CommitDiffStack
				workspaceId="ws"
				worktreeId="wt"
				detail={detail}
				focusedPath="src/index.ts"
				resolvedTheme="dark"
				onEditorUnmount={onUnmount}
			/>,
		);
		await screen.findByTestId("mock-diff-editor");
		expect(mountedEditors).toHaveLength(1);
		const editor = mountedEditors[0]!;

		// Collapse the section — unmounts the DiffEditorSlot
		await userEvent.click(screen.getByText("src/index.ts"));

		expect(editor.setModel).toHaveBeenCalledWith(null);
		expect(onUnmount).toHaveBeenCalledWith("src/index.ts");
		const setModelOrder = editor.setModel.mock.invocationCallOrder[0]!;
		const unmountOrder = onUnmount.mock.invocationCallOrder[0]!;
		expect(setModelOrder).toBeLessThanOrEqual(unmountOrder);
	});

	it("calls onEditorMount only for sections the user has expanded", async () => {
		const onMount = vi.fn();
		render(
			<CommitDiffStack
				workspaceId="ws"
				worktreeId="wt"
				detail={multiFileDetail}
				focusedPath="src/index.ts"
				resolvedTheme="light"
				onEditorMount={onMount}
				onRequestFocus={() => {}}
			/>,
		);
		// Only the focused section auto-expands; the other stays collapsed.
		await waitFor(() => expect(onMount).toHaveBeenCalledTimes(1));
		expect(onMount).toHaveBeenCalledWith("src/index.ts", expect.anything());
	});
});
