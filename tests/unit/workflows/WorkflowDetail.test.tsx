import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../src/lib/desktop-client", () => ({
	plugins: {
		runWhisperCommand: vi.fn(),
	},
}));

import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import { WorkflowDetail } from "../../../src/features/workflows/components/WorkflowDetail";
import { plugins } from "../../../src/lib/desktop-client";

const run = vi.mocked(plugins.runWhisperCommand);

function makeState(
	overrides: Partial<WhisperWorktreeState> = {},
	statusOverride?: string,
): WhisperWorktreeState {
	return {
		worktreeId: "wt-1",
		collabId: "c1",
		daemonAlive: true,
		liveFeed: "polling",
		bindings: [{ agentType: "claude", bindingState: "bound" }],
		handoffs: [
			{
				handoffId: "h1",
				senderAgent: "claude",
				targetAgent: "ezio",
				requestText: "please review",
				handbackText: "looks good",
				orchestratorVerdict: "approved",
				roundNumber: 1,
				createdAt: "t",
			},
		],
		workflow: {
			workflowId: "wf1",
			workflowType: "spec-driven-development",
			specPath: "docs/specs/payments-api.md",
			status: statusOverride ?? "running",
			currentPhaseIndex: 0,
			phaseName: "implementation",
			currentChainId: "ch1",
			round: { current: 1, max: 3 },
			haltReason: statusOverride === "halted" ? "round limit" : null,
			updatedAt: "t",
		},
		escalation: null,
		...overrides,
	};
}

function renderDetail(
	state: WhisperWorktreeState,
	onCommandError = vi.fn(),
	onCommandReply = vi.fn(),
) {
	render(
		<WorkflowDetail
			open
			onOpenChange={vi.fn()}
			state={state}
			workspaceId="ws-1"
			worktreeId="wt-1"
			onCommandError={onCommandError}
			onCommandReply={onCommandReply}
		/>,
	);
}

describe("WorkflowDetail", () => {
	it("renders the header, halt reason, bindings, and handback history", () => {
		renderDetail(makeState({}, "halted"));
		expect(screen.getByText("spec-driven-development")).toBeInTheDocument();
		expect(screen.getByText("round limit")).toBeInTheDocument();
		expect(screen.getByText(/claude — bound/)).toBeInTheDocument();
		expect(screen.getByText("claude → ezio")).toBeInTheDocument();
		expect(screen.getByText("please review")).toBeInTheDocument();
		expect(screen.getByText("looks good")).toBeInTheDocument();
		expect(screen.getByText("approved")).toBeInTheDocument();
	});

	it("dispatches a pause command for a running workflow", () => {
		run.mockResolvedValue({ ok: true, exitCode: 0, stdout: "", stderr: "" });
		renderDetail(makeState());
		fireEvent.click(screen.getByRole("button", { name: "Pause" }));
		expect(run).toHaveBeenCalledWith({
			kind: "workflow-pause",
			workflowId: "wf1",
			workspaceId: "ws-1",
			worktreeId: "wt-1",
		});
	});

	it("resumes a halted workflow with a null message by default", () => {
		run.mockResolvedValue({ ok: true, exitCode: 0, stdout: "", stderr: "" });
		renderDetail(makeState({}, "halted"));
		fireEvent.click(screen.getByRole("button", { name: "Resume" }));
		fireEvent.click(screen.getByRole("button", { name: "Resume" }));
		expect(run).toHaveBeenCalledWith({
			kind: "workflow-resume",
			workflowId: "wf1",
			message: null,
			workspaceId: "ws-1",
			worktreeId: "wt-1",
		});
	});

	it("surfaces whisper stderr via onCommandError when a command fails", async () => {
		run.mockResolvedValue({
			ok: false,
			exitCode: 1,
			stdout: "",
			stderr: "workflow already paused",
		});
		const onCommandError = vi.fn();
		renderDetail(makeState(), onCommandError);
		fireEvent.click(screen.getByRole("button", { name: "Pause" }));
		await waitFor(() =>
			expect(onCommandError).toHaveBeenCalledWith("workflow already paused"),
		);
	});

	it("fires collab-tell without blocking and shows a waiting hint", async () => {
		let resolveReply: (r: {
			ok: boolean;
			exitCode: number;
			stdout: string;
			stderr: string;
		}) => void = () => {};
		run.mockReturnValue(
			new Promise((resolve) => {
				resolveReply = resolve;
			}),
		);
		const onCommandReply = vi.fn();
		renderDetail(makeState(), vi.fn(), onCommandReply);
		fireEvent.change(screen.getByLabelText("Instruction"), {
			target: { value: "focus on the parser" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		expect(run).toHaveBeenCalledWith({
			kind: "collab-tell",
			target: "claude",
			instruction: "focus on the parser",
			workspaceId: "ws-1",
			worktreeId: "wt-1",
		});
		expect(screen.getByText(/waiting for reply/i)).toBeInTheDocument();
		resolveReply({ ok: true, exitCode: 0, stdout: "done", stderr: "" });
		await waitFor(() => expect(onCommandReply).toHaveBeenCalledWith("done"));
	});

	it("offers a daemon restart only when the daemon is down", () => {
		run.mockResolvedValue({ ok: true, exitCode: 0, stdout: "", stderr: "" });
		renderDetail(makeState({ daemonAlive: false }));
		const restart = screen.getByRole("button", { name: "Restart daemon" });
		fireEvent.click(restart);
		expect(run).toHaveBeenCalledWith({
			kind: "collab-recover",
			workspaceId: "ws-1",
			worktreeId: "wt-1",
		});
	});
});
