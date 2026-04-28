import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../src/lib/desktop-client", () => ({
	repository: {
		pickRoot: vi.fn(),
	},
	workspace: {
		readRestoreState: vi.fn().mockResolvedValue({
			version: 2,
			restorePreference: "alwaysStartClean",
			activeWorkspaceId: null,
			workspaceOrder: [],
			workspaces: [],
		}),
		writeRestoreState: vi.fn(),
	},
}));

import { RepositoryInput } from "../../../src/features/repository/RepositoryInput";
import { repository } from "../../../src/lib/desktop-client";

const mockPickRoot = vi.mocked(repository.pickRoot);

describe("RepositoryInput", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders input and submit button", () => {
		render(<RepositoryInput onLoadPath={vi.fn()} />);

		expect(screen.getByLabelText("Repository path")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Browse" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Load" })).toBeInTheDocument();
	});

	it("fills the repository path from the folder picker", async () => {
		mockPickRoot.mockResolvedValueOnce("/picked/repo");

		render(<RepositoryInput onLoadPath={vi.fn()} />);

		fireEvent.click(screen.getByRole("button", { name: "Browse" }));

		await waitFor(() => {
			expect(mockPickRoot).toHaveBeenCalled();
			expect(screen.getByLabelText("Repository path")).toHaveValue(
				"/picked/repo",
			);
		});
	});

	it("calls onLoadPath with the entered path on submit", async () => {
		const onLoadPath = vi.fn().mockResolvedValue(undefined);

		render(<RepositoryInput onLoadPath={onLoadPath} />);

		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/test" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			expect(onLoadPath).toHaveBeenCalledWith("/test");
		});
	});

	it("shows error text when onLoadPath rejects", async () => {
		const onLoadPath = vi
			.fn()
			.mockRejectedValueOnce(new Error("Not a git repository"));

		render(<RepositoryInput onLoadPath={onLoadPath} />);

		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/bad" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			expect(
				screen.getByText("Error: Path is not a Git repository."),
			).toBeInTheDocument();
		});
	});

	it("maps missing-path errors to practical setup copy", async () => {
		const onLoadPath = vi
			.fn()
			.mockRejectedValueOnce(
				new Error("ENOENT: no such file or directory, realpath '/missing'"),
			);

		render(<RepositoryInput onLoadPath={onLoadPath} />);
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/missing" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			expect(
				screen.getByText("Error: Path does not exist."),
			).toBeInTheDocument();
			expect(screen.getByLabelText("Repository path")).toHaveValue("/missing");
		});
	});

	it("shows loading state during submission", async () => {
		// Mock that never resolves — keeps component in loading state
		const onLoadPath = vi.fn().mockReturnValue(new Promise(() => {}));

		render(<RepositoryInput onLoadPath={onLoadPath} />);

		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/test" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
		});
	});

	it("keeps the loading state until the async onLoadPath resolves", async () => {
		let resolveLoad!: () => void;
		const onLoadPath = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveLoad = resolve;
				}),
		);

		render(<RepositoryInput onLoadPath={onLoadPath} />);

		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/test" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
		});

		resolveLoad();

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Load" })).toBeEnabled();
		});
	});

	it("uses shell-input on the path field and shell-button on actions", () => {
		const { container } = render(<RepositoryInput onLoadPath={vi.fn()} />);
		const input = container.querySelector("input#repo-path");
		expect(input?.className).toContain("shell-input");
		const browse = screen.getByRole("button", { name: "Browse" });
		expect(browse.className).toContain("shell-button");
		expect(browse.className).toContain("shell-button--compact");
		const submit = screen.getByRole("button", { name: /load/i });
		expect(submit.className).toContain("shell-button--primary");
	});
});
