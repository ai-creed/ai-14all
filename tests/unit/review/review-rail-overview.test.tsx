// tests/unit/review/review-rail-overview.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewRailOverview, MAX_OVERVIEW_ROWS } from "../../../src/features/review/components/ReviewRailOverview";
import type { ReviewComment } from "../../../shared/models/review-comment";

const c = (over: Partial<ReviewComment>): ReviewComment => ({
	id: "1", worktreeId: "wt1", filePath: "a.ts", startLine: 4, endLine: 4,
	snippet: "", body: "needs a guard", status: "open", source: "working-tree",
	commitSha: null, createdAt: "2026-06-28T00:00:00.000Z", addressedAt: null, ...over,
});

const base = {
	hideAddressed: false, expanded: true,
	onToggleExpanded: () => {}, onJump: () => {}, onToggleAddressed: () => {},
	onDelete: () => {}, onClearAddressed: () => {}, onToggleHideAddressed: () => {},
};

describe("ReviewRailOverview", () => {
	it("when expanded, lists comments grouped by file", () => {
		render(<ReviewRailOverview {...base} comments={[c({ id: "1" }), c({ id: "2", filePath: "b.ts", body: "rename" })]} />);
		expect(screen.getByTestId("review-overview")).toBeInTheDocument();
		expect(screen.getByText("needs a guard")).toBeInTheDocument();
		expect(screen.getByText("rename")).toBeInTheDocument();
		expect(screen.getByText("a.ts")).toBeInTheDocument();
		expect(screen.getByText("b.ts")).toBeInTheDocument();
	});

	it("when collapsed, hides the list but shows the toggle", () => {
		render(<ReviewRailOverview {...base} expanded={false} comments={[c({})]} />);
		expect(screen.queryByText("needs a guard")).toBeNull();
		expect(screen.getByTestId("review-overview-toggle")).toBeInTheDocument();
	});

	it("clicking a comment row calls onJump", async () => {
		const onJump = vi.fn();
		const user = userEvent.setup();
		render(<ReviewRailOverview {...base} onJump={onJump} comments={[c({ id: "1" })]} />);
		await user.click(screen.getByText("needs a guard"));
		expect(onJump).toHaveBeenCalledTimes(1);
	});

	it("clear-addressed is disabled when nothing is addressed", () => {
		render(<ReviewRailOverview {...base} comments={[c({ status: "open" })]} />);
		expect(screen.getByRole("button", { name: /clear addressed/i })).toBeDisabled();
	});

	it("shows 'No open comments.' when comments is empty and expanded", () => {
		render(<ReviewRailOverview {...base} comments={[]} expanded={true} />);
		expect(screen.getByText("No open comments.")).toBeInTheDocument();
	});

	describe("bounded rows (large data)", () => {
		// Build MAX_OVERVIEW_ROWS + 10 comments, each on a distinct file so grouping
		// is 1 comment per group — makes row counting straightforward.
		const manyComments = Array.from({ length: MAX_OVERVIEW_ROWS + 10 }, (_, i) =>
			c({ id: `c${i}`, filePath: `file${i}.ts`, body: `comment ${i}` }),
		);

		it("renders only MAX_OVERVIEW_ROWS rows initially when over the cap", () => {
			render(<ReviewRailOverview {...base} comments={manyComments} />);
			// Each comment body is unique; count rendered jump buttons via role
			const rows = screen.getAllByRole("button", { name: /L\d/ });
			expect(rows.length).toBe(MAX_OVERVIEW_ROWS);
		});

		it("shows a 'Show all' control when over the cap", () => {
			render(<ReviewRailOverview {...base} comments={manyComments} />);
			expect(screen.getByTestId("review-overview-show-all")).toBeInTheDocument();
			expect(screen.getByTestId("review-overview-show-all")).toHaveTextContent(
				`Show all (${MAX_OVERVIEW_ROWS + 10})`,
			);
		});

		it("clicking 'Show all' reveals all rows", async () => {
			const user = userEvent.setup();
			render(<ReviewRailOverview {...base} comments={manyComments} />);
			await user.click(screen.getByTestId("review-overview-show-all"));
			const rows = screen.getAllByRole("button", { name: /L\d/ });
			expect(rows.length).toBe(MAX_OVERVIEW_ROWS + 10);
			expect(screen.queryByTestId("review-overview-show-all")).toBeNull();
		});

		it("does not show 'Show all' when comment count is at or below the cap", () => {
			const exactCap = Array.from({ length: MAX_OVERVIEW_ROWS }, (_, i) =>
				c({ id: `c${i}`, filePath: `file${i}.ts`, body: `comment ${i}` }),
			);
			render(<ReviewRailOverview {...base} comments={exactCap} />);
			expect(screen.queryByTestId("review-overview-show-all")).toBeNull();
		});
	});
});
