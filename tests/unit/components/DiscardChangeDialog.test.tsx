import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DiscardChangeDialog } from "../../../src/features/git/components/DiscardChangeDialog";

describe("DiscardChangeDialog", () => {
	it("renders the filename in the confirmation message", () => {
		render(
			<DiscardChangeDialog
				open={true}
				relativePath="src/index.ts"
				onOpenChange={vi.fn()}
				onConfirm={vi.fn().mockResolvedValue(undefined)}
			/>,
		);
		expect(screen.getByText(/src\/index\.ts/i)).toBeInTheDocument();
		expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
	});

	it("calls onConfirm and closes when Discard is clicked", async () => {
		const onConfirm = vi.fn().mockResolvedValue(undefined);
		const onOpenChange = vi.fn();
		render(
			<DiscardChangeDialog
				open={true}
				relativePath="src/index.ts"
				onOpenChange={onOpenChange}
				onConfirm={onConfirm}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Discard" }));

		await waitFor(() => {
			expect(onConfirm).toHaveBeenCalledTimes(1);
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
	});

	it("shows an error banner when onConfirm rejects", async () => {
		const onConfirm = vi.fn().mockRejectedValue(new Error("git lock error"));
		render(
			<DiscardChangeDialog
				open={true}
				relativePath="src/index.ts"
				onOpenChange={vi.fn()}
				onConfirm={onConfirm}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Discard" }));

		await waitFor(() => {
			expect(screen.getByText("git lock error")).toBeInTheDocument();
		});
	});

	it("calls onOpenChange(false) when Cancel is clicked", () => {
		const onOpenChange = vi.fn();
		render(
			<DiscardChangeDialog
				open={true}
				relativePath="src/index.ts"
				onOpenChange={onOpenChange}
				onConfirm={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
