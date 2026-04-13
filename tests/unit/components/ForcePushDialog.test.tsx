import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ForcePushDialog } from "../../../src/features/git/ForcePushDialog";

describe("ForcePushDialog", () => {
	it("shows the behind count in the message", () => {
		render(
			<ForcePushDialog
				open={true}
				behind={3}
				onOpenChange={vi.fn()}
				onConfirm={vi.fn().mockResolvedValue(undefined)}
			/>,
		);
		expect(screen.getByText(/3 commit/i)).toBeInTheDocument();
	});

	it("calls onConfirm and closes on Force Push", async () => {
		const onConfirm = vi.fn().mockResolvedValue(undefined);
		const onOpenChange = vi.fn();
		render(
			<ForcePushDialog
				open={true}
				behind={1}
				onOpenChange={onOpenChange}
				onConfirm={onConfirm}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Force Push" }));
		await waitFor(() => {
			expect(onConfirm).toHaveBeenCalledTimes(1);
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
	});

	it("shows error banner when onConfirm rejects", async () => {
		const onConfirm = vi.fn().mockRejectedValue(new Error("network error"));
		render(
			<ForcePushDialog
				open={true}
				behind={1}
				onOpenChange={vi.fn()}
				onConfirm={onConfirm}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Force Push" }));
		await waitFor(() => {
			expect(screen.getByText("network error")).toBeInTheDocument();
		});
	});

	it("calls onOpenChange(false) when Cancel is clicked", () => {
		const onOpenChange = vi.fn();
		render(
			<ForcePushDialog
				open={true}
				behind={1}
				onOpenChange={onOpenChange}
				onConfirm={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
