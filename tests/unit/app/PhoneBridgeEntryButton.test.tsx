import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsProvider } from "../../../src/app/hooks/use-settings";
import { DEFAULT_PERSISTED_SETTINGS } from "../../../shared/models/persisted-settings";
import { PhoneBridgeEntryButton } from "../../../src/app/components/PhoneBridgeEntryButton";

function seedPhoneBridge(enabled: boolean) {
	(window as unknown as { ai14all?: unknown }).ai14all = {
		settings: {
			initial: { ...DEFAULT_PERSISTED_SETTINGS, phoneBridge: { enabled } },
		},
	};
}
afterEach(() => {
	(window as unknown as { ai14all?: unknown }).ai14all = undefined;
});

describe("PhoneBridgeEntryButton (settings-gated)", () => {
	it("renders no button when settings.phoneBridge.enabled is false", () => {
		seedPhoneBridge(false);
		render(
			<SettingsProvider>
				<PhoneBridgeEntryButton onOpen={vi.fn()} />
			</SettingsProvider>,
		);
		expect(
			screen.queryByRole("button", { name: "Open Phone Bridge panel" }),
		).toBeNull();
	});

	it("renders the button wired to onOpen when settings.phoneBridge.enabled is true", () => {
		seedPhoneBridge(true);
		const onOpen = vi.fn();
		render(
			<SettingsProvider>
				<PhoneBridgeEntryButton onOpen={onOpen} />
			</SettingsProvider>,
		);
		screen.getByRole("button", { name: "Open Phone Bridge panel" }).click();
		expect(onOpen).toHaveBeenCalledTimes(1);
	});
});
