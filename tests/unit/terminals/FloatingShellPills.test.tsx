import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FloatingShellPills } from "../../../src/features/terminals/components/FloatingShellPills";
import type { ProcessSession } from "../../../shared/models/process-session";

const proc = (id: string, status: ProcessSession["status"]): ProcessSession =>
	({
		id,
		workspaceId: "ws",
		worktreeId: "a",
		terminalSessionId: `t-${id}`,
		origin: "adHoc",
		presetId: null,
		label: id === "p1" ? "zsh" : "build",
		command: null,
		status,
		lastActivityAt: null,
		lastOutputPreview: null,
		exitCode: null,
		pinned: false,
		attentionState: "idle",
		agentAttentionReasons: {},
		agentAttentionClearedAt: null,
		agentDetected: false,
		provider: null,
	}) as ProcessSession;

describe("FloatingShellPills", () => {
	const byId = { p1: proc("p1", "running"), p2: proc("p2", "exited") };

	it("renders a pill per floating id with status", () => {
		render(
			<FloatingShellPills
				floatingShellIds={["p1", "p2"]}
				processSessionsById={byId}
				expandedId="p1"
				onExpand={() => {}}
				onClose={() => {}}
			/>,
		);
		expect(screen.getByTestId("floating-shell-pill-p1")).toHaveAttribute(
			"data-status",
			"running",
		);
		expect(screen.getByTestId("floating-shell-pill-p2")).toHaveAttribute(
			"data-status",
			"exited",
		);
	});

	it("renders nothing when there are no floating shells", () => {
		const { container } = render(
			<FloatingShellPills
				floatingShellIds={[]}
				processSessionsById={{}}
				expandedId={null}
				onExpand={() => {}}
				onClose={() => {}}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("clicking the body expands; clicking ✕ closes", () => {
		const onExpand = vi.fn();
		const onClose = vi.fn();
		render(
			<FloatingShellPills
				floatingShellIds={["p1"]}
				processSessionsById={byId}
				expandedId={null}
				onExpand={onExpand}
				onClose={onClose}
			/>,
		);
		fireEvent.click(screen.getByText("zsh"));
		expect(onExpand).toHaveBeenCalledWith("p1");
		fireEvent.click(screen.getByTestId("floating-shell-pill-close-p1"));
		expect(onClose).toHaveBeenCalledWith("p1");
	});
});
