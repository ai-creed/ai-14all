import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitDiffStack } from "../../../src/features/git/components/CommitDiffStack";

type FakeDiffEditor = {
	getModifiedEditor: ReturnType<typeof vi.fn>;
	setModel: ReturnType<typeof vi.fn>;
};

const mountedEditors: FakeDiffEditor[] = [];

// Monaco DiffEditor won't load in jsdom — mock it
vi.mock("@monaco-editor/react", () => ({
	DiffEditor: (props: {
		theme?: string;
		height?: string;
		options?: { fontSize?: number };
		onMount?: (editor: FakeDiffEditor) => void;
	}) => {
		const fakeEditor: FakeDiffEditor = {
			getModifiedEditor: vi.fn(),
			setModel: vi.fn(),
		};
		mountedEditors.push(fakeEditor);
		props.onMount?.(fakeEditor);
		return (
			<div
				data-testid="mock-diff-editor"
				data-theme={props.theme}
				data-height={props.height}
				data-font-size={String(props.options?.fontSize ?? "")}
			/>
		);
	},
}));

const detail = {
	sha: "abc",
	shortSha: "abc",
	subject: "feature commit",
	files: [
		{
			path: "src/index.ts",
			oldPath: null,
			status: "M" as const,
			originalContent: 'export const hello = "world";\n',
			modifiedContent: 'export const hello = "phase-2";\n',
		},
	],
};

const multiFileDetail = {
	...detail,
	files: [
		...detail.files,
		{
			path: "src/shell.css",
			oldPath: null,
			status: "M" as const,
			originalContent: ".shell {}\n",
			modifiedContent: ".shell { color: red; }\n",
		},
	],
};

function detailWithTwoFiles() {
	return multiFileDetail;
}

describe("CommitDiffStack", () => {
	it("renders collapsible side-by-side sections for each file", () => {
		render(
			<CommitDiffStack
				detail={detail}
				focusedPath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);

		expect(screen.getByText("src/index.ts")).toBeInTheDocument();
		expect(
			screen.getByTestId("commit-diff-section-src/index.ts"),
		).toHaveAttribute("data-focused", "true");
		expect(screen.getByTestId("mock-diff-editor")).toHaveAttribute(
			"data-theme",
			"vs-dark",
		);
		expect(screen.getByTestId("mock-diff-editor")).toHaveAttribute(
			"data-height",
			"100%",
		);
		expect(screen.getByTestId("mock-diff-editor")).toHaveAttribute(
			"data-font-size",
			"12",
		);
	});

	it("re-expands a collapsed section when focusedPath targets it", async () => {
		const { rerender } = render(
			<CommitDiffStack
				detail={detail}
				focusedPath={null}
				resolvedTheme="dark"
			/>,
		);

		// Collapse the section
		await userEvent.click(screen.getByText("src/index.ts"));
		expect(screen.queryByTestId("mock-diff-editor")).not.toBeInTheDocument();

		// Selecting the file via focusedPath should re-expand it
		rerender(
			<CommitDiffStack
				detail={detail}
				focusedPath="src/index.ts"
				resolvedTheme="dark"
			/>,
		);
		expect(screen.getByTestId("mock-diff-editor")).toBeInTheDocument();
	});

	it("scrolls the focused file section into view", async () => {
		const scrollIntoView = vi.fn();
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoView,
		});

		const { rerender } = render(
			<CommitDiffStack
				detail={multiFileDetail}
				focusedPath={null}
				resolvedTheme="dark"
			/>,
		);

		rerender(
			<CommitDiffStack
				detail={multiFileDetail}
				focusedPath="src/shell.css"
				resolvedTheme="dark"
			/>,
		);

		await waitFor(() => {
			expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
		});
	});

	it("autosizes editors when rendering multiple commit files", () => {
		render(
			<CommitDiffStack
				detail={multiFileDetail}
				focusedPath={null}
				resolvedTheme="dark"
			/>,
		);

		expect(screen.getAllByTestId("mock-diff-editor")).toHaveLength(2);
		for (const editor of screen.getAllByTestId("mock-diff-editor")) {
			expect(editor).toHaveAttribute("data-height", "160px");
		}
	});

	it("detaches the diff model on unmount before unregister to avoid Monaco lifecycle error", async () => {
		mountedEditors.length = 0;
		const onUnmount = vi.fn();
		render(
			<CommitDiffStack
				detail={detail}
				focusedPath={null}
				resolvedTheme="dark"
				onEditorUnmount={onUnmount}
			/>,
		);
		expect(mountedEditors).toHaveLength(1);
		const editor = mountedEditors[0];

		// Collapse the section — unmounts the DiffEditorSlot
		await userEvent.click(screen.getByText("src/index.ts"));

		expect(editor.setModel).toHaveBeenCalledWith(null);
		expect(onUnmount).toHaveBeenCalledWith("src/index.ts");
		// setModel(null) must run before/at-most-with onUnmount so Monaco can reset cleanly
		const setModelOrder = editor.setModel.mock.invocationCallOrder[0];
		const unmountOrder = onUnmount.mock.invocationCallOrder[0];
		expect(setModelOrder).toBeLessThanOrEqual(unmountOrder);
	});

	it("calls onEditorMount once per file", () => {
		const onMount = vi.fn();
		render(
			<CommitDiffStack
				detail={detailWithTwoFiles()}
				focusedPath={null}
				resolvedTheme="light"
				onEditorMount={onMount}
				onRequestFocus={() => {}}
			/>,
		);
		expect(onMount).toHaveBeenCalledTimes(2);
	});
});
