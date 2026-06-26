import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
	AgentCliProbes,
	WhisperAgentBinding,
	WhisperWorktreeState,
} from "../../../shared/models/ecosystem-plugin";
import { AgentLauncherBar } from "../../../src/features/terminals/components/AgentLauncherBar";

const probes = (over: Partial<AgentCliProbes> = {}): AgentCliProbes => ({
	claude: { kind: "found", path: "/bin/claude", version: "1" },
	codex: { kind: "found", path: "/bin/codex", version: "1" },
	ezio: { kind: "not-found" },
	cursor: { kind: "not-found" },
	antigravity: { kind: "not-found" },
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

const bound = (...agents: string[]): WhisperAgentBinding[] =>
	agents.map((agentType) => ({ agentType, bindingState: "bound" as const }));

type Over = {
	probes?: AgentCliProbes | null;
	whisperHealthy?: boolean;
	whisperState?: WhisperWorktreeState;
	mountPending?: boolean;
};

function renderBar(over: Over = {}) {
	const launchInTerminal = vi.fn();
	const beginMount = vi.fn();
	const result = render(
		<AgentLauncherBar
			probes={over.probes === undefined ? probes() : over.probes}
			whisperHealthy={over.whisperHealthy ?? false}
			whisperState={over.whisperState}
			mountPending={over.mountPending ?? false}
			beginMount={beginMount}
			launchInTerminal={launchInTerminal}
		/>,
	);
	return { ...result, launchInTerminal, beginMount };
}

it("renders a chip only for detected providers", () => {
	renderBar();
	expect(screen.getByTestId("agent-launch-claude")).toBeInTheDocument();
	expect(screen.getByTestId("agent-launch-codex")).toBeInTheDocument();
	expect(screen.queryByTestId("agent-launch-ezio")).not.toBeInTheDocument();
});

it("tags each chip with its provider so the CSS can color it per agent", () => {
	renderBar({
		probes: probes({
			ezio: { kind: "found", path: "/bin/ezio", version: null },
		}),
	});
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
	const { container } = renderBar({
		probes: probes({
			claude: { kind: "not-found" },
			codex: { kind: "not-found" },
		}),
	});
	expect(container).toBeEmptyDOMElement();
});

it("whisper off: a click launches the bare provider", async () => {
	const user = userEvent.setup();
	const { launchInTerminal } = renderBar({ whisperHealthy: false });
	await user.click(screen.getByTestId("agent-launch-claude"));
	expect(launchInTerminal).toHaveBeenCalledWith("claude");
});

it("whisper on, no collab: a click mounts and opens the shared guard", async () => {
	const user = userEvent.setup();
	const { launchInTerminal, beginMount } = renderBar({
		whisperHealthy: true,
		whisperState: state({ daemonAlive: false, bindings: [] }),
	});
	await user.click(screen.getByTestId("agent-launch-claude"));
	expect(launchInTerminal).toHaveBeenCalledWith("whisper collab mount claude");
	expect(beginMount).toHaveBeenCalledTimes(1);
});

it("with the shared guard already pending, a click spawns plain (no second mount)", async () => {
	// mountPending is owned one level up; when it is set, a click must resolve to
	// a plain spawn and must NOT open another window.
	const user = userEvent.setup();
	const { launchInTerminal, beginMount } = renderBar({
		whisperHealthy: true,
		whisperState: state({ daemonAlive: false, bindings: [] }),
		mountPending: true,
	});
	await user.click(screen.getByTestId("agent-launch-claude"));
	expect(launchInTerminal).toHaveBeenCalledWith("claude");
	expect(beginMount).not.toHaveBeenCalled();
});

it("whisper on, full collab (2 bound): a click spawns plain and the pill reads ready (AC3)", async () => {
	const user = userEvent.setup();
	const { launchInTerminal } = renderBar({
		whisperHealthy: true,
		whisperState: state({
			daemonAlive: true,
			bindings: bound("claude", "codex"),
		}),
	});
	await user.click(screen.getByTestId("agent-launch-claude"));
	expect(launchInTerminal).toHaveBeenCalledWith("claude");
	expect(launchInTerminal).not.toHaveBeenCalledWith(
		"whisper collab mount claude",
	);
	expect(screen.getByTestId("collab-status-pill")).toHaveTextContent(
		"collab · ready for workflows",
	);
});

it("renders the aggregate pill from bound count of a live collab", () => {
	renderBar({
		whisperHealthy: true,
		whisperState: state({ daemonAlive: true, bindings: bound("claude") }),
	});
	expect(screen.getByTestId("collab-status-pill")).toHaveTextContent(
		"collab · 1 agent · need 1 more",
	);
});

it("STOPPED collab (daemonAlive false) with stale bindings: a click mounts (not plain) and the pill prompts to mount", async () => {
	// After `whisper collab stop` the bindings remain "bound" but the daemon is
	// dead; a dead collab must not block a fresh mount.
	const user = userEvent.setup();
	const { launchInTerminal } = renderBar({
		whisperHealthy: true,
		whisperState: state({
			daemonAlive: false,
			bindings: bound("claude", "codex"),
		}),
	});
	await user.click(screen.getByTestId("agent-launch-claude"));
	expect(launchInTerminal).toHaveBeenCalledWith("whisper collab mount claude");
	expect(launchInTerminal).not.toHaveBeenCalledWith("claude");
	expect(screen.getByTestId("collab-status-pill")).toHaveTextContent(
		"mount an agent to start a collab",
	);
});

it("shows no pill when whisper is off", () => {
	renderBar({ whisperHealthy: false });
	expect(screen.queryByTestId("collab-status-pill")).not.toBeInTheDocument();
});
