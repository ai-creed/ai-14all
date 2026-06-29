import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentMinimap } from "../../../src/features/review/components/CommentMinimap";
import type { ReviewComment } from "../../../shared/models/review-comment";

const c = (over: Partial<ReviewComment>): ReviewComment => ({
	id: "1", worktreeId: "wt1", filePath: "a.ts", startLine: 10, endLine: 10,
	snippet: "", body: "abort signal", status: "open", source: "working-tree",
	commitSha: null, createdAt: "2026-06-28T00:00:00.000Z", addressedAt: null, ...over,
});

const base = { totalLines: 100, progress: { reviewed: 3, total: 8 }, onJump: () => {}, onToggleAddressed: () => {} };

describe("CommentMinimap", () => {
	it("renders one dot per non-clustered comment", () => {
		render(<CommentMinimap {...base} comments={[c({ id: "1", startLine: 10 }), c({ id: "2", startLine: 80 })]} />);
		expect(screen.getAllByTestId(/^minimap-dot-/)).toHaveLength(2);
	});

	it("renders the progress fill height from progress", () => {
		render(<CommentMinimap {...base} comments={[]} />);
		expect(screen.getByTestId("minimap-progress-fill")).toHaveStyle({ height: "37.5%" });
	});

	it("flyout shows author + snippet + body; Jump calls onJump", async () => {
		const onJump = vi.fn();
		const user = userEvent.setup();
		render(
			<CommentMinimap
				{...base}
				onJump={onJump}
				comments={[c({ id: "1", body: "abort signal", snippet: "fetch(url)" })]}
			/>,
		);
		await user.hover(screen.getByTestId("minimap-dot-1"));
		expect(screen.getByText("you")).toBeInTheDocument();
		expect(screen.getByText("fetch(url)")).toBeInTheDocument();
		expect(screen.getByText("abort signal")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /jump/i }));
		expect(onJump).toHaveBeenCalledTimes(1);
	});

	it("flyout Resolve calls onToggleAddressed", async () => {
		const onToggleAddressed = vi.fn();
		const user = userEvent.setup();
		render(
			<CommentMinimap
				{...base}
				onToggleAddressed={onToggleAddressed}
				comments={[c({ id: "1", status: "open" })]}
			/>,
		);
		await user.hover(screen.getByTestId("minimap-dot-1"));
		await user.click(screen.getByRole("button", { name: /resolve/i }));
		expect(onToggleAddressed).toHaveBeenCalledTimes(1);
	});

	it("a clustered dot's flyout lists ALL clustered comments, each with Jump/Resolve", async () => {
		const onJump = vi.fn();
		const user = userEvent.setup();
		// adjacent lines → positions within CLUSTER_THRESHOLD → one cluster of 2
		render(
			<CommentMinimap
				{...base}
				totalLines={100}
				onJump={onJump}
				comments={[
					c({ id: "1", startLine: 50, body: "first issue", snippet: "a()" }),
					c({ id: "2", startLine: 51, body: "second issue", snippet: "b()" }),
				]}
			/>,
		);
		const dots = screen.getAllByTestId(/^minimap-dot-/);
		expect(dots).toHaveLength(1); // collapsed into one cluster marker
		expect(screen.getByText("+2")).toBeInTheDocument();
		await user.hover(dots[0]!);
		// the flyout lists BOTH comments
		expect(screen.getByText("first issue")).toBeInTheDocument();
		expect(screen.getByText("second issue")).toBeInTheDocument();
		expect(screen.getByText("2 comments here")).toBeInTheDocument();
		// each clustered comment has its own Jump button
		const jumpButtons = screen.getAllByRole("button", { name: /jump/i });
		expect(jumpButtons).toHaveLength(2);
		await user.click(jumpButtons[1]!);
		expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }));
	});

	it("renders no dots when totalLines is 0 (editor not mounted)", () => {
		render(<CommentMinimap {...base} totalLines={0} comments={[c({})]} />);
		expect(screen.queryByTestId(/^minimap-dot-/)).toBeNull();
		expect(screen.getByTestId("minimap-progress-fill")).toBeInTheDocument();
	});

	it("empty-changes: fill is 0% and no dots when progress.total === 0 and comments === []", () => {
		render(<CommentMinimap {...base} progress={{ reviewed: 0, total: 0 }} comments={[]} />);
		expect(screen.getByTestId("minimap-progress-fill")).toHaveStyle({ height: "0%" });
		expect(screen.queryByTestId(/^minimap-dot-/)).toBeNull();
	});
});
