import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewQueuePanel } from "../../../src/features/review/components/ReviewQueuePanel";
import type { ReviewComment } from "../../../shared/models/review-comment";

const make = (over: Partial<ReviewComment> = {}): ReviewComment => ({
	id: "1",
	worktreeId: "w1",
	filePath: "a.ts",
	startLine: 1,
	endLine: 1,
	snippet: "x",
	body: "body",
	status: "open",
	source: "working-tree",
	commitSha: null,
	createdAt: "2026-05-14T00:00:00.000Z",
	addressedAt: null,
	...over,
});

const NOOP = {
	onJump: () => {},
	onClearAddressed: () => {},
	onToggleHideAddressed: () => {},
};

describe("ReviewQueuePanel", () => {
	it("renders file groups for active mode", () => {
		render(
			<ReviewQueuePanel
				activeMode={{ kind: "changes" }}
				comments={[make({ id: "1" }), make({ id: "2", filePath: "b.ts" })]}
				hideAddressed={false}
				{...NOOP}
			/>,
		);
		expect(screen.getByText("a.ts")).toBeInTheDocument();
		expect(screen.getByText("b.ts")).toBeInTheDocument();
	});

	it("groups non-active-mode comments under 'Other modes'", () => {
		render(
			<ReviewQueuePanel
				activeMode={{ kind: "changes" }}
				comments={[
					make({ id: "1" }),
					make({ id: "2", source: "commit", commitSha: "abc", filePath: "b.ts" }),
				]}
				hideAddressed={false}
				{...NOOP}
			/>,
		);
		expect(screen.getByText(/other modes/i)).toBeInTheDocument();
		expect(screen.getByText(/b\.ts/)).toBeInTheDocument();
	});

	it("row click invokes onJump with full comment", async () => {
		const onJump = vi.fn();
		const user = userEvent.setup();
		render(
			<ReviewQueuePanel
				activeMode={{ kind: "changes" }}
				comments={[make({ id: "1" })]}
				hideAddressed={false}
				{...NOOP}
				onJump={onJump}
			/>,
		);
		await user.click(screen.getByText("body"));
		expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
	});

	it("Clear all addressed fires when there are addressed comments", async () => {
		const onClearAddressed = vi.fn();
		const user = userEvent.setup();
		render(
			<ReviewQueuePanel
				activeMode={{ kind: "changes" }}
				comments={[make({ id: "1", status: "addressed", addressedAt: "2026-05-14T00:00:00.000Z" })]}
				hideAddressed={false}
				{...NOOP}
				onClearAddressed={onClearAddressed}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /clear all addressed/i }));
		expect(onClearAddressed).toHaveBeenCalled();
	});

	it("renders AgentInstallCta slot when installCtaVisible", () => {
		render(
			<ReviewQueuePanel
				activeMode={{ kind: "changes" }}
				comments={[]}
				hideAddressed={false}
				installCtaVisible
				onOpenInstall={() => {}}
				{...NOOP}
			/>,
		);
		expect(screen.getByRole("button", { name: /install/i })).toBeInTheDocument();
	});
});
