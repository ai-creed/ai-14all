import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewChipBar } from "../../../src/app/components/ReviewChipBar";

const NOOP = () => {};

describe("ReviewChipBar", () => {
	it("renders REVIEW label and current mode chip", () => {
		render(
			<ReviewChipBar
				isDirty={false}
				changedFileCount={0}
				reviewMode="changes"
				openCommentCount={0}
				addressedCommentCount={0}
				onRefresh={NOOP}
				onOpen={NOOP}
			/>,
		);
		expect(screen.getByText("REVIEW")).toBeInTheDocument();
		expect(screen.getByText("Changes")).toBeInTheDocument();
	});

	it("shows clean state when not dirty", () => {
		render(
			<ReviewChipBar
				isDirty={false}
				changedFileCount={0}
				reviewMode="files"
				openCommentCount={0}
				addressedCommentCount={0}
				onRefresh={NOOP}
				onOpen={NOOP}
			/>,
		);
		expect(screen.getByText(/clean/i)).toBeInTheDocument();
		expect(screen.queryByText(/changed/i)).not.toBeInTheDocument();
	});

	it("shows changed count when dirty", () => {
		render(
			<ReviewChipBar
				isDirty={true}
				changedFileCount={3}
				reviewMode="files"
				openCommentCount={0}
				addressedCommentCount={0}
				onRefresh={NOOP}
				onOpen={NOOP}
			/>,
		);
		expect(screen.getByText(/3 changed/i)).toBeInTheDocument();
		expect(screen.queryByText(/clean/i)).not.toBeInTheDocument();
	});

	it("hides comment info when both counts are zero", () => {
		render(
			<ReviewChipBar
				isDirty={false}
				changedFileCount={0}
				reviewMode="files"
				openCommentCount={0}
				addressedCommentCount={0}
				onRefresh={NOOP}
				onOpen={NOOP}
			/>,
		);
		expect(screen.queryByText(/open/)).not.toBeInTheDocument();
		expect(screen.queryByText(/addressed/)).not.toBeInTheDocument();
	});

	it("shows only open count when no addressed", () => {
		render(
			<ReviewChipBar
				isDirty={false}
				changedFileCount={0}
				reviewMode="files"
				openCommentCount={2}
				addressedCommentCount={0}
				onRefresh={NOOP}
				onOpen={NOOP}
			/>,
		);
		expect(screen.getByText(/2 open/)).toBeInTheDocument();
		expect(screen.queryByText(/addressed/)).not.toBeInTheDocument();
	});

	it("shows open and addressed when both > 0", () => {
		render(
			<ReviewChipBar
				isDirty={false}
				changedFileCount={0}
				reviewMode="files"
				openCommentCount={2}
				addressedCommentCount={1}
				onRefresh={NOOP}
				onOpen={NOOP}
			/>,
		);
		expect(screen.getByText(/2 open/)).toBeInTheDocument();
		expect(screen.getByText(/1 addressed/)).toBeInTheDocument();
	});

	it("calls onRefresh when refresh button clicked", async () => {
		const user = userEvent.setup();
		const onRefresh = vi.fn();
		render(
			<ReviewChipBar
				isDirty={false}
				changedFileCount={0}
				reviewMode="files"
				openCommentCount={0}
				addressedCommentCount={0}
				onRefresh={onRefresh}
				onOpen={NOOP}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /refresh review/i }));
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	it("calls onOpen when open button clicked", async () => {
		const user = userEvent.setup();
		const onOpen = vi.fn();
		render(
			<ReviewChipBar
				isDirty={false}
				changedFileCount={0}
				reviewMode="files"
				openCommentCount={0}
				addressedCommentCount={0}
				onRefresh={NOOP}
				onOpen={onOpen}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /open review/i }));
		expect(onOpen).toHaveBeenCalledTimes(1);
	});
});
