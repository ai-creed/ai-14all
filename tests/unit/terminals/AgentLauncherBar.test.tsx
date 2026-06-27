import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
	AgentCliProbes,
	WhisperAgentBinding,
	WhisperWorktreeState,
} from "../../../shared/models/ecosystem-plugin";
import { AgentLauncherBar } from "../../../src/features/terminals/components/AgentLauncherBar";
import type { AgentProvider } from "../../../src/features/terminals/logic/agent-launch";

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
	deferredProvider?: AgentProvider | null;
	onLaunch?: (provider: AgentProvider) => void;
};

function renderBar(over: Over = {}) {
	const onLaunch = over.onLaunch ?? vi.fn();
	const result = render(
		<AgentLauncherBar
			probes={over.probes === undefined ? probes() : over.probes}
			whisperHealthy={over.whisperHealthy ?? false}
			whisperState={over.whisperState}
			deferredProvider={over.deferredProvider ?? null}
			onLaunch={onLaunch}
		/>,
	);
	return { ...result, onLaunch };
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

it("calls onLaunch with the clicked provider", async () => {
	const user = userEvent.setup();
	const { onLaunch } = renderBar({ whisperHealthy: true });
	await user.click(screen.getByTestId("agent-launch-claude"));
	expect(onLaunch).toHaveBeenCalledWith("claude");
});

it("shows a queued badge on the deferred provider", () => {
	renderBar({
		whisperHealthy: true,
		deferredProvider: "codex",
	});
	expect(screen.getByTestId("agent-queued-codex")).toBeInTheDocument();
	expect(screen.queryByTestId("agent-queued-claude")).toBeNull();
	expect(screen.getByTestId("agent-launch-codex")).toHaveAttribute(
		"data-queued",
		"true",
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

it("reads ready when a live collab is full (2 bound)", () => {
	renderBar({
		whisperHealthy: true,
		whisperState: state({
			daemonAlive: true,
			bindings: bound("claude", "codex"),
		}),
	});
	expect(screen.getByTestId("collab-status-pill")).toHaveTextContent(
		"collab · ready for workflows",
	);
});

it("shows no pill when whisper is off", () => {
	renderBar({ whisperHealthy: false });
	expect(screen.queryByTestId("collab-status-pill")).not.toBeInTheDocument();
});
