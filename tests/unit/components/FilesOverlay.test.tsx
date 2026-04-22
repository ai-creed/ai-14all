import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tanstack/react-virtual", () => ({
	useVirtualizer: (options: { count: number }) => ({
		getTotalSize: () => options.count * 28,
		getVirtualItems: () =>
			Array.from({ length: options.count }, (_, i) => ({
				index: i,
				start: i * 28,
				size: 28,
				key: String(i),
			})),
		scrollToIndex: () => {},
		measureElement: () => 0,
	}),
}));

import { FilesOverlay } from "../../../src/features/files/FilesOverlay";

const noop = () => {};

const defaults = {
	isOpen: true,
	onClose: noop,
	trackedFilesLoader: async () => [] as string[],
	gitStatusMap: new Map<string, "M" | "A" | "D" | "R" | "??">(),
	onViewFile: noop,
	onEditFile: noop,
	isEditable: () => false,
};

describe("FilesOverlay scaffold", () => {
	it("renders nothing when closed", () => {
		render(<FilesOverlay {...defaults} isOpen={false} />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("renders a dialog when open", () => {
		render(<FilesOverlay {...defaults} />);
		expect(screen.getByRole("dialog", { name: /files/i })).toBeInTheDocument();
	});

	it("exposes data-testid for e2e targeting", () => {
		render(<FilesOverlay {...defaults} />);
		expect(screen.getByTestId("files-overlay")).toBeInTheDocument();
	});

	it("calls onClose when Escape is pressed", async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(<FilesOverlay {...defaults} onClose={onClose} />);
		await user.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

describe("FilesOverlay — chip-bar wiring contract", () => {
	it("renders the Files title region in the dialog header so the chip-bar handler can aim at it", () => {
		render(<FilesOverlay {...defaults} />);
		const dialog = screen.getByRole("dialog", { name: /files/i });
		expect(dialog).toHaveAttribute("data-testid", "files-overlay");
	});

	it("closes via onOpenChange(false) when parent sets isOpen=false via re-render", () => {
		const { rerender } = render(<FilesOverlay {...defaults} />);
		expect(screen.getByTestId("files-overlay")).toBeInTheDocument();
		rerender(<FilesOverlay {...defaults} isOpen={false} />);
		expect(screen.queryByTestId("files-overlay")).not.toBeInTheDocument();
	});
});
