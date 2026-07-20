import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const update = vi.fn();
const settings = {
	usageTelemetry: {
		enabled: true,
		includeUntracked: false,
		chipRange: "week",
		insights: { enabled: true, noticeShown: false },
	},
};
vi.mock("../../../../src/app/hooks/use-settings.js", () => ({
	useSettings: () => ({ settings, update }),
}));

import { InsightsNotice } from "../../../../src/app/components/InsightsNotice.js";
import { InsightsSettingsControls } from "../../../../src/features/settings/components/InsightsSettingsControls.js";

describe("InsightsNotice", () => {
	it("shows on notice; 'Manage in Settings' opens Settings, acknowledges, and dismisses", () => {
		const ack = vi.fn();
		const onOpenSettings = vi.fn();
		let fire: () => void = () => {};
		(window as unknown as { ai14all?: unknown }).ai14all = {
			insights: {
				ackNotice: ack,
				onNotice: (cb: () => void) => {
					fire = cb;
					return () => {};
				},
			},
		};
		render(<InsightsNotice onOpenSettings={onOpenSettings} />);
		expect(screen.queryByRole("status")).toBeNull();
		act(() => {
			fire();
		});
		expect(screen.getByRole("status")).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: /manage in settings/i }),
		);
		expect(onOpenSettings).toHaveBeenCalledTimes(1); // deep-links to the Settings dialog
		expect(ack).toHaveBeenCalledTimes(1); // and acknowledges (durable suppression)
		expect(screen.queryByRole("status")).toBeNull(); // and dismisses
	});

	it("shows on mount via pull-on-mount recovery when checkNoticePending resolves true", async () => {
		const onOpenSettings = vi.fn();
		(window as unknown as { ai14all?: unknown }).ai14all = {
			insights: {
				// No onNotice push fires in this test — the notice must appear purely
				// from the mount-time pull that recovers a boot-time push missed while
				// InsightsNotice was unmounted.
				onNotice: () => () => {},
				ackNotice: vi.fn(),
				checkNoticePending: () => Promise.resolve(true),
			},
		};
		render(<InsightsNotice onOpenSettings={onOpenSettings} />);
		expect(screen.queryByRole("status")).toBeNull(); // not shown synchronously
		expect(await screen.findByRole("status")).toBeInTheDocument(); // shown after the pull resolves
	});

	it("stays hidden on mount when checkNoticePending resolves false (already acknowledged)", async () => {
		const onOpenSettings = vi.fn();
		const checkNoticePending = vi.fn(() => Promise.resolve(false));
		(window as unknown as { ai14all?: unknown }).ai14all = {
			insights: {
				onNotice: () => () => {},
				ackNotice: vi.fn(),
				checkNoticePending,
			},
		};
		render(<InsightsNotice onOpenSettings={onOpenSettings} />);
		await act(async () => {
			await Promise.resolve();
		});
		expect(checkNoticePending).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("status")).toBeNull();
	});
});

describe("InsightsSettingsControls", () => {
	it("toggle persists the sub-preference via update(); delete calls deleteAll", () => {
		update.mockClear();
		const deleteAll = vi.fn();
		(window as unknown as { ai14all?: unknown }).ai14all = {
			insights: { deleteAll },
		};
		render(<InsightsSettingsControls />);
		fireEvent.click(screen.getByRole("checkbox", { name: /usage insights/i })); // toggle OFF
		expect(update).toHaveBeenCalledWith({
			usageTelemetry: {
				enabled: true,
				includeUntracked: false,
				chipRange: "week",
				insights: { enabled: false, noticeShown: false },
			},
		});
		fireEvent.click(
			screen.getByRole("button", { name: /delete insights data/i }),
		);
		expect(deleteAll).toHaveBeenCalled();
	});
});
