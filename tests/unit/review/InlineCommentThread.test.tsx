import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineCommentThread } from "../../../src/features/review/components/InlineCommentThread";
import type { ReviewComment } from "../../../shared/models/review-comment";

const c: ReviewComment = {
	id: "1",
	worktreeId: "w1",
	filePath: "a.ts",
	startLine: 3,
	endLine: 4,
	snippet: "x",
	body: "body text",
	status: "open",
	source: "working-tree",
	commitSha: null,
	createdAt: "2026-05-14T00:00:00.000Z",
	addressedAt: null,
};

function noop() {}

describe("InlineCommentThread", () => {
	it("renders open state with body and actions", () => {
		render(
			<InlineCommentThread
				comment={c}
				onToggleAddressed={noop}
				onDelete={noop}
				onSave={noop}
				onMeasureChange={noop}
			/>,
		);
		expect(screen.getByText("body text")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /address/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
	});

	it("Edit → save calls onSave with new body", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn();
		render(
			<InlineCommentThread
				comment={c}
				onToggleAddressed={noop}
				onDelete={noop}
				onSave={onSave}
				onMeasureChange={noop}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /edit/i }));
		const input = screen.getByRole("textbox");
		await user.clear(input);
		await user.type(input, "updated body");
		await user.click(screen.getByRole("button", { name: /save/i }));
		expect(onSave).toHaveBeenCalledWith("updated body");
	});

	it("addressed state shows the thin strip; clicking expands", async () => {
		const user = userEvent.setup();
		render(
			<InlineCommentThread
				comment={{ ...c, status: "addressed", addressedAt: c.createdAt }}
				onToggleAddressed={noop}
				onDelete={noop}
				onSave={noop}
				onMeasureChange={noop}
			/>,
		);
		const strip = screen.getByRole("button", { name: /expand addressed comment/i });
		expect(strip).toBeInTheDocument();
		await user.click(strip);
		expect(screen.getByText("body text")).toBeVisible();
	});

	it("calls onMeasureChange on render and after state changes", async () => {
		const user = userEvent.setup();
		const onMeasureChange = vi.fn();
		render(
			<InlineCommentThread
				comment={c}
				onToggleAddressed={noop}
				onDelete={noop}
				onSave={noop}
				onMeasureChange={onMeasureChange}
			/>,
		);
		expect(onMeasureChange).toHaveBeenCalled();
		onMeasureChange.mockClear();
		await user.click(screen.getByRole("button", { name: /edit/i }));
		expect(onMeasureChange).toHaveBeenCalled();
	});
});
