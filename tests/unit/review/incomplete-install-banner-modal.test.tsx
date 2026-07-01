import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { IncompleteInstallBanner } from "../../../src/features/review/components/IncompleteInstallBanner";
import { AgentInstallModal } from "../../../src/features/review/components/AgentInstallModal";
import type { AgentInstallStatus } from "../../../src/features/review/hooks/use-agent-install-status";

function makeStatus(): AgentInstallStatus {
	return {
		providers: [
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
		refresh: vi.fn(async () => {}),
		install: vi.fn(async () => []),
		uninstall: vi.fn(async () => []),
		pickCliPath: vi.fn(async () => ({ canceled: true, path: null })),
		setCliOverride: vi.fn(async () => ({
			providers: [],
			mcp: { port: 9999, bindError: null },
		})),
	};
}

// Mirrors App.tsx's exact wiring: the banner's onInstall calls
// setInstallModalOpen(true), and <AgentInstallModal open={installModalOpen} .../>
// renders alongside it. Locks the spec §8 acceptance that clicking the banner's
// [Install…] makes the install modal visible.
function Harness() {
	const [open, setOpen] = useState(false);
	const status = makeStatus();
	return (
		<>
			<IncompleteInstallBanner
				providers={status.providers}
				onInstall={() => setOpen(true)}
			/>
			<AgentInstallModal
				open={open}
				onClose={() => setOpen(false)}
				status={status}
			/>
		</>
	);
}

describe("IncompleteInstallBanner → install modal wiring", () => {
	beforeEach(() => localStorage.clear());

	it("opens the install modal when [Install…] is clicked", async () => {
		render(<Harness />);
		// Modal closed → no "Close" buttons present (neither footer nor dialog ×).
		// (Title-agnostic, so this holds regardless of the Task 4 copy reword.)
		expect(
			screen.queryAllByRole("button", { name: "Close" }),
		).toHaveLength(0);
		// The banner's Install… is the only Install button while the modal is closed.
		fireEvent.click(screen.getByRole("button", { name: /install/i }));
		// The modal is now visible — at least one "Close" button is present
		// (AgentInstallModal renders both a footer Close and a dialog × Close).
		const closeBtns = await screen.findAllByRole("button", { name: "Close" });
		expect(closeBtns.length).toBeGreaterThan(0);
	});
});
