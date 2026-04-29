import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewCommentCard } from "../../../src/features/review/components/ReviewCommentCard";
import type { ReviewComment } from "../../../shared/models/review-comment";

const base: ReviewComment = {
	id: "c1",
	worktreeId: "/repo",
	filePath: "src/foo.ts",
	startLine: 42,
	endLine: 48,
	snippet: "",
	body: "rename x to width",
	status: "open",
	source: "working-tree",
	commitSha: null,
	createdAt: "2026-04-26T00:00:00.000Z",
	addressedAt: null,
};

describe("ReviewCommentCard", () => {
	it("renders line range, body, and open status", () => {
		render(
			<ReviewCommentCard
				comment={base}
				onScrollTo={() => {}}
				onToggleAddressed={() => {}}
				onDelete={() => {}}
			/>,
		);
		expect(screen.getByText(/L42–48/)).toBeInTheDocument();
		expect(screen.getByText(/rename x to width/)).toBeInTheDocument();
		expect(screen.getByText(/open/i)).toBeInTheDocument();
	});

	it("renders dimmed when addressed", () => {
		const c: ReviewComment = {
			...base,
			status: "addressed",
			addressedAt: "2026-04-26T01:00:00.000Z",
		};
		const { container } = render(
			<ReviewCommentCard
				comment={c}
				onScrollTo={() => {}}
				onToggleAddressed={() => {}}
				onDelete={() => {}}
			/>,
		);
		expect(container.firstChild).toHaveAttribute("data-status", "addressed");
	});

	it("fires onScrollTo with the line range when label clicked", () => {
		const handler = vi.fn();
		render(
			<ReviewCommentCard
				comment={base}
				onScrollTo={handler}
				onToggleAddressed={() => {}}
				onDelete={() => {}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /L42–48/ }));
		expect(handler).toHaveBeenCalledWith({ startLine: 42, endLine: 48 });
	});

	it("fires onToggleAddressed when ✓ clicked", () => {
		const handler = vi.fn();
		render(
			<ReviewCommentCard
				comment={base}
				onScrollTo={() => {}}
				onToggleAddressed={handler}
				onDelete={() => {}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /mark addressed/i }));
		expect(handler).toHaveBeenCalledWith("c1");
	});
});
