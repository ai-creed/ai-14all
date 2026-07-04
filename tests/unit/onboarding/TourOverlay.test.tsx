import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TourOverlay } from "../../../src/features/onboarding/components/TourOverlay";
import { TOUR_STEPS } from "../../../src/features/onboarding/logic/tour-steps";

function mountAnchor(id: string) {
	const el = document.createElement("div");
	el.setAttribute("data-tour", id);
	document.body.appendChild(el);
	return el;
}

afterEach(() => {
	// Unmount via RTL first so its own React-managed portal/container nodes
	// are removed properly. Vitest runs sibling afterEach hooks LIFO, so
	// without this explicit call the raw `innerHTML` reset below can run
	// before RTL's auto-registered cleanup(), which then throws trying to
	// remove nodes that are already gone.
	cleanup();
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

const noop = () => {};

describe("TourOverlay", () => {
	it("renders the current step card with a counter when its anchor exists", () => {
		mountAnchor(TOUR_STEPS[0].anchorId);
		render(
			<TourOverlay
				steps={TOUR_STEPS}
				stepIndex={0}
				onNext={noop}
				onBack={noop}
				onSkip={noop}
			/>,
		);
		expect(screen.getByTestId("tour-card")).toBeInTheDocument();
		expect(screen.getByText(TOUR_STEPS[0].title)).toBeInTheDocument();
		expect(
			screen.getByText(`Step 1 of ${TOUR_STEPS.length}`),
		).toBeInTheDocument();
	});

	it("hides Back on the first step and shows it later", () => {
		const firstAnchor = mountAnchor(TOUR_STEPS[0].anchorId);
		const { rerender } = render(
			<TourOverlay
				steps={TOUR_STEPS}
				stepIndex={0}
				onNext={noop}
				onBack={noop}
				onSkip={noop}
			/>,
		);
		expect(screen.queryByTestId("tour-back")).toBeNull();
		// Remove only the stale anchor, not the whole body: a blanket
		// `innerHTML` reset here would also rip out the still-mounted
		// portal/container nodes React is tracking for this live `rerender`.
		firstAnchor.remove();
		mountAnchor(TOUR_STEPS[1].anchorId);
		rerender(
			<TourOverlay
				steps={TOUR_STEPS}
				stepIndex={1}
				onNext={noop}
				onBack={noop}
				onSkip={noop}
			/>,
		);
		expect(screen.getByTestId("tour-back")).toBeInTheDocument();
	});

	it("labels the last step's advance control Done", () => {
		mountAnchor(TOUR_STEPS[TOUR_STEPS.length - 1].anchorId);
		render(
			<TourOverlay
				steps={TOUR_STEPS}
				stepIndex={TOUR_STEPS.length - 1}
				onNext={noop}
				onBack={noop}
				onSkip={noop}
			/>,
		);
		expect(screen.getByTestId("tour-next")).toHaveTextContent(/done/i);
	});

	it("fires the callbacks", async () => {
		const user = userEvent.setup();
		mountAnchor(TOUR_STEPS[1].anchorId);
		const onNext = vi.fn();
		const onBack = vi.fn();
		const onSkip = vi.fn();
		render(
			<TourOverlay
				steps={TOUR_STEPS}
				stepIndex={1}
				onNext={onNext}
				onBack={onBack}
				onSkip={onSkip}
			/>,
		);
		await user.click(screen.getByTestId("tour-next"));
		await user.click(screen.getByTestId("tour-back"));
		await user.click(screen.getByTestId("tour-skip"));
		expect(onNext).toHaveBeenCalledOnce();
		expect(onBack).toHaveBeenCalledOnce();
		expect(onSkip).toHaveBeenCalledOnce();
	});

	it("skips a step whose anchor is not mounted (calls onNext, renders nothing)", () => {
		const onNext = vi.fn();
		const { container } = render(
			<TourOverlay
				steps={TOUR_STEPS}
				stepIndex={0}
				onNext={onNext}
				onBack={noop}
				onSkip={noop}
			/>,
		);
		expect(onNext).toHaveBeenCalledOnce();
		expect(container.querySelector('[data-testid="tour-card"]')).toBeNull();
	});
});
