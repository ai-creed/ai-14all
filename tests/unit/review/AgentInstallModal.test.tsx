import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentInstallModal } from "../../../src/features/review/components/AgentInstallModal";
import type { AgentInstallStatus } from "../../../src/features/review/hooks/use-agent-install-status";

function makeStatus(
	installResults: Array<{
		id: "claude-code" | "codex" | "ezio";
		ok: boolean;
		message: string | null;
	}>,
): AgentInstallStatus {
	return {
		providers: [
			{
				id: "claude-code",
				displayName: "Claude Code",
				cliAvailable: true,
				configRootDetected: true,
				installed: true,
				cliPath: "/usr/local/bin/claude",
				cliSource: "path",
			},
		],
		mcpPort: 9999,
		bindError: null,
		refresh: vi.fn(async () => {}),
		install: vi.fn(async () => installResults),
		uninstall: vi.fn(async () => []),
		pickCliPath: vi.fn(async () => ({ canceled: true, path: null })),
		setCliOverride: vi.fn(async () => ({
			providers: [],
			mcp: { port: 9999, bindError: null },
		})),
	};
}

async function installViaModal(status: AgentInstallStatus) {
	render(<AgentInstallModal open onClose={() => {}} status={status} />);
	fireEvent.click(screen.getByRole("checkbox"));
	fireEvent.click(screen.getByRole("button", { name: "Install" }));
}

describe("AgentInstallModal result rendering", () => {
	it("shows the status message instead of Installed when ok carries one", async () => {
		await installViaModal(
			makeStatus([
				{ id: "claude-code", ok: true, message: "Already up to date" },
			]),
		);
		expect(await screen.findByText("Already up to date")).toBeInTheDocument();
		expect(screen.queryByText(/^Installed/)).not.toBeInTheDocument();
	});

	it("keeps the Installed rendering when ok has no message", async () => {
		await installViaModal(
			makeStatus([{ id: "claude-code", ok: true, message: null }]),
		);
		expect(await screen.findByText(/Installed/)).toBeInTheDocument();
	});

	it("still renders failures as Failed: <message>", async () => {
		await installViaModal(
			makeStatus([{ id: "claude-code", ok: false, message: "boom" }]),
		);
		expect(await screen.findByText("Failed: boom")).toBeInTheDocument();
	});
});
