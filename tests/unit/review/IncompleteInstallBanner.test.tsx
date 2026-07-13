import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Provider } from "../../../src/features/review/hooks/use-agent-install-status";
import { IncompleteInstallBanner } from "../../../src/features/review/components/IncompleteInstallBanner";

function provider(overrides: Partial<Provider>): Provider {
	return {
		id: "codex",
		displayName: "Codex",
		cliAvailable: true,
		configRootDetected: true,
		installed: false,
		cliPath: null,
		cliSource: "path",
		...overrides,
	};
}

const noGap: Provider[] = [provider({ cliAvailable: false })];
const allInstalled: Provider[] = [provider({ installed: true })];
const oneGap: Provider[] = [provider({ id: "codex", displayName: "Codex" })];
const twoGaps: Provider[] = [
	provider({ id: "codex", displayName: "Codex" }),
	provider({ id: "claude-code", displayName: "Claude Code" }),
];

describe("IncompleteInstallBanner", () => {
	beforeEach(() => localStorage.clear());

	it("renders nothing when no CLI is detected", () => {
		const { container } = render(
			<IncompleteInstallBanner providers={noGap} onInstall={() => {}} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing when all detected providers are installed", () => {
		const { container } = render(
			<IncompleteInstallBanner providers={allInstalled} onInstall={() => {}} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("shows singular copy naming the gap provider", () => {
		render(<IncompleteInstallBanner providers={oneGap} onInstall={() => {}} />);
		expect(screen.getByText(/Connect Codex to ai-14all/i)).toBeInTheDocument();
	});

	it("shows plural copy with the count", () => {
		render(
			<IncompleteInstallBanner providers={twoGaps} onInstall={() => {}} />,
		);
		expect(
			screen.getByText(/2 agents aren't connected to ai-14all/i),
		).toBeInTheDocument();
	});

	it("fires onInstall from the Install button", () => {
		const onInstall = vi.fn();
		render(
			<IncompleteInstallBanner providers={oneGap} onInstall={onInstall} />,
		);
		fireEvent.click(screen.getByRole("button", { name: /install/i }));
		expect(onInstall).toHaveBeenCalledTimes(1);
	});

	it("dismiss hides the banner for the same gap", () => {
		const { rerender } = render(
			<IncompleteInstallBanner providers={oneGap} onInstall={() => {}} />,
		);
		fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
		rerender(
			<IncompleteInstallBanner providers={oneGap} onInstall={() => {}} />,
		);
		expect(
			screen.queryByTestId("incomplete-install-banner"),
		).not.toBeInTheDocument();
	});
});
