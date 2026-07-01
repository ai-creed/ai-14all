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

function makeRow(overrides: Partial<WorkflowRowModel>): WorkflowRowModel {
	return { ...row, ...overrides };
}

describe("WorkflowRow", () => {
	it("renders the type label, artifact, phase, round, and a non-done status badge", () => {
		render(<WorkflowRow row={row} onOpenDetail={vi.fn()} />);
		expect(screen.getByText("SDD")).toBeInTheDocument();
		expect(screen.getByText("payments-api.md")).toBeInTheDocument();
		expect(screen.getByText("implementation")).toBeInTheDocument();
		expect(screen.getByText("round 2/3")).toBeInTheDocument();
		expect(screen.getByText("running")).toHaveAttribute(
			"data-status",
			"running",
		);
	});

	it("no longer renders the 'Last workflow:' caption", () => {
		render(<WorkflowRow row={row} onOpenDetail={vi.fn()} />);
		expect(screen.queryByText(/last workflow/i)).not.toBeInTheDocument();
	});

	it("places the type label on the artifact line, alongside the artifact", () => {
		const { container } = render(
			<WorkflowRow row={row} onOpenDetail={vi.fn()} />,
		);
		const line = container.querySelector(".workflow-row__artifact-line");
		expect(line).not.toBeNull();
		expect(line?.textContent).toContain("SDD");
		expect(line?.textContent).toContain("payments-api.md");
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

	it("shows no status badge for a done workflow (the worktree header carries it)", () => {
		const { container } = render(
			<WorkflowRow
				row={makeRow({ status: "done", escalated: false })}
				onOpenDetail={() => {}}
			/>,
		);
		expect(container.querySelector(".workflow-row__status")).toBeNull();
		expect(screen.queryByText("done")).not.toBeInTheDocument();
		// The rest of the lens still renders.
		expect(screen.getByText("SDD")).toBeInTheDocument();
	});

	it("maps an escalated workflow to the actionRequired tier", () => {
		render(<WorkflowRow row={makeRow({ status: "running", escalated: true })} onOpenDetail={() => {}} />);
		expect(screen.getByText("escalated").closest(".workflow-row__status")).toHaveAttribute("data-tier", "actionRequired");
	});
});
