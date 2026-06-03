import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NewWorktreeDialog } from "../../../src/features/workspace/components/NewWorktreeDialog";

const PREVIEW = {
	name: "feature-x",
	branchName: "feature-x",
	path: "/repo/.worktrees/feature-x",
	baseRef: "origin/main",
	baseCommit: { sha: "abc123", shortSha: "abc123", subject: "init" },
};

function renderDialog(overrides?: { busy?: boolean }) {
	return render(
		<NewWorktreeDialog
			open={true}
			name="feature-x"
			sessionTitle=""
			preview={PREVIEW}
			loading={false}
			error={null}
			busy={overrides?.busy ?? false}
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

	it("disables both buttons while busy", () => {
		renderDialog({ busy: true });
		expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
		expect(
			screen.getByRole("button", { name: /creating session/i }),
		).toBeDisabled();
	});
});
