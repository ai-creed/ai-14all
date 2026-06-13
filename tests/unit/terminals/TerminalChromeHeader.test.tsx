import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TerminalChromeHeader } from "../../../src/features/terminals/components/TerminalChromeHeader";

it("renders the agent launcher and terminal actions in a non-Session region", () => {
	render(
		<TerminalChromeHeader
			agentLauncher={<div data-testid="agents" />}
			terminalActions={<button data-testid="add-shell">Shell</button>}
		/>,
	);
	const region = screen.getByRole("region", { name: "Terminal controls" });
	expect(region).toBeInTheDocument();
	expect(screen.getByTestId("agents")).toBeInTheDocument();
	expect(screen.getByTestId("add-shell")).toBeInTheDocument();
	expect(region).not.toHaveAttribute("aria-label", "Session");
});

it("renders an empty agent slot gracefully (no providers detected)", () => {
	render(
		<TerminalChromeHeader
			agentLauncher={null}
			terminalActions={<button data-testid="add-shell">Shell</button>}
		/>,
	);
	expect(screen.getByTestId("add-shell")).toBeInTheDocument();
});
