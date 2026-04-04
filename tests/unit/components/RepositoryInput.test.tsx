import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Repository } from "../../../shared/models/repository";
import type { Worktree } from "../../../shared/models/worktree";

vi.mock("../../../src/lib/desktop-client", () => ({
	repository: {
		setRoot: vi.fn(),
		listWorktrees: vi.fn(),
	},
	workspace: {
		readRestoreState: vi.fn().mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		}),
		writeRestoreState: vi.fn(),
	},
}));

import { RepositoryInput } from "../../../src/features/repository/RepositoryInput";
import { repository } from "../../../src/lib/desktop-client";

const mockSetRoot = vi.mocked(repository.setRoot);
const mockListWorktrees = vi.mocked(repository.listWorktrees);

const fakeRepo: Repository = { id: "r1", name: "test-repo", rootPath: "/test" };
const fakeWorktrees: Worktree[] = [
	{
		id: "/test",
		repositoryId: "r1",
		branchName: "main",
		path: "/test",
		label: "main",
		isMain: true,
	},
];

describe("RepositoryInput", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders input and submit button", () => {
		render(<RepositoryInput onLoad={vi.fn()} />);

		expect(screen.getByLabelText("Repository path")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Load" })).toBeInTheDocument();
	});

	it("calls setRoot then listWorktrees on submit", async () => {
		mockSetRoot.mockResolvedValueOnce(fakeRepo);
		mockListWorktrees.mockResolvedValueOnce(fakeWorktrees);
		const onLoad = vi.fn();

		render(<RepositoryInput onLoad={onLoad} />);

		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/test" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			expect(mockSetRoot).toHaveBeenCalledWith("/test");
			expect(mockListWorktrees).toHaveBeenCalled();
			expect(onLoad).toHaveBeenCalledWith(fakeRepo, fakeWorktrees);
		});
	});

	it("shows error text when setRoot rejects", async () => {
		mockSetRoot.mockRejectedValueOnce(new Error("Not a git repository"));

		render(<RepositoryInput onLoad={vi.fn()} />);

		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/bad" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			expect(
				screen.getByText("Error: Not a git repository"),
			).toBeInTheDocument();
		});
	});

	it("shows loading state during submission", async () => {
		// Mock that never resolves — keeps component in loading state
		mockSetRoot.mockReturnValue(new Promise(() => {}));

		render(<RepositoryInput onLoad={vi.fn()} />);

		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/test" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
		});
	});
});
