import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineDraftThread } from "../../../src/features/review/components/InlineDraftThread";

function Controlled({
	onSubmit,
	onCancel,
	onMeasureChange,
}: {
	onSubmit: (body: string) => void;
	onCancel: () => void;
	onMeasureChange: () => void;
}) {
	const [body, setBody] = useState("");
	return (
		<InlineDraftThread
			range={{ startLine: 3, endLine: 3 }}
			body={body}
			onChange={setBody}
			onSubmit={() => onSubmit(body.trim())}
			onCancel={onCancel}
			onMeasureChange={onMeasureChange}
		/>
	);
}

describe("InlineDraftThread", () => {
	it("calls onSubmit with trimmed body and onMeasureChange on body change", async () => {
		const onSubmit = vi.fn();
		const onMeasureChange = vi.fn();
		const user = userEvent.setup();
		render(
			<Controlled
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
				body=""
				onChange={() => {}}
				onSubmit={() => {}}
				onCancel={() => {}}
				onMeasureChange={() => {}}
			/>,
		);
		expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
	});
});
