import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PluginCard } from "../../../src/features/plugins/components/PluginCard";

const descriptor = {
	title: "ai-whisper",
	pitch: "Autonomous pair-agent workflows for your worktrees.",
	installCommand: "npm i -g ai-whisper",
};

describe("PluginCard", () => {
	it("not-installed: shows chip + install action, no toggle", () => {
		const onInstall = vi.fn();
		render(
			<PluginCard
				descriptor={descriptor}
				snapshot={{
					id: "whisper",
					enabled: false,
					installPath: null,
					status: { state: "not-installed" },
				}}
				onToggle={vi.fn()}
				onInstall={onInstall}
				onReprobe={vi.fn()}
			/>,
		);
		expect(screen.getByText("not installed")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /install/i }));
		expect(onInstall).toHaveBeenCalledWith("npm i -g ai-whisper");
		expect(screen.queryByRole("switch")).not.toBeInTheDocument();
	});

	it("installed-off: toggle enables the plugin", () => {
		const onToggle = vi.fn();
		render(
			<PluginCard
				descriptor={descriptor}
				snapshot={{
					id: "whisper",
					enabled: false,
					installPath: "/x",
					status: { state: "installed-off", version: "0.6.0" },
				}}
				onToggle={onToggle}
				onInstall={vi.fn()}
				onReprobe={vi.fn()}
			/>,
		);
		expect(screen.getByText(/installed, off/)).toBeInTheDocument();
		expect(screen.getByText(/0\.6\.0/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("switch"));
		expect(onToggle).toHaveBeenCalledWith("whisper", true);
	});

	it("on-healthy limited: shows the limited hint", () => {
		render(
			<PluginCard
				descriptor={descriptor}
				snapshot={{
					id: "whisper",
					enabled: true,
					installPath: "/x",
					status: { state: "on-healthy", version: "0.6.0", limited: true },
				}}
				onToggle={vi.fn()}
				onInstall={vi.fn()}
				onReprobe={vi.fn()}
			/>,
		);
		expect(
			screen.getByText(/limited \(upgrade for live events\)/),
		).toBeInTheDocument();
	});

	it("incompatible: shows the reason and a re-probe action", () => {
		const onReprobe = vi.fn();
		render(
			<PluginCard
				descriptor={descriptor}
				snapshot={{
					id: "whisper",
					enabled: true,
					installPath: "/x",
					status: {
						state: "incompatible",
						found: "db schema 7",
						required: "db schema 6 (update ai-14all)",
					},
				}}
				onToggle={vi.fn()}
				onInstall={vi.fn()}
				onReprobe={onReprobe}
			/>,
		);
		expect(
			screen.getByText(/db schema 6 \(update ai-14all\)/),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /re-probe/i }));
		expect(onReprobe).toHaveBeenCalled();
	});
});
