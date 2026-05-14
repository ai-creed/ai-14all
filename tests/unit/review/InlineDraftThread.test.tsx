import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineDraftThread } from "../../../src/features/review/components/InlineDraftThread";

describe("InlineDraftThread", () => {
	it("calls onSubmit with trimmed body and onMeasureChange on mount", async () => {
		const onSubmit = vi.fn();
		const onMeasureChange = vi.fn();
		const user = userEvent.setup();
		render(
			<InlineDraftThread
				range={{ startLine: 3, endLine: 3 }}
				onSubmit={onSubmit}
				onCancel={() => {}}
				onMeasureChange={onMeasureChange}
			/>,
		);
		expect(onMeasureChange).toHaveBeenCalled();
		const input = screen.getByRole("textbox");
		await user.type(input, "  hello  ");
		await user.click(screen.getByRole("button", { name: /save/i }));
		expect(onSubmit).toHaveBeenCalledWith("hello");
	});

	it("Save disabled when empty", () => {
		render(
			<InlineDraftThread
				range={{ startLine: 1, endLine: 1 }}
				onSubmit={() => {}}
				onCancel={() => {}}
				onMeasureChange={() => {}}
			/>,
		);
		expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
	});
});
