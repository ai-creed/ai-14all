import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommitDiffStack } from "../../../src/features/git/CommitDiffStack";

// Monaco DiffEditor won't load in jsdom — mock it
vi.mock("@monaco-editor/react", () => ({
	DiffEditor: () => <div data-testid="mock-diff-editor" />,
}));

describe("CommitDiffStack", () => {
	it("renders collapsible side-by-side sections for each file", async () => {
		render(
			<CommitDiffStack
				detail={{
					sha: "abc",
					shortSha: "abc",
					subject: "feature commit",
					files: [
						{
							path: "src/index.ts",
							oldPath: null,
							status: "M",
							originalContent: 'export const hello = "world";\n',
							modifiedContent: 'export const hello = "phase-2";\n',
						},
					],
				}}
				focusedPath="src/index.ts"
			/>,
		);

		expect(screen.getByText("src/index.ts")).toBeInTheDocument();
		expect(screen.getByTestId("commit-diff-section-src/index.ts")).toHaveAttribute(
			"data-focused",
			"true",
		);
	});
});
