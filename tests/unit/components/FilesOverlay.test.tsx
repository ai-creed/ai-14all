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

describe("FilesOverlay — tracked-file list", () => {
	it("calls trackedFilesLoader when it opens", async () => {
		const loader = vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
	});

	it("does not call trackedFilesLoader when closed", () => {
		const loader = vi.fn().mockResolvedValue([]);
		render(<FilesOverlay {...defaults} isOpen={false} trackedFilesLoader={loader} />);
		expect(loader).not.toHaveBeenCalled();
	});

	it("renders each tracked path as a row", async () => {
		const loader = vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		expect(await screen.findByText("a.ts")).toBeInTheDocument();
		expect(await screen.findByText("b.ts")).toBeInTheDocument();
	});

	it("renders Git status for a file that has one", async () => {
		const loader = vi.fn().mockResolvedValue(["src/a.ts"]);
		const statusMap = new Map<string, "M" | "A" | "D" | "R" | "??">([["src/a.ts", "M"]]);
		render(
			<FilesOverlay
				{...defaults}
				trackedFilesLoader={loader}
				gitStatusMap={statusMap}
			/>,
		);
		expect(await screen.findByTestId("files-overlay-row-status-src/a.ts")).toHaveTextContent("M");
	});

	it("shows an empty-state message when the worktree has no tracked files", async () => {
		const loader = vi.fn().mockResolvedValue([]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		expect(await screen.findByText(/no files/i)).toBeInTheDocument();
	});

	it("renders an error message when the loader rejects", async () => {
		const loader = vi.fn().mockRejectedValue(new Error("ipc down"));
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		expect(await screen.findByText(/couldn't load files/i)).toBeInTheDocument();
	});

	it("re-loads when the overlay is closed and re-opened", async () => {
		const loader = vi.fn().mockResolvedValue([]);
		const { rerender } = render(
			<FilesOverlay {...defaults} trackedFilesLoader={loader} />,
		);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
		rerender(<FilesOverlay {...defaults} isOpen={false} trackedFilesLoader={loader} />);
		rerender(<FilesOverlay {...defaults} isOpen={true} trackedFilesLoader={loader} />);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
	});
});
