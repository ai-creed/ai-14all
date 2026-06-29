import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarkViewedToggle } from "../../../src/features/review/components/MarkViewedToggle";

describe("MarkViewedToggle", () => {
	it("reflects the unreviewed state", () => {
		render(<MarkViewedToggle reviewed={false} onToggle={() => {}} />);
		const btn = screen.getByTestId("mark-viewed-toggle");
		expect(btn).toHaveTextContent("Mark viewed");
		expect(btn).toHaveAttribute("aria-pressed", "false");
	});

	it("reflects the reviewed state", () => {
		render(<MarkViewedToggle reviewed={true} onToggle={() => {}} />);
		const btn = screen.getByTestId("mark-viewed-toggle");
		expect(btn).toHaveTextContent("Viewed");
		expect(btn).toHaveAttribute("aria-pressed", "true");
	});

	it("calls onToggle when clicked", async () => {
		const onToggle = vi.fn();
		const user = userEvent.setup();
		render(<MarkViewedToggle reviewed={false} onToggle={onToggle} />);
		await user.click(screen.getByTestId("mark-viewed-toggle"));
		expect(onToggle).toHaveBeenCalledTimes(1);
	});
});
