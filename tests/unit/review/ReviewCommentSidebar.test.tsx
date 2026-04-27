import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewCommentSidebar } from "../../../src/features/review/ReviewCommentSidebar";
import type { ReviewComment } from "../../../shared/models/review-comment";

const c = (over: Partial<ReviewComment> = {}): ReviewComment => ({
	id: "c1",
	worktreeId: "/repo",
	filePath: "src/foo.ts",
	startLine: 1,
	endLine: 1,
	snippet: "",
	body: "x",
	status: "open",
	source: "working-tree",
	commitSha: null,
	createdAt: "2026-04-26T00:00:00.000Z",
	addressedAt: null,
	...over,
});

describe("ReviewCommentSidebar", () => {
	it("renders empty state when no comments", () => {
		render(
			<ReviewCommentSidebar
				filePath="src/foo.ts"
				comments={[]}
				addingForFile={null}
				onScrollTo={() => {}}
				onToggleAddressed={() => {}}
				onDelete={() => {}}
				onSubmitNew={() => {}}
				onCancelNew={() => {}}
			/>,
		);
		expect(screen.getByText(/no review comments/i)).toBeInTheDocument();
	});

	it("filters comments to filePath only", () => {
		render(
			<ReviewCommentSidebar
				filePath="src/foo.ts"
				comments={[
					c({ id: "a", filePath: "src/foo.ts", body: "AA" }),
					c({ id: "b", filePath: "src/bar.ts", body: "BB" }),
				]}
				addingForFile={null}
				onScrollTo={() => {}}
				onToggleAddressed={() => {}}
				onDelete={() => {}}
				onSubmitNew={() => {}}
				onCancelNew={() => {}}
			/>,
		);
		expect(screen.getByText("AA")).toBeInTheDocument();
		expect(screen.queryByText("BB")).toBeNull();
	});

	it("shows form when addingForFile === filePath", () => {
		render(
			<ReviewCommentSidebar
				filePath="src/foo.ts"
				comments={[]}
				addingForFile={{
					filePath: "src/foo.ts",
					startLine: 1,
					endLine: 1,
					snippet: "",
				}}
				onScrollTo={() => {}}
				onToggleAddressed={() => {}}
				onDelete={() => {}}
				onSubmitNew={() => {}}
				onCancelNew={() => {}}
			/>,
		);
		expect(
			screen.getByPlaceholderText(/what should the agent/i),
		).toBeInTheDocument();
	});
});
