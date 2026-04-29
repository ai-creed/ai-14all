// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentInstallModal } from "../../../src/features/review/components/AgentInstallModal";
import type { AgentInstallStatus } from "../../../src/features/review/hooks/use-agent-install-status";

function makeStatus(
	overrides: Partial<AgentInstallStatus> = {},
): AgentInstallStatus {
	const refresh = vi.fn(async () => {});
	return {
		providers: [
			{
				id: "claude-code",
				displayName: "Claude Code",
				cliAvailable: false,
				configRootDetected: false,
				installed: false,
				cliPath: null,
				cliSource: "none",
			},
			{
				id: "codex",
				displayName: "Codex",
				cliAvailable: true,
				configRootDetected: true,
				installed: false,
				cliPath: "/usr/local/bin/codex",
				cliSource: "path",
			},
		],
		mcpPort: 9999,
		bindError: null,
		refresh,
		install: vi.fn(async () => []),
		uninstall: vi.fn(async () => []),
		pickCliPath: vi.fn(async () => ({ canceled: true, path: null })),
		setCliOverride: vi.fn(async () => ({
			providers: [],
			mcp: { port: 9999, bindError: null },
		})),
		...overrides,
	};
}

describe("AgentInstallModal — Locate CLI", () => {
	it("shows Locate CLI button only when cliAvailable=false", () => {
		const status = makeStatus();
		render(<AgentInstallModal open onClose={() => {}} status={status} />);
		expect(screen.getByText(/Locate Claude Code CLI…/)).toBeTruthy();
		expect(screen.queryByText(/Locate Codex CLI…/)).toBeNull();
	});

	it("clicking Locate calls pickCliPath then setCliOverride", async () => {
		const status = makeStatus({
			pickCliPath: vi.fn(async () => ({
				canceled: false,
				path: "/Users/x/.claude/local/claude",
			})),
			setCliOverride: vi.fn(async () => ({
				providers: [],
				mcp: { port: 9999, bindError: null },
			})),
		});
		render(<AgentInstallModal open onClose={() => {}} status={status} />);
		await userEvent.click(screen.getByText(/Locate Claude Code CLI…/));
		await waitFor(() => {
			expect(status.pickCliPath).toHaveBeenCalledWith("claude-code");
			expect(status.setCliOverride).toHaveBeenCalledWith(
				"claude-code",
				"/Users/x/.claude/local/claude",
			);
		});
	});

	it("does nothing when picker is canceled", async () => {
		const status = makeStatus({
			pickCliPath: vi.fn(async () => ({ canceled: true, path: null })),
		});
		render(<AgentInstallModal open onClose={() => {}} status={status} />);
		await userEvent.click(screen.getByText(/Locate Claude Code CLI…/));
		expect(status.setCliOverride).not.toHaveBeenCalled();
	});

	it("surfaces error when setCliOverride throws", async () => {
		const status = makeStatus({
			pickCliPath: vi.fn(async () => ({
				canceled: false,
				path: "/bad/path",
			})),
			setCliOverride: vi.fn(async () => {
				throw new Error("Path does not exist: /bad/path");
			}),
		});
		render(<AgentInstallModal open onClose={() => {}} status={status} />);
		await userEvent.click(screen.getByText(/Locate Claude Code CLI…/));
		expect(await screen.findByText(/Path does not exist/)).toBeTruthy();
	});
});
