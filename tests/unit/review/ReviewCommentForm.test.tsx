import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewCommentForm } from "../../../src/features/review/ReviewCommentForm";

describe("ReviewCommentForm", () => {
	it("calls onSave with body when Save clicked", () => {
		const onSave = vi.fn();
		render(<ReviewCommentForm onSave={onSave} onCancel={() => {}} />);
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "rename x" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save/i }));
		expect(onSave).toHaveBeenCalledWith("rename x");
	});

	it("disables Save when body is empty", () => {
		render(<ReviewCommentForm onSave={() => {}} onCancel={() => {}} />);
		expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
	});

	it("calls onCancel when Cancel clicked", () => {
		const onCancel = vi.fn();
		render(<ReviewCommentForm onSave={() => {}} onCancel={onCancel} />);
		fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
		expect(onCancel).toHaveBeenCalled();
	});
});
