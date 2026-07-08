import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsProvider } from "../../../src/app/hooks/use-settings";
import { DEFAULT_PERSISTED_SETTINGS } from "../../../shared/models/persisted-settings";
import { PhoneBridgeDialogGate } from "../../../src/app/components/PhoneBridgeDialogGate";

vi.mock("../../../src/components/settings/PhoneBridgeDialog", () => ({
	PhoneBridgeDialog: (p: { open: boolean }) => (
		<div data-testid="phone-bridge-dialog" data-open={String(p.open)} />
	),
}));

function seedPhoneBridge(enabled: boolean) {
	(window as unknown as { ai14all?: unknown }).ai14all = {
		settings: { initial: { ...DEFAULT_PERSISTED_SETTINGS, phoneBridge: { enabled } } },
	};
}
afterEach(() => {
	(window as unknown as { ai14all?: unknown }).ai14all = undefined;
});

describe("PhoneBridgeDialogGate (settings-gated)", () => {
	it("renders no dialog when settings.phoneBridge.enabled is false", () => {
		seedPhoneBridge(false);
		render(
			<SettingsProvider>
				<PhoneBridgeDialogGate open onOpenChange={vi.fn()} />
			</SettingsProvider>,
		);
		expect(screen.queryByTestId("phone-bridge-dialog")).toBeNull();
	});

	it("renders PhoneBridgeDialog and forwards `open` when settings.phoneBridge.enabled is true", () => {
		seedPhoneBridge(true);
		render(
			<SettingsProvider>
				<PhoneBridgeDialogGate open onOpenChange={vi.fn()} />
			</SettingsProvider>,
		);
		expect(screen.getByTestId("phone-bridge-dialog").getAttribute("data-open")).toBe("true");
	});
});
