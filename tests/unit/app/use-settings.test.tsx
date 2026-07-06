import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	SettingsProvider,
	useSettings,
} from "../../../src/app/hooks/use-settings";
import { DEFAULT_PERSISTED_SETTINGS } from "../../../shared/models/persisted-settings";

function installBridge(overrides: { initialFirstRun?: boolean } = {}) {
	const write = vi.fn().mockImplementation(async (patch) => ({
		...DEFAULT_PERSISTED_SETTINGS,
		theme: "warm",
		...patch,
	}));
	const read = vi.fn().mockResolvedValue({
		settings: { ...DEFAULT_PERSISTED_SETTINGS, theme: "warm" },
		firstRun: false,
	});
	(window as never as Record<string, unknown>).ai14all = {
		settings: {
			initial: { ...DEFAULT_PERSISTED_SETTINGS, theme: "warm" },
			initialFirstRun: overrides.initialFirstRun ?? false,
			read,
			write,
		},
		events: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
	};
	return { write, read };
}

describe("useSettings", () => {
	beforeEach(() => {
		localStorage.clear();
		installBridge();
	});

	it("boots from settings.initial synchronously", () => {
		const { result } = renderHook(() => useSettings(), {
			wrapper: SettingsProvider,
		});
		expect(result.current.settings.theme).toBe("warm");
	});

	it("update() writes through and applies the merged result", async () => {
		const { result } = renderHook(() => useSettings(), {
			wrapper: SettingsProvider,
		});
		await act(() => result.current.update({ agentResume: "off" }));
		expect(result.current.settings.agentResume).toBe("off");
	});

	it("does not migrate the legacy font-size value when initialFirstRun is false", () => {
		localStorage.setItem("ai14all.terminalFontSize", "15");
		const { write } = installBridge({ initialFirstRun: false });

		renderHook(() => useSettings(), { wrapper: SettingsProvider });

		expect(write).not.toHaveBeenCalled();
	});

	it("migrates the legacy font-size value on the first run after upgrading", () => {
		localStorage.setItem("ai14all.terminalFontSize", "15");
		const { write } = installBridge({ initialFirstRun: true });

		renderHook(() => useSettings(), { wrapper: SettingsProvider });

		expect(write).toHaveBeenCalledWith({ terminalFontSize: 15 });
	});

	it("skips the migration write when no legacy font-size value is stored", () => {
		const { write } = installBridge({ initialFirstRun: true });

		renderHook(() => useSettings(), { wrapper: SettingsProvider });

		expect(write).not.toHaveBeenCalled();
	});
});
