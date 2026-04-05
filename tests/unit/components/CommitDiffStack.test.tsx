import { describe, it, expect, vi } from "vitest";
import { render, screen, rerender } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitDiffStack } from "../../../src/features/git/CommitDiffStack";

// Monaco DiffEditor won't load in jsdom — mock it
vi.mock("@monaco-editor/react", () => ({
	DiffEditor: () => <div data-testid="mock-diff-editor" />,
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

describe("CommitDiffStack", () => {
	it("renders collapsible side-by-side sections for each file", () => {
		render(<CommitDiffStack detail={detail} focusedPath="src/index.ts" />);

		expect(screen.getByText("src/index.ts")).toBeInTheDocument();
		expect(screen.getByTestId("commit-diff-section-src/index.ts")).toHaveAttribute(
			"data-focused",
			"true",
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
});
