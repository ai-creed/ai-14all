import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

	it("serializes submit: pending onSubmit ignores a second click and Enter; Save is disabled while pending", async () => {
		let resolveSubmit: (() => void) | undefined;
		const onSubmit = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSubmit = resolve;
				}),
		);
		render(
			<InlineDraftThread
				range={{ startLine: 1, endLine: 1 }}
				body="hello"
				onChange={() => {}}
				onSubmit={onSubmit}
				onCancel={() => {}}
				onMeasureChange={() => {}}
			/>,
		);
		const saveButton = screen.getByRole("button", { name: /save/i });
		const textarea = screen.getByRole("textbox");

		fireEvent.click(saveButton);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(saveButton).toBeDisabled();

		// Second click and Enter while pending must both be no-ops.
		fireEvent.click(saveButton);
		fireEvent.keyDown(textarea, { key: "Enter" });
		expect(onSubmit).toHaveBeenCalledTimes(1);

		resolveSubmit?.();
		await waitFor(() => expect(saveButton).not.toBeDisabled());
	});

	it("Escape on an empty draft cancels immediately without confirm", () => {
		const onCancel = vi.fn();
		const confirmSpy = vi.spyOn(window, "confirm");
		render(
			<InlineDraftThread
				range={{ startLine: 1, endLine: 1 }}
				body=""
				onChange={() => {}}
				onSubmit={() => {}}
				onCancel={onCancel}
				onMeasureChange={() => {}}
			/>,
		);
		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
		expect(confirmSpy).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalledTimes(1);
		confirmSpy.mockRestore();
	});

	it("Escape on a dirty draft cancels only when window.confirm returns true", () => {
		const onCancel = vi.fn();
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		render(
			<InlineDraftThread
				range={{ startLine: 1, endLine: 1 }}
				body="a draft in progress"
				onChange={() => {}}
				onSubmit={() => {}}
				onCancel={onCancel}
				onMeasureChange={() => {}}
			/>,
		);
		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
		expect(confirmSpy).toHaveBeenCalledWith("Discard this draft comment?");
		expect(onCancel).toHaveBeenCalledTimes(1);
		confirmSpy.mockRestore();
	});

	it("Escape on a dirty draft does not cancel when window.confirm returns false", () => {
		const onCancel = vi.fn();
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		render(
			<InlineDraftThread
				range={{ startLine: 1, endLine: 1 }}
				body="a draft in progress"
				onChange={() => {}}
				onSubmit={() => {}}
				onCancel={onCancel}
				onMeasureChange={() => {}}
			/>,
		);
		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
		expect(confirmSpy).toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});
});
