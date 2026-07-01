import {
	render,
	screen,
	fireEvent,
	act,
	waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the health handler so the test can drive link states, and spy on the
// reconnect IPC. The mock specifiers resolve to the SAME module files the
// component imports, so vitest intercepts the component's imports too.
let healthHandler: ((h: { link: string }) => void) | undefined;
// vi.hoisted ensures the spy is initialised before vi.mock factories run (which
// are hoisted to the top of the module by vitest's transform).
const { reconnectSamantha } = vi.hoisted(() => ({
	reconnectSamantha: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../../src/lib/desktop-client", () => ({
	plugins: {
		reprobe: vi.fn(async () => undefined),
		agentClis: vi.fn(async () => ({
			claude: { kind: "found", version: "1.2.3", path: "/bin/claude" },
			codex: { kind: "missing" },
			ezio: { kind: "missing" },
			cursor: { kind: "missing" },
			antigravity: { kind: "missing" },
		})),
		setEnabled: vi.fn(async () => undefined),
		reconnectSamantha,
		onSamanthaHealth: (h: (x: { link: string }) => void) => {
			healthHandler = h;
			return () => {};
		},
	},
	system: { openExternal: vi.fn(async () => undefined) },
}));

vi.mock("../../../src/features/plugins/hooks/use-plugins-state", () => ({
	usePluginsState: () => [
		{
			id: "samantha",
			enabled: true,
			installPath: "/x",
			status: { state: "on-healthy", version: "1.0.0", limited: false },
		},
	],
}));

import { PluginsPanelDialog } from "../../../src/features/plugins/components/PluginsPanelDialog";
import { plugins } from "../../../src/lib/desktop-client";

function renderPanel() {
	return render(
		<PluginsPanelDialog
			open
			onOpenChange={() => {}}
			onInstall={() => {}}
			onConfigure={() => {}}
		/>,
	);
}

beforeEach(() => {
	healthHandler = undefined;
	reconnectSamantha.mockClear();
	reconnectSamantha.mockImplementation(async () => ({ ok: true }));
});

describe("PluginsPanelDialog — Agent CLIs collapse", () => {
	beforeEach(() => localStorage.clear());

	it("defaults collapsed and summarises the found count", async () => {
		renderPanel();
		const toggle = await screen.findByTestId("agent-clis-toggle");
		expect(toggle).toHaveTextContent("Agent CLIs — 1 of 5 found");
		expect(toggle).toHaveAttribute("aria-expanded", "false");
		// Detail rows are hidden while collapsed.
		expect(document.querySelector('[data-cli="claude"]')).toBeNull();
	});

	it("expands to reveal the detail rows and persists the state", async () => {
		const { unmount } = renderPanel();
		const toggle = await screen.findByTestId("agent-clis-toggle");
		await act(async () => fireEvent.click(toggle));
		expect(screen.getByTestId("agent-clis-toggle")).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		await waitFor(() =>
			expect(document.querySelector('[data-cli="claude"]')).not.toBeNull(),
		);
		unmount();
		// Remount reads the persisted expanded state.
		renderPanel();
		expect(await screen.findByTestId("agent-clis-toggle")).toHaveAttribute(
			"aria-expanded",
			"true",
		);
	});

	it("shows 'checking…' while probes are null and keeps the body collapsed", () => {
		// A never-resolving probe keeps the component's agentClis state null.
		vi.mocked(plugins.agentClis).mockImplementationOnce(
			() => new Promise(() => {}),
		);
		renderPanel();
		const toggle = screen.getByTestId("agent-clis-toggle");
		expect(toggle).toHaveTextContent("Agent CLIs — checking…");
		expect(toggle).toHaveAttribute("aria-expanded", "false");
		expect(document.querySelector('[data-cli="claude"]')).toBeNull();
	});

	it("degrades to in-memory state when localStorage.setItem throws", async () => {
		const spy = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new Error("private mode");
			});
		renderPanel();
		const toggle = await screen.findByTestId("agent-clis-toggle");
		await act(async () => fireEvent.click(toggle));
		// The section still expands in-memory despite the failed persist.
		expect(screen.getByTestId("agent-clis-toggle")).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		spy.mockRestore();
	});
});

describe("PluginsPanelDialog — Samantha reconnect", () => {
	it("hides Reconnect now while the link is connecting/connected", async () => {
		renderPanel();
		expect(screen.queryByTestId("samantha-reconnect")).not.toBeInTheDocument();
		await act(async () => healthHandler?.({ link: "connected" }));
		expect(screen.queryByTestId("samantha-reconnect")).not.toBeInTheDocument();
	});

	it("shows Reconnect now for reconnecting / samantha-not-running", async () => {
		renderPanel();
		await act(async () => healthHandler?.({ link: "reconnecting" }));
		expect(screen.getByTestId("samantha-reconnect")).toBeInTheDocument();
		await act(async () => healthHandler?.({ link: "samantha-not-running" }));
		expect(screen.getByTestId("samantha-reconnect")).toBeInTheDocument();
	});

	it("clicking Reconnect now invokes the IPC and shows a disabled connecting affordance", async () => {
		let resolveReconnect!: () => void;
		reconnectSamantha.mockImplementationOnce(
			() =>
				new Promise<{ ok: boolean }>((resolve) => {
					resolveReconnect = () => resolve({ ok: true });
				}),
		);
		renderPanel();
		await act(async () => healthHandler?.({ link: "samantha-not-running" }));
		const btn = screen.getByTestId("samantha-reconnect");
		await act(async () => {
			fireEvent.click(btn);
		});
		expect(reconnectSamantha).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("samantha-reconnect")).toBeDisabled();
		expect(screen.getByTestId("samantha-reconnect")).toHaveTextContent(
			/connecting/i,
		);
		await act(async () => resolveReconnect());
		await waitFor(() =>
			expect(screen.getByTestId("samantha-reconnect")).not.toBeDisabled(),
		);
	});
});
