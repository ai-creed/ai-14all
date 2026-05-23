import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewChipBar } from "../../../src/app/components/ReviewChipBar";
import type { ReviewMode } from "../../../shared/models/worktree-session";

const NOOP = () => {};

function defaultProps(
	overrides: Partial<Parameters<typeof ReviewChipBar>[0]> = {},
) {
	return {
		isDirty: false,
		changedFileCount: 0,
		reviewMode: "files" as ReviewMode,
		openCommentCount: 0,
		addressedCommentCount: 0,
		canOpenFiles: false,
		onRefresh: NOOP,
		onOpen: NOOP,
		onOpenFiles: NOOP,
		onOpenComments: NOOP,
		...overrides,
	};
}

describe("ReviewChipBar", () => {
	it("renders REVIEW label and current mode chip", () => {
		render(<ReviewChipBar {...defaultProps({ reviewMode: "changes" })} />);
		expect(screen.getByText("REVIEW")).toBeInTheDocument();
		expect(screen.getByText("Changes")).toBeInTheDocument();
	});

	it("shows clean state when not dirty", () => {
		render(<ReviewChipBar {...defaultProps({ isDirty: false })} />);
		expect(screen.getByText(/clean/i)).toBeInTheDocument();
		expect(screen.queryByText(/changed/i)).not.toBeInTheDocument();
	});

	it("shows changed count when dirty", () => {
		render(
			<ReviewChipBar {...defaultProps({ isDirty: true, changedFileCount: 3 })} />,
		);
		expect(screen.getByText(/3 changed/i)).toBeInTheDocument();
		expect(screen.queryByText(/clean/i)).not.toBeInTheDocument();
	});

	it("hides comment info when both counts are zero", () => {
		render(<ReviewChipBar {...defaultProps()} />);
		expect(screen.queryByText(/open/)).not.toBeInTheDocument();
		expect(screen.queryByText(/addressed/)).not.toBeInTheDocument();
	});

	it("shows only open count when no addressed", () => {
		render(<ReviewChipBar {...defaultProps({ openCommentCount: 2 })} />);
		expect(screen.getByText(/2 open/)).toBeInTheDocument();
		expect(screen.queryByText(/addressed/)).not.toBeInTheDocument();
	});

	it("shows open and addressed when both > 0", () => {
		render(
			<ReviewChipBar
				{...defaultProps({ openCommentCount: 2, addressedCommentCount: 1 })}
			/>,
		);
		expect(screen.getByText(/2 open/)).toBeInTheDocument();
		expect(screen.getByText(/1 addressed/)).toBeInTheDocument();
	});

	it("calls onRefresh when refresh button clicked", async () => {
		const user = userEvent.setup();
		const onRefresh = vi.fn();
		render(<ReviewChipBar {...defaultProps({ onRefresh })} />);
		await user.click(screen.getByRole("button", { name: /refresh review/i }));
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	it("calls onOpen when open button clicked", async () => {
		const user = userEvent.setup();
		const onOpen = vi.fn();
		render(<ReviewChipBar {...defaultProps({ onOpen })} />);
		await user.click(screen.getByRole("button", { name: /open review/i }));
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	// --- New behavior: clickable "x changed" chip ---

	it("renders 'x changed' as a button only when canOpenFiles is true", () => {
		render(
			<ReviewChipBar
				{...defaultProps({
					isDirty: true,
					changedFileCount: 2,
					canOpenFiles: true,
				})}
			/>,
		);
		expect(screen.getByTestId("review-chipbar-files").tagName).toBe("BUTTON");
	});

	it("renders 'x changed' as static text when dirty but canOpenFiles is false", () => {
		render(
			<ReviewChipBar
				{...defaultProps({
					isDirty: true,
					changedFileCount: 2,
					canOpenFiles: false,
				})}
			/>,
		);
		expect(screen.queryByTestId("review-chipbar-files")).not.toBeInTheDocument();
		expect(screen.getByText(/2 changed/i).tagName).not.toBe("BUTTON");
	});

	it("calls onOpenFiles when the changed chip button is clicked", async () => {
		const user = userEvent.setup();
		const onOpenFiles = vi.fn();
		render(
			<ReviewChipBar
				{...defaultProps({
					isDirty: true,
					changedFileCount: 2,
					canOpenFiles: true,
					onOpenFiles,
				})}
			/>,
		);
		await user.click(screen.getByTestId("review-chipbar-files"));
		expect(onOpenFiles).toHaveBeenCalledTimes(1);
	});

	// --- New behavior: clickable "N open" chip ---

	it("renders 'N open' as a button when openCommentCount > 0", () => {
		render(<ReviewChipBar {...defaultProps({ openCommentCount: 3 })} />);
		expect(screen.getByTestId("review-chipbar-comments").tagName).toBe("BUTTON");
	});

	it("calls onOpenComments when the open-comments chip button is clicked", async () => {
		const user = userEvent.setup();
		const onOpenComments = vi.fn();
		render(
			<ReviewChipBar {...defaultProps({ openCommentCount: 3, onOpenComments })} />,
		);
		await user.click(screen.getByTestId("review-chipbar-comments"));
		expect(onOpenComments).toHaveBeenCalledTimes(1);
	});

	it("renders 'M addressed' as non-interactive text", () => {
		render(
			<ReviewChipBar
				{...defaultProps({ openCommentCount: 0, addressedCommentCount: 4 })}
			/>,
		);
		expect(screen.getByText(/4 addressed/).tagName).not.toBe("BUTTON");
		expect(
			screen.queryByTestId("review-chipbar-comments"),
		).not.toBeInTheDocument();
	});
});
