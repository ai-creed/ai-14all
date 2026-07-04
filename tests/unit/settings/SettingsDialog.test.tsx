import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SettingsDialog } from "../../../src/features/settings/components/SettingsDialog";
import { SettingsProvider } from "../../../src/app/hooks/use-settings";
import { DEFAULT_PERSISTED_SETTINGS } from "../../../shared/models/persisted-settings";

beforeEach(() => {
	(window as never as Record<string, unknown>).ai14all = {
		settings: {
			initial: DEFAULT_PERSISTED_SETTINGS,
			read: vi.fn().mockResolvedValue({ settings: DEFAULT_PERSISTED_SETTINGS, firstRun: false }),
			write: vi.fn().mockImplementation(async (patch) => ({ ...DEFAULT_PERSISTED_SETTINGS, ...patch })),
		},
		events: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
	};
});

describe("SettingsDialog", () => {
	it("renders the four groups and writes through on change", async () => {
		render(
			<SettingsProvider>
				<SettingsDialog open onOpenChange={() => {}} />
			</SettingsProvider>,
		);
		expect(screen.getByText("Appearance")).toBeInTheDocument();
		expect(screen.getByText("Startup")).toBeInTheDocument();
		expect(screen.getByText("Agents")).toBeInTheDocument();
		expect(screen.getByText("Usage")).toBeInTheDocument();

		await userEvent.selectOptions(
			screen.getByLabelText("Conversation resume"),
			"manual",
		);
		const api = (window as never as { ai14all: { settings: { write: ReturnType<typeof vi.fn> } } })
			.ai14all;
		expect(api.settings.write).toHaveBeenCalledWith({ agentResume: "manual" });
	});
});
