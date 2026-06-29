// tests/unit/review/review-rail-overview.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewRailOverview } from "../../../src/features/review/components/ReviewRailOverview";
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
});
