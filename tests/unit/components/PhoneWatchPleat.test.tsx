import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PhoneWatchPleat } from "../../../src/features/terminals/components/PhoneWatchPleat";

describe("PhoneWatchPleat", () => {
	const base = {
		from: new Date("2026-07-21T14:03:00").getTime(),
		cols: 46,
		rows: 58,
		readBytes: () => "narrow-bytes",
		onDismiss: vi.fn(),
	};

	it("renders an open-ended range while watching and a closed range after", () => {
		const { rerender } = render(<PhoneWatchPleat {...base} to={null} />);
		expect(screen.getByText(/phone watched 14:03–…/)).toBeInTheDocument();
		rerender(
			<PhoneWatchPleat
				{...base}
				to={new Date("2026-07-21T14:07:00").getTime()}
			/>,
		);
		expect(screen.getByText(/phone watched 14:03–14:07/)).toBeInTheDocument();
	});

	it("expanding invokes the preview factory with phone geometry and the captured bytes; collapsing disposes", () => {
		const dispose = vi.fn();
		const createPreview = vi.fn(() => ({ dispose }));
		render(
			<PhoneWatchPleat {...base} to={null} createPreview={createPreview} />,
		);
		fireEvent.click(screen.getByRole("button", { name: /expand/i }));
		expect(createPreview).toHaveBeenCalledWith(
			expect.any(HTMLElement),
			46,
			58,
			"narrow-bytes",
		);
		fireEvent.click(screen.getByRole("button", { name: /collapse/i }));
		expect(dispose).toHaveBeenCalled();
	});

	it("dismiss fires onDismiss", () => {
		render(<PhoneWatchPleat {...base} to={1} />);
		fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
		expect(base.onDismiss).toHaveBeenCalled();
	});
});
