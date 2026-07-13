import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NeedsYouSignal } from "../../../src/features/workspace/components/NeedsYouSignal";

describe("NeedsYouSignal", () => {
	it("renders the labelled, glyphed signal for actionRequired", () => {
		render(<NeedsYouSignal tier="actionRequired" />);
		const el = screen.getByTestId("row-needs-you");
		expect(el).toHaveAttribute("aria-label", "Needs your attention");
		expect(el).toHaveTextContent(/needs you/i);
		// A distinct Nerd Font shape (Icon renders the "info" fallback "ⓘ"),
		// clearly different from the idle/activity status dots.
		expect(el).toHaveTextContent("ⓘ");
		// The visible glyph element (the .app-nf span) is present.
		expect(el.querySelector(".app-nf")).not.toBeNull();
	});

	it("renders nothing for idle/activity/ready", () => {
		for (const tier of ["idle", "activity", "ready"] as const) {
			const { container } = render(<NeedsYouSignal tier={tier} />);
			expect(container).toBeEmptyDOMElement();
		}
	});
});
