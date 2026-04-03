import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TerminalTabs } from "../../../src/features/terminals/TerminalTabs";

describe("TerminalTabs", () => {
	it("renders terminal labels and active state", () => {
		render(
			<TerminalTabs
				tabs={[
					{ sessionId: "term-1", label: "shell 1" },
					{ sessionId: "term-2", label: "shell 2" },
				]}
				activeSessionId="term-2"
				onSelect={vi.fn()}
				onAdd={vi.fn()}
				onClose={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: "shell 1" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "shell 2" })).toHaveAttribute(
			"data-active",
			"true",
		);
	});

	it("shows visual indicator and data-status for exited and errored tabs", () => {
		render(
			<TerminalTabs
				tabs={[
					{ sessionId: "term-1", label: "shell 1" },
					{ sessionId: "term-2", label: "shell 2" },
					{ sessionId: "term-3", label: "shell 3" },
				]}
				activeSessionId="term-1"
				sessionStatuses={{
					"term-1": "running",
					"term-2": "exited",
					"term-3": "error",
				}}
				onSelect={vi.fn()}
				onAdd={vi.fn()}
				onClose={vi.fn()}
			/>,
		);

		const tab1 = screen.getByRole("button", { name: "shell 1" });
		const tab2 = screen.getByRole("button", { name: "shell 2 (exited)" });
		const tab3 = screen.getByRole("button", { name: "shell 3 (error)" });

		// Running tab has no suffix
		expect(tab1).toHaveTextContent("shell 1");
		expect(tab1).not.toHaveTextContent("(exited)");
		expect(tab1).toHaveAttribute("data-status", "running");

		// Exited tab shows suffix and data-status
		expect(tab2).toHaveTextContent("shell 2 (exited)");
		expect(tab2).toHaveAttribute("data-status", "exited");

		// Errored tab shows suffix and data-status
		expect(tab3).toHaveTextContent("shell 3 (error)");
		expect(tab3).toHaveAttribute("data-status", "error");
	});

	it("defaults to running status when sessionStatuses prop is omitted", () => {
		render(
			<TerminalTabs
				tabs={[{ sessionId: "term-1", label: "shell 1" }]}
				activeSessionId="term-1"
				onSelect={vi.fn()}
				onAdd={vi.fn()}
				onClose={vi.fn()}
			/>,
		);

		const tab = screen.getByRole("button", { name: "shell 1" });
		expect(tab).toHaveTextContent("shell 1");
		expect(tab).not.toHaveTextContent("(exited)");
		expect(tab).toHaveAttribute("data-status", "running");
	});

	it("calls add, select, and close handlers", () => {
		const onAdd = vi.fn();
		const onSelect = vi.fn();
		const onClose = vi.fn();

		render(
			<TerminalTabs
				tabs={[{ sessionId: "term-1", label: "shell 1" }]}
				activeSessionId="term-1"
				onSelect={onSelect}
				onAdd={onAdd}
				onClose={onClose}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
		fireEvent.click(screen.getByRole("button", { name: "shell 1" }));
		fireEvent.click(screen.getByRole("button", { name: "Close shell 1" }));

		expect(onAdd).toHaveBeenCalled();
		expect(onSelect).toHaveBeenCalledWith("term-1");
		expect(onClose).toHaveBeenCalledWith("term-1");
	});
});
