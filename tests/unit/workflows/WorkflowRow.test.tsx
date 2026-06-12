import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowRow as WorkflowRowModel } from "../../../src/features/workflows/logic/workflow-lens";
import { WorkflowRow } from "../../../src/features/workflows/components/WorkflowRow";

const row: WorkflowRowModel = {
	worktreeId: "wt-1",
	workflowId: "wf1",
	workflowType: "spec-driven-development",
	phaseName: "implementation",
	roundLabel: "2/3",
	status: "running",
	daemonAlive: true,
	liveFeed: "socket",
};

describe("WorkflowRow", () => {
	it("renders type, phase, round, and status badge", () => {
		render(<WorkflowRow row={row} onOpenDetail={vi.fn()} />);
		expect(screen.getByText("spec-driven-development")).toBeInTheDocument();
		expect(screen.getByText("implementation")).toBeInTheDocument();
		expect(screen.getByText("2/3")).toBeInTheDocument();
		expect(screen.getByText("running")).toBeInTheDocument();
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
