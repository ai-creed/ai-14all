import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitDiffStack } from "../../../src/features/git/CommitDiffStack";

// Monaco DiffEditor won't load in jsdom — mock it
vi.mock("@monaco-editor/react", () => ({
	DiffEditor: (props: { theme?: string; height?: string; options?: { fontSize?: number } }) => (
		<div
			data-testid="mock-diff-editor"
			data-theme={props.theme}
			data-height={props.height}
			data-font-size={String(props.options?.fontSize ?? "")}
		/>
	),
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

describe("CommitDiffStack", () => {
	it("renders collapsible side-by-side sections for each file", () => {
		render(<CommitDiffStack detail={detail} focusedPath="src/index.ts" />);

		expect(screen.getByText("src/index.ts")).toBeInTheDocument();
		expect(screen.getByTestId("commit-diff-section-src/index.ts")).toHaveAttribute(
			"data-focused",
			"true",
		);
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
			<CommitDiffStack detail={detail} focusedPath={null} />,
		);

		// Collapse the section
		await userEvent.click(screen.getByText("src/index.ts"));
		expect(screen.queryByTestId("mock-diff-editor")).not.toBeInTheDocument();

		// Selecting the file via focusedPath should re-expand it
		rerender(<CommitDiffStack detail={detail} focusedPath="src/index.ts" />);
		expect(screen.getByTestId("mock-diff-editor")).toBeInTheDocument();
	});

	it("scrolls the focused file section into view", async () => {
		const scrollIntoView = vi.fn();
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoView,
		});

		const { rerender } = render(
			<CommitDiffStack detail={multiFileDetail} focusedPath={null} />,
		);

		rerender(
			<CommitDiffStack
				detail={multiFileDetail}
				focusedPath="src/shell.css"
			/>,
		);

		await waitFor(() => {
			expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
		});
	});

	it("autosizes editors when rendering multiple commit files", () => {
		render(<CommitDiffStack detail={multiFileDetail} focusedPath={null} />);

		expect(screen.getAllByTestId("mock-diff-editor")).toHaveLength(2);
		for (const editor of screen.getAllByTestId("mock-diff-editor")) {
			expect(editor).toHaveAttribute("data-height", "160px");
		}
	});
});
