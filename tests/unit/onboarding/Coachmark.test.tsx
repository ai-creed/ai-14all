import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Coachmark } from "../../../src/features/onboarding/components/Coachmark";
import { COACHMARKS } from "../../../src/features/onboarding/logic/coachmarks";

const mark = COACHMARKS[0];

function mountAnchor(id: string) {
	const el = document.createElement("div");
	el.setAttribute("data-tour", id);
	document.body.appendChild(el);
}

afterEach(() => {
	// Unmount via RTL first so its own React-managed portal/container nodes
	// are removed properly. Vitest runs sibling afterEach hooks LIFO, so
	// without this explicit call the raw `innerHTML` reset below can run
	// before RTL's auto-registered cleanup(), which then throws trying to
	// remove nodes that are already gone.
	cleanup();
	document.body.innerHTML = "";
});

describe("Coachmark", () => {
	it("renders its copy when the anchor exists", () => {
		mountAnchor(mark.anchorId);
		render(<Coachmark coachmark={mark} onDismiss={() => {}} />);
		expect(screen.getByTestId("coachmark")).toBeInTheDocument();
		expect(screen.getByText(mark.title)).toBeInTheDocument();
	});

	it("renders nothing when the anchor is absent", () => {
		const { container } = render(
			<Coachmark coachmark={mark} onDismiss={() => {}} />,
		);
		expect(container.querySelector('[data-testid="coachmark"]')).toBeNull();
	});

	it("calls onDismiss with the coachmark id", async () => {
		const user = userEvent.setup();
		mountAnchor(mark.anchorId);
		const onDismiss = vi.fn();
		render(<Coachmark coachmark={mark} onDismiss={onDismiss} />);
		await user.click(screen.getByTestId("coachmark-dismiss"));
		expect(onDismiss).toHaveBeenCalledWith(mark.id);
	});
});
