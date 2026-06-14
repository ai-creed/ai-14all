import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptySlotLauncher } from "../../../src/features/terminals/components/EmptySlotLauncher";

it("renders an agent chip per provider, each tagged for its color", () => {
	render(
		<EmptySlotLauncher
			slotIndex={2}
			providers={["claude", "codex", "ezio"]}
			onLaunchAgent={vi.fn()}
			onStartShell={vi.fn()}
		/>,
	);
	expect(screen.getByTestId("slot-agent-2-claude")).toHaveAttribute(
		"data-provider",
		"claude",
	);
	expect(screen.getByTestId("slot-agent-2-codex")).toHaveAttribute(
		"data-provider",
		"codex",
	);
	expect(screen.getByTestId("slot-agent-2-ezio")).toHaveAttribute(
		"data-provider",
		"ezio",
	);
});

it("launches the chosen agent into THIS slot", async () => {
	const onLaunchAgent = vi.fn();
	const user = userEvent.setup();
	render(
		<EmptySlotLauncher
			slotIndex={3}
			providers={["claude"]}
			onLaunchAgent={onLaunchAgent}
			onStartShell={vi.fn()}
		/>,
	);
	await user.click(screen.getByTestId("slot-agent-3-claude"));
	expect(onLaunchAgent).toHaveBeenCalledWith("claude", 3);
});

it("the start-a-shell CTA targets THIS slot", async () => {
	const onStartShell = vi.fn();
	const user = userEvent.setup();
	render(
		<EmptySlotLauncher
			slotIndex={1}
			providers={["claude"]}
			onLaunchAgent={vi.fn()}
			onStartShell={onStartShell}
		/>,
	);
	await user.click(screen.getByTestId("slot-cta-1"));
	expect(onStartShell).toHaveBeenCalledWith(1);
});

it("with no agents detected, shows only the start-a-shell CTA", () => {
	render(
		<EmptySlotLauncher
			slotIndex={0}
			providers={[]}
			onLaunchAgent={vi.fn()}
			onStartShell={vi.fn()}
		/>,
	);
	expect(screen.getByTestId("slot-cta-0")).toBeInTheDocument();
	expect(screen.queryByTestId("slot-agent-0-claude")).not.toBeInTheDocument();
});
