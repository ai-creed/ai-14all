import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewDrawer } from "../../../src/features/review/ReviewDrawer";

const defaults = {
	open: false,
	isDirty: false,
	changedFileCount: 0,
	panelHeight: 280,
	onToggle: vi.fn(),
	onRefresh: vi.fn(),
	onResizeStart: vi.fn(),
};

describe("ReviewDrawer", () => {
	it("renders as a region with accessible name", () => {
		render(<ReviewDrawer {...defaults} />);
		expect(screen.getByRole("region", { name: /review/i })).toBeInTheDocument();
	});

	it("shows clean indicator when not dirty", () => {
		render(<ReviewDrawer {...defaults} isDirty={false} />);
		expect(screen.getByText(/clean/i)).toBeInTheDocument();
	});

	it("shows changed-file count when dirty", () => {
		render(<ReviewDrawer {...defaults} isDirty changedFileCount={4} />);
		expect(screen.getByText(/4 changed/i)).toBeInTheDocument();
	});

	it("does not render children when closed", () => {
		render(
			<ReviewDrawer {...defaults} open={false}>
				<span data-testid="body">contents</span>
			</ReviewDrawer>,
		);
		expect(screen.queryByTestId("body")).not.toBeInTheDocument();
	});

	it("renders children and resize handle when open", () => {
		render(
			<ReviewDrawer {...defaults} open>
				<span data-testid="body">contents</span>
			</ReviewDrawer>,
		);
		expect(screen.getByTestId("body")).toBeInTheDocument();
		expect(screen.getByRole("separator", { name: /resize review/i })).toBeInTheDocument();
	});

	it("toggle button reflects aria-expanded", () => {
		const { rerender } = render(<ReviewDrawer {...defaults} open={false} />);
		const toggle = screen.getByRole("button", { name: /expand review drawer/i });
		expect(toggle).toHaveAttribute("aria-expanded", "false");
		rerender(<ReviewDrawer {...defaults} open />);
		const toggle2 = screen.getByRole("button", { name: /collapse review drawer/i });
		expect(toggle2).toHaveAttribute("aria-expanded", "true");
	});

	it("onToggle fires when chevron is clicked", async () => {
		const user = userEvent.setup();
		const spy = vi.fn();
		render(<ReviewDrawer {...defaults} onToggle={spy} />);
		await user.click(screen.getByRole("button", { name: /expand review drawer/i }));
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("onRefresh fires when refresh button is clicked — does NOT call onToggle", async () => {
		const user = userEvent.setup();
		const refresh = vi.fn();
		const toggle = vi.fn();
		render(
			<ReviewDrawer {...defaults} open onRefresh={refresh} onToggle={toggle}>
				<span>body</span>
			</ReviewDrawer>,
		);
		await user.click(screen.getByRole("button", { name: /refresh review/i }));
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(toggle).not.toHaveBeenCalled();
	});
});
