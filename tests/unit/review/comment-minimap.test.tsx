import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentMinimap } from "../../../src/features/review/components/CommentMinimap";
import type { ReviewComment } from "../../../shared/models/review-comment";

const c = (over: Partial<ReviewComment>): ReviewComment => ({
	id: "1",
	worktreeId: "wt1",
	filePath: "a.ts",
	startLine: 10,
	endLine: 10,
	snippet: "",
	body: "abort signal",
	status: "open",
	source: "working-tree",
	commitSha: null,
	createdAt: "2026-06-28T00:00:00.000Z",
	addressedAt: null,
	...over,
});

const base = {
	totalLines: 100,
	progress: { reviewed: 3, total: 8 },
	onJump: () => {},
	onToggleAddressed: () => {},
};

type MinimapProps = React.ComponentProps<typeof CommentMinimap>;

function renderMinimap(overrides: Partial<MinimapProps> = {}) {
	return render(<CommentMinimap {...base} comments={[]} {...overrides} />);
}

// Deterministic id from (start, end) so repeated calls with the same args
// (e.g. once to build fixtures, once to look up the id in an assertion)
// refer to the same comment.
const commentAt = (start: number, end: number = start): ReviewComment =>
	c({ id: `c-${start}-${end}`, startLine: start, endLine: end });

// Three comments close enough together (relative to totalLines: 100 and
// CLUSTER_THRESHOLD 0.02) to collapse into a single cluster, first at L40.
const clusterOfThree: ReviewComment[] = [
	c({ id: "cl-1", startLine: 40, endLine: 40 }),
	c({ id: "cl-2", startLine: 41, endLine: 41 }),
	c({ id: "cl-3", startLine: 42, endLine: 42 }),
];

describe("CommentMinimap", () => {
	it("renders one dot per non-clustered comment", () => {
		render(
			<CommentMinimap
				{...base}
				comments={[
					c({ id: "1", startLine: 10 }),
					c({ id: "2", startLine: 80 }),
				]}
			/>,
		);
		expect(screen.getAllByTestId(/^minimap-dot-/)).toHaveLength(2);
	});

	it("renders the progress fill height from progress", () => {
		render(<CommentMinimap {...base} comments={[]} />);
		expect(screen.getByTestId("minimap-progress-fill")).toHaveStyle({
			height: "37.5%",
		});
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
		render(
			<CommentMinimap
				{...base}
				progress={{ reviewed: 0, total: 0 }}
				comments={[]}
			/>,
		);
		expect(screen.getByTestId("minimap-progress-fill")).toHaveStyle({
			height: "0%",
		});
		expect(screen.queryByTestId(/^minimap-dot-/)).toBeNull();
	});

	it("dot click fires onJump with the head comment AND opens the flyout", () => {
		const onJump = vi.fn();
		renderMinimap({ comments: [commentAt(10)], onJump });
		fireEvent.click(screen.getByTestId(`minimap-dot-${commentAt(10).id}`));
		expect(onJump).toHaveBeenCalledWith(
			expect.objectContaining({ id: commentAt(10).id }),
		);
		expect(screen.getByRole("dialog", { hidden: false })).toBeTruthy();
	});

	it("cluster dot carries the --cluster class with the count as inner text", () => {
		renderMinimap({ comments: clusterOfThree });
		const dot = screen.getByTestId(`minimap-dot-${clusterOfThree[0]!.id}`);
		expect(dot.className).toContain("shell-review-minimap__dot--cluster");
		expect(dot.textContent).toBe("+3");
	});

	it("labels dots for screen readers", () => {
		renderMinimap({ comments: [commentAt(12, 14)] });
		expect(screen.getByLabelText("Comment L12–14 — open")).toBeTruthy();
	});

	it("labels clusters with count and first line; count span is aria-hidden", () => {
		renderMinimap({ comments: clusterOfThree }); // first starts at L40
		expect(screen.getByLabelText("3 comments from L40")).toBeTruthy();
		const count = screen.getByText("+3");
		expect(count.getAttribute("aria-hidden")).toBe("true");
	});
});
