import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewProgressHeader } from "../../../src/features/review/components/ReviewProgressHeader";

describe("ReviewProgressHeader", () => {
	it("shows reviewed/total and a fill width", () => {
		render(<ReviewProgressHeader reviewed={3} total={8} />);
		expect(screen.getByText("3 / 8 reviewed")).toBeInTheDocument();
		const fill = screen.getByTestId("review-progress-fill");
		expect(fill).toHaveStyle({ width: "37.5%" });
	});

	it("renders nothing when there are no changed files", () => {
		const { container } = render(
			<ReviewProgressHeader reviewed={0} total={0} />,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
