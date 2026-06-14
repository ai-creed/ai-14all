import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
	AgentCliProbes,
	WhisperWorktreeState,
} from "../../../shared/models/ecosystem-plugin";
import { AgentLauncherBar } from "../../../src/features/terminals/components/AgentLauncherBar";

const probes = (over: Partial<AgentCliProbes> = {}): AgentCliProbes => ({
	claude: { kind: "found", path: "/bin/claude", version: "1" },
	codex: { kind: "found", path: "/bin/codex", version: "1" },
	ezio: { kind: "not-found" },
	...over,
});

const state = (
	over: Partial<WhisperWorktreeState> = {},
): WhisperWorktreeState => ({
	worktreeId: "w1",
	collabId: "c1",
	daemonAlive: false,
	liveFeed: "polling",
	bindings: [],
	workflow: null,
	escalation: null,
	handoffs: [],
	...over,
});

it("renders a chip only for detected providers", () => {
	render(
		<AgentLauncherBar
			probes={probes()}
			whisperHealthy={false}
			whisperState={undefined}
			launchInTerminal={vi.fn()}
		/>,
	);
	expect(screen.getByTestId("agent-launch-claude")).toBeInTheDocument();
	expect(screen.getByTestId("agent-launch-codex")).toBeInTheDocument();
	expect(screen.queryByTestId("agent-launch-ezio")).not.toBeInTheDocument();
});

it("tags each chip with its provider so the CSS can color it per agent", () => {
	render(
		<AgentLauncherBar
			probes={probes({
				ezio: { kind: "found", path: "/bin/ezio", version: null },
			})}
			whisperHealthy={false}
			whisperState={undefined}
			launchInTerminal={vi.fn()}
		/>,
	);
	expect(screen.getByTestId("agent-launch-claude")).toHaveAttribute(
		"data-provider",
		"claude",
	);
	expect(screen.getByTestId("agent-launch-codex")).toHaveAttribute(
		"data-provider",
		"codex",
	);
	expect(screen.getByTestId("agent-launch-ezio")).toHaveAttribute(
		"data-provider",
		"ezio",
	);
});

it("renders nothing when no providers are detected", () => {
	const { container } = render(
		<AgentLauncherBar
			probes={probes({
				claude: { kind: "not-found" },
				codex: { kind: "not-found" },
			})}
			whisperHealthy={false}
			whisperState={undefined}
			launchInTerminal={vi.fn()}
		/>,
	);
	expect(container).toBeEmptyDOMElement();
});

it("whisper off: a click launches the bare provider", async () => {
	const launch = vi.fn();
	const user = userEvent.setup();
	render(
		<AgentLauncherBar
			probes={probes()}
			whisperHealthy={false}
			whisperState={undefined}
			launchInTerminal={launch}
		/>,
	);
	await user.click(screen.getByTestId("agent-launch-claude"));
	expect(launch).toHaveBeenCalledWith("claude");
});

it("whisper on, no collab: a click mounts; rapid second click stays enabled and spawns a plain provider (no second mount)", async () => {
	const launch = vi.fn();
	const user = userEvent.setup();
	render(
		<AgentLauncherBar
			probes={probes()}
			whisperHealthy={true}
			whisperState={state({ daemonAlive: false, bindings: [] })}
			launchInTerminal={launch}
		/>,
	);
	const claude = screen.getByTestId("agent-launch-claude");
	await user.click(claude);
	expect(claude).not.toBeDisabled();
	await user.click(claude);
	expect(launch).toHaveBeenNthCalledWith(1, "whisper collab mount claude");
	expect(launch).toHaveBeenNthCalledWith(2, "claude");
	expect(launch).toHaveBeenCalledTimes(2);
});

it("whisper on, full collab (2 bound): a click spawns a plain provider and the pill reads ready (AC3)", async () => {
	const launch = vi.fn();
	const user = userEvent.setup();
	render(
		<AgentLauncherBar
			probes={probes()}
			whisperHealthy={true}
			whisperState={state({
				daemonAlive: true,
				bindings: [
					{ agentType: "claude", bindingState: "bound" },
					{ agentType: "codex", bindingState: "bound" },
				],
			})}
			launchInTerminal={launch}
		/>,
	);
	await user.click(screen.getByTestId("agent-launch-claude"));
	expect(launch).toHaveBeenCalledWith("claude");
	expect(launch).not.toHaveBeenCalledWith("whisper collab mount claude");
	expect(screen.getByTestId("collab-status-pill")).toHaveTextContent(
		"collab · ready for workflows",
	);
});

it("renders the aggregate pill from bound count of a live collab", () => {
	render(
		<AgentLauncherBar
			probes={probes()}
			whisperHealthy={true}
			whisperState={state({
				daemonAlive: true,
				bindings: [{ agentType: "claude", bindingState: "bound" }],
			})}
			launchInTerminal={vi.fn()}
		/>,
	);
	expect(screen.getByTestId("collab-status-pill")).toHaveTextContent(
		"collab · 1 agent · need 1 more",
	);
});

it("STOPPED collab (daemonAlive false) with stale bindings: a click mounts (not plain) and the pill prompts to mount", async () => {
	// Bug repro: after `whisper collab stop` the bindings remain "bound" in the
	// store but the daemon is dead. A dead collab must not block a fresh mount.
	const launch = vi.fn();
	const user = userEvent.setup();
	render(
		<AgentLauncherBar
			probes={probes()}
			whisperHealthy={true}
			whisperState={state({
				daemonAlive: false,
				bindings: [
					{ agentType: "claude", bindingState: "bound" },
					{ agentType: "codex", bindingState: "bound" },
				],
			})}
			launchInTerminal={launch}
		/>,
	);
	await user.click(screen.getByTestId("agent-launch-claude"));
	expect(launch).toHaveBeenCalledWith("whisper collab mount claude");
	expect(launch).not.toHaveBeenCalledWith("claude");
	expect(screen.getByTestId("collab-status-pill")).toHaveTextContent(
		"mount an agent to start a collab",
	);
});

it("shows no pill when whisper is off", () => {
	render(
		<AgentLauncherBar
			probes={probes()}
			whisperHealthy={false}
			whisperState={undefined}
			launchInTerminal={vi.fn()}
		/>,
	);
	expect(screen.queryByTestId("collab-status-pill")).not.toBeInTheDocument();
});
