import { createRef } from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	ReviewExpandedPortal,
	type ReviewExpandedPortalHandle,
} from "../../../src/features/review/ReviewExpandedPortal";

function makeEl(tag = "div") {
	const el = document.createElement(tag);
	document.body.appendChild(el);
	return el;
}

function makeProps(
	overrides: Partial<React.ComponentProps<typeof ReviewExpandedPortal>> = {},
) {
	const mainColRef = { current: makeEl() };
	const chipBarRef = { current: makeEl() };
	return {
		mainColRef,
		chipBarRef,
		onCollapse: vi.fn(),
		onRefresh: vi.fn(),
		isDirty: false,
		changedFileCount: 0,
		children: <span data-testid="portal-child">content</span>,
		...overrides,
	};
}

// setup.ts already stubs ResizeObserver with a no-op class for all tests.

describe("ReviewExpandedPortal", () => {
	it("renders into document.body (portal)", () => {
		const { getByTestId } = render(<ReviewExpandedPortal {...makeProps()} />);
		const portal = getByTestId("review-expanded-portal");
		expect(document.body.contains(portal)).toBe(true);
	});

	it("renders children inside the portal", () => {
		render(<ReviewExpandedPortal {...makeProps()} />);
		expect(screen.getByTestId("portal-child")).toBeInTheDocument();
	});

	it("shows clean status when not dirty", () => {
		render(<ReviewExpandedPortal {...makeProps({ isDirty: false })} />);
		expect(screen.getByLabelText(/clean/i)).toBeInTheDocument();
	});

	it("shows changed-file count when dirty", () => {
		render(
			<ReviewExpandedPortal
				{...makeProps({ isDirty: true, changedFileCount: 5 })}
			/>,
		);
		expect(screen.getByLabelText(/5 changed files/i)).toBeInTheDocument();
	});

	it("calls onRefresh when refresh button is clicked", async () => {
		const user = userEvent.setup();
		const onRefresh = vi.fn();
		render(<ReviewExpandedPortal {...makeProps({ onRefresh })} />);
		await user.click(screen.getByRole("button", { name: /refresh review/i }));
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	it("sets data-leaving=true on collapse button click", async () => {
		const user = userEvent.setup();
		render(<ReviewExpandedPortal {...makeProps()} />);
		const portal = screen.getByTestId("review-expanded-portal");
		await user.click(
			screen.getByRole("button", { name: /collapse full review/i }),
		);
		expect(portal).toHaveAttribute("data-leaving", "true");
	});

	it("calls onCollapse after transitionend fires (internal button)", async () => {
		const user = userEvent.setup();
		const onCollapse = vi.fn();
		render(<ReviewExpandedPortal {...makeProps({ onCollapse })} />);
		const portal = screen.getByTestId("review-expanded-portal");
		await user.click(
			screen.getByRole("button", { name: /collapse full review/i }),
		);
		expect(onCollapse).not.toHaveBeenCalled();
		act(() => {
			portal.dispatchEvent(new Event("transitionend"));
		});
		expect(onCollapse).toHaveBeenCalledTimes(1);
	});

	it("collapse() imperative handle sets data-leaving and calls onCollapse after transitionend", async () => {
		const onCollapse = vi.fn();
		const handleRef = createRef<ReviewExpandedPortalHandle>();
		render(
			<ReviewExpandedPortal ref={handleRef} {...makeProps({ onCollapse })} />,
		);
		const portal = screen.getByTestId("review-expanded-portal");
		act(() => {
			handleRef.current?.collapse();
		});
		expect(portal).toHaveAttribute("data-leaving", "true");
		expect(onCollapse).not.toHaveBeenCalled();
		act(() => {
			portal.dispatchEvent(new Event("transitionend"));
		});
		expect(onCollapse).toHaveBeenCalledTimes(1);
	});

	it("timer fires; late transitionend does not call onCollapse again", () => {
		vi.useFakeTimers();
		try {
			const onCollapse = vi.fn();
			const handleRef = createRef<ReviewExpandedPortalHandle>();
			render(
				<ReviewExpandedPortal ref={handleRef} {...makeProps({ onCollapse })} />,
			);
			const portal = screen.getByTestId("review-expanded-portal");
			act(() => {
				handleRef.current?.collapse();
			});
			// Advance past the 300ms fallback timeout
			act(() => {
				vi.advanceTimersByTime(301);
			});
			expect(onCollapse).toHaveBeenCalledTimes(1);
			// Late transitionend must not call onCollapse a second time
			act(() => {
				portal.dispatchEvent(new Event("transitionend"));
			});
			expect(onCollapse).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("observes both chipBarRef and mainColRef elements", () => {
		const observe = vi.fn();
		class ResizeObserverSpy {
			observe = observe;
			unobserve = vi.fn();
			disconnect = vi.fn();
		}
		vi.stubGlobal("ResizeObserver", ResizeObserverSpy);
		const props = makeProps();
		render(<ReviewExpandedPortal {...props} />);
		expect(observe).toHaveBeenCalledWith(props.mainColRef.current);
		expect(observe).toHaveBeenCalledWith(props.chipBarRef.current);
		vi.unstubAllGlobals();
	});
});
