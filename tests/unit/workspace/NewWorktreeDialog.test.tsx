import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NewWorktreeDialog } from "../../../src/features/workspace/components/NewWorktreeDialog";
import type { CreateWorktreePreview } from "../../../shared/models/worktree-lifecycle";

const PREVIEW: CreateWorktreePreview = {
	name: "feature-x",
	branchName: "feature-x",
	path: "/repo/.worktrees/feature-x",
	baseRef: "origin/main",
	baseCommit: { sha: "abc123", shortSha: "abc123", subject: "init" },
};

function renderDialog(overrides?: {
	busy?: boolean;
	preview?: typeof PREVIEW | null;
	error?: string | null;
}) {
	return render(
		<NewWorktreeDialog
			open={true}
			name="feature-x"
			sessionTitle=""
			preview={overrides?.preview === undefined ? PREVIEW : overrides.preview}
			loading={false}
			error={overrides?.error ?? null}
			busy={overrides?.busy ?? false}
			branches={["origin/master", "origin/devel"]}
			baseBranch="origin/master"
			onBaseBranchChange={vi.fn()}
			baseLoading={false}
			baseWarning={null}
			onOpenChange={vi.fn()}
			onNameChange={vi.fn()}
			onSessionTitleChange={vi.fn()}
			onConfirm={vi.fn()}
		/>,
	);
}

describe("NewWorktreeDialog", () => {
	it("shows the idle 'Create worktree' action when not busy", () => {
		// AppDialog renders through a portal, so query the document, not container.
		renderDialog({ busy: false });
		expect(
			screen.getByRole("button", { name: "Create worktree" }),
		).toBeInTheDocument();
		expect(document.querySelector(".shell-button__pulse-dot")).toBeNull();
	});

	it("shows a pulsing 'Creating session…' indicator while busy", () => {
		renderDialog({ busy: true });
		const button = screen.getByRole("button", { name: /creating session/i });
		expect(button.querySelector(".shell-button__pulse-dot")).not.toBeNull();
	});

	it("shows a friendly hint with the fix command for the origin/HEAD error", () => {
		renderDialog({
			preview: null,
			error:
				"Error: Could not resolve a base branch — origin/HEAD is not set. " +
				"Run: git remote set-head origin -a",
		});
		expect(screen.getByText(/no default branch detected/i)).toBeInTheDocument();
		expect(
			screen.getByText("git remote set-head origin -a"),
		).toBeInTheDocument();
		// The raw red banner should NOT also be shown for a recognized error.
		expect(document.querySelector(".shell-error-banner")).toBeNull();
	});

	it("falls back to the raw error banner for unrecognized errors", () => {
		renderDialog({
			preview: null,
			error: "Worktree path already exists: /repo/.worktrees/feature-x",
		});
		expect(
			screen.getByText(/worktree path already exists/i),
		).toBeInTheDocument();
		expect(document.querySelector(".shell-app-dialog__hint")).toBeNull();
	});

	it("disables both buttons while busy", () => {
		renderDialog({ busy: true });
		expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
		expect(
			screen.getByRole("button", { name: /creating session/i }),
		).toBeDisabled();
	});

	it("renders the base-branch picker with the default selected", () => {
		renderDialog();
		expect(
			screen.getByRole("option", { name: "origin/master" }),
		).toHaveAttribute("aria-selected", "true");
		expect(
			screen.getByRole("option", { name: "origin/devel" }),
		).toBeInTheDocument();
	});

	it("shows a non-blocking refresh warning but keeps Create enabled", () => {
		render(
			<NewWorktreeDialog
				open={true}
				name="feature-x"
				sessionTitle=""
				preview={PREVIEW}
				loading={false}
				error={null}
				busy={false}
				branches={["origin/master"]}
				baseBranch="origin/master"
				onBaseBranchChange={vi.fn()}
				baseLoading={false}
				baseWarning="Couldn't refresh from origin — showing last-fetched branches."
				onOpenChange={vi.fn()}
				onNameChange={vi.fn()}
				onSessionTitleChange={vi.fn()}
				onConfirm={vi.fn()}
			/>,
		);
		expect(
			screen.getByText(/couldn't refresh from origin/i),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Create worktree" }),
		).toBeEnabled();
	});

	it("renders the preview note when present", () => {
		renderDialog({
			preview: {
				...PREVIEW,
				baseRef: "HEAD",
				note: "origin has no branches — basing this session off the local HEAD.",
			},
		});
		expect(
			screen.getByText(/basing this session off the local HEAD/i),
		).toBeInTheDocument();
	});
});
