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
	it("renders the type label, artifact, phase, and round", () => {
		render(<WorkflowRow row={row} onOpenDetail={vi.fn()} />);
		expect(screen.getByText("SDD")).toBeInTheDocument();
		expect(screen.getByText("payments-api.md")).toBeInTheDocument();
		expect(screen.getByText("implementation")).toBeInTheDocument();
		expect(screen.getByText("round 2/3")).toBeInTheDocument();
	});

	it("no longer renders the 'Last workflow:' caption", () => {
		render(<WorkflowRow row={row} onOpenDetail={vi.fn()} />);
		expect(screen.queryByText(/last workflow/i)).not.toBeInTheDocument();
	});

	it("places the type label on the artifact line, and the status dot on the phase line", () => {
		const { container } = render(
			<WorkflowRow row={row} onOpenDetail={vi.fn()} />,
		);
		const artifactLine = container.querySelector(".workflow-row__artifact-line");
		expect(artifactLine).not.toBeNull();
		expect(artifactLine?.textContent).toContain("SDD");
		expect(artifactLine?.textContent).toContain("payments-api.md");
		// The status indicator is a dot on the phase line, not on the artifact line.
		expect(artifactLine?.querySelector(".workflow-row__status")).toBeNull();
		const phaseStatus = container.querySelector(
			".workflow-row__phase .workflow-row__status",
		);
		expect(phaseStatus).toHaveAttribute("data-status", "running");
	});

	it("renders the status as a dot (no status text)", () => {
		const { container } = render(
			<WorkflowRow row={row} onOpenDetail={vi.fn()} />,
		);
		expect(
			container.querySelector(".workflow-row__status .workflow-row__status-dot"),
		).not.toBeNull();
		// The raw status word is not rendered as visible text — only the dot.
		expect(screen.queryByText("running")).not.toBeInTheDocument();
	});

	it("maps a done workflow to the quiet ready tier on the status dot", () => {
		const { container } = render(
			<WorkflowRow
				row={makeRow({ status: "done", escalated: false })}
				onOpenDetail={() => {}}
			/>,
		);
		const status = container.querySelector(
			".workflow-row__phase .workflow-row__status",
		);
		expect(status).not.toBeNull();
		expect(status).toHaveAttribute("data-status", "done");
		expect(status).toHaveAttribute("data-tier", "ready");
	});

	it("maps an escalated workflow (not the raw status) to the actionRequired tier", () => {
		const { container } = render(
			<WorkflowRow
				row={makeRow({ status: "running", escalated: true })}
				onOpenDetail={() => {}}
			/>,
		);
		const status = container.querySelector(".workflow-row__status");
		expect(status).toHaveAttribute("data-status", "escalated");
		expect(status).toHaveAttribute("data-tier", "actionRequired");
	});

	it("omits the artifact when there is none", () => {
		render(
			<WorkflowRow row={{ ...row, artifact: null }} onOpenDetail={vi.fn()} />,
		);
		expect(screen.queryByText("payments-api.md")).not.toBeInTheDocument();
		// The rest of the row still renders.
		expect(screen.getByText("SDD")).toBeInTheDocument();
	});

	it("shows daemon-down state with a restart hint", () => {
		render(
			<WorkflowRow row={{ ...row, daemonAlive: false }} onOpenDetail={vi.fn()} />,
		);
		expect(screen.getByText(/daemon not running/i)).toBeInTheDocument();
	});
});
