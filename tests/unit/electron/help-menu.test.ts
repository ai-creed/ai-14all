import { describe, expect, it, vi } from "vitest";
import {
	buildHelpSubmenu,
	HELP_RESET_ONBOARDING_CHANNEL,
	HELP_SHOW_TOUR_CHANNEL,
} from "../../../electron/main/help-menu";

interface Item {
	id?: string;
	label?: string;
	click?: () => void;
}

describe("buildHelpSubmenu", () => {
	it("builds a Help submenu with the two onboarding items", () => {
		const menu = buildHelpSubmenu(() => {});
		expect(menu.label).toBe("Help");
		const items = (menu.submenu as Item[]) ?? [];
		expect(items.find((i) => i.id === "help-show-welcome-tour")).toBeTruthy();
		expect(items.find((i) => i.id === "help-reset-onboarding")).toBeTruthy();
	});

	it("wires each item's click to its channel", () => {
		const send = vi.fn();
		const items = (buildHelpSubmenu(send).submenu as Item[]) ?? [];
		items.find((i) => i.id === "help-show-welcome-tour")?.click?.();
		items.find((i) => i.id === "help-reset-onboarding")?.click?.();
		expect(send).toHaveBeenNthCalledWith(1, HELP_SHOW_TOUR_CHANNEL);
		expect(send).toHaveBeenNthCalledWith(2, HELP_RESET_ONBOARDING_CHANNEL);
	});
});
