import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowRow as WorkflowRowModel } from "../../../src/features/workflows/logic/workflow-lens";
import { WorkflowRow } from "../../../src/features/workflows/components/WorkflowRow";

const row: WorkflowRowModel = {
	worktreeId: "wt-1",
	workflowId: "wf1",
	workflowType: "spec-driven-development",
	typeLabel: "SDD",
	artifact: "payments-api.md",
	phaseName: "implementation",
	roundLabel: "2/3",
	status: "running",
	escalated: false,
	daemonAlive: true,
	liveFeed: "socket",
};

describe("WorkflowRow", () => {
	it("renders the type label, artifact, phase, round, and a status badge", () => {
		render(<WorkflowRow row={row} onOpenDetail={vi.fn()} />);
		expect(screen.getByText(/last workflow/i)).toBeInTheDocument();
		expect(screen.getByText("SDD")).toBeInTheDocument();
		expect(screen.getByText("payments-api.md")).toBeInTheDocument();
		expect(screen.getByText("implementation")).toBeInTheDocument();
		expect(screen.getByText("round 2/3")).toBeInTheDocument();
		expect(screen.getByText("running")).toHaveAttribute(
			"data-status",
			"running",
		);
	});

	it("shows 'escalated' (not the raw status) with the escalated tone", () => {
		render(
			<WorkflowRow row={{ ...row, escalated: true }} onOpenDetail={vi.fn()} />,
		);
		expect(screen.getByText("escalated")).toHaveAttribute(
			"data-status",
			"escalated",
		);
		expect(screen.queryByText("running")).not.toBeInTheDocument();
	});

	it("omits the artifact line when there is none", () => {
		render(
			<WorkflowRow row={{ ...row, artifact: null }} onOpenDetail={vi.fn()} />,
		);
		expect(screen.queryByText("payments-api.md")).not.toBeInTheDocument();
		// The rest of the row still renders.
		expect(screen.getByText("SDD")).toBeInTheDocument();
	});

	it("shows daemon-down state with a restart hint", () => {
		render(
			<WorkflowRow
				row={{ ...row, daemonAlive: false }}
				onOpenDetail={vi.fn()}
			/>,
		);
		expect(screen.getByText(/daemon not running/i)).toBeInTheDocument();
	});
});
