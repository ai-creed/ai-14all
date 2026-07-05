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

	it("renders the Usage include-untracked checkbox and writes the full merged usageTelemetry", async () => {
		render(
			<SettingsProvider>
				<SettingsDialog open onOpenChange={() => {}} />
			</SettingsProvider>,
		);
		const checkbox = screen.getByLabelText("include untracked");
		expect(checkbox).toBeInTheDocument();

		await userEvent.click(checkbox);

		const api = (window as never as { ai14all: { settings: { write: ReturnType<typeof vi.fn> } } })
			.ai14all;
		// Writes the full merged usageTelemetry object (not a bare sub-patch), so
		// SettingsService.writeState()'s deep-merge sees every field.
		expect(api.settings.write).toHaveBeenCalledWith({
			usageTelemetry: {
				enabled: DEFAULT_PERSISTED_SETTINGS.usageTelemetry.enabled,
				includeUntracked: true,
				chipRange: DEFAULT_PERSISTED_SETTINGS.usageTelemetry.chipRange,
			},
		});
	});

	it("renders the Usage chip-range select and writes the full merged usageTelemetry", async () => {
		render(
			<SettingsProvider>
				<SettingsDialog open onOpenChange={() => {}} />
			</SettingsProvider>,
		);
		const select = screen.getByLabelText("Chip range");
		expect(select).toBeInTheDocument();

		await userEvent.selectOptions(select, "month");

		const api = (window as never as { ai14all: { settings: { write: ReturnType<typeof vi.fn> } } })
			.ai14all;
		expect(api.settings.write).toHaveBeenCalledWith({
			usageTelemetry: {
				enabled: DEFAULT_PERSISTED_SETTINGS.usageTelemetry.enabled,
				includeUntracked: DEFAULT_PERSISTED_SETTINGS.usageTelemetry.includeUntracked,
				chipRange: "month",
			},
		});
	});
});
