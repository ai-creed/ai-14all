import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readRestoreState = vi.fn();
vi.mock("../../../src/lib/desktop-client", () => ({
	workspace: { readRestoreState: () => readRestoreState() },
	terminals: {},
}));

import { useOnboarding } from "../../../src/features/onboarding/hooks/use-onboarding";
import { CURRENT_TOUR_VERSION } from "../../../src/features/onboarding/logic/tour-steps";

const SEEN = String(CURRENT_TOUR_VERSION);
const KEY = "ai14all.onboarding.tourVersionSeen";
const DISMISSED = "ai14all.onboarding.dismissedCoachmarks";

function stateWith(workspaceCount: number) {
	return {
		version: 2,
		restorePreference: "alwaysRestore",
		activeWorkspaceId: null,
		workspaceOrder: [],
		workspaces: Array.from({ length: workspaceCount }, (_, i) => ({
			workspaceId: `w${i}`,
		})),
	};
}

/** Mount the first tour anchor so `firstAnchorMeasurable` resolves true. */
function mountFirstAnchor() {
	const el = document.createElement("div");
	el.setAttribute("data-tour", "sidebar-tree");
	document.body.appendChild(el);
}

beforeEach(() => {
	localStorage.clear();
	document.body.innerHTML = "";
	mountFirstAnchor();
	readRestoreState.mockReset();
	readRestoreState.mockResolvedValue(stateWith(0));
	(window as unknown as { ai14all?: unknown }).ai14all = undefined;
});
afterEach(() => {
	document.body.innerHTML = "";
	(window as unknown as { ai14all?: unknown }).ai14all = undefined;
});

describe("useOnboarding — arm-then-show", () => {
	it("stays hidden on the setup screen even when armed", async () => {
		const { result } = renderHook(() =>
			useOnboarding({ sessionViewMounted: false }),
		);
		await waitFor(() => expect(readRestoreState).toHaveBeenCalled());
		expect(result.current.tourVisible).toBe(false);
	});

	it("fires once the session view mounts for a fresh profile", async () => {
		const { result, rerender } = renderHook(
			({ mounted }) => useOnboarding({ sessionViewMounted: mounted }),
			{ initialProps: { mounted: false } },
		);
		await waitFor(() => expect(readRestoreState).toHaveBeenCalled());
		rerender({ mounted: true });
		await waitFor(() => expect(result.current.tourVisible).toBe(true));
	});

	it("does not auto-show until the first tour anchor is measurable", async () => {
		// Session view is logically mounted, but the first anchor has not painted.
		document.body.innerHTML = "";
		const { result } = renderHook(() =>
			useOnboarding({ sessionViewMounted: true }),
		);
		await waitFor(() => expect(readRestoreState).toHaveBeenCalled());
		expect(result.current.tourVisible).toBe(false);
		// The anchor appears; a resize re-measures and the tour becomes visible.
		act(() => {
			mountFirstAnchor();
			window.dispatchEvent(new Event("resize"));
		});
		await waitFor(() => expect(result.current.tourVisible).toBe(true));
	});

	it("retro-marks an existing-workspace profile silent", async () => {
		readRestoreState.mockResolvedValue(stateWith(2));
		const { result } = renderHook(() =>
			useOnboarding({ sessionViewMounted: true }),
		);
		await waitFor(() => expect(localStorage.getItem(KEY)).toBe(SEEN));
		expect(result.current.tourVisible).toBe(false);
	});

	it("persists seen on skip and hides", async () => {
		const { result } = renderHook(() =>
			useOnboarding({ sessionViewMounted: true }),
		);
		await waitFor(() => expect(result.current.tourVisible).toBe(true));
		act(() => result.current.skip());
		expect(localStorage.getItem(KEY)).toBe(SEEN);
		expect(result.current.tourVisible).toBe(false);
	});

	it("advances through steps and finishes on the last Next", async () => {
		const { result } = renderHook(() =>
			useOnboarding({ sessionViewMounted: true }),
		);
		await waitFor(() => expect(result.current.tourVisible).toBe(true));
		const total = result.current.steps.length;
		for (let i = 0; i < total; i++) act(() => result.current.next());
		expect(result.current.tourVisible).toBe(false);
		expect(localStorage.getItem(KEY)).toBe(SEEN);
	});

	it("clamps Back at the first step", async () => {
		const { result } = renderHook(() =>
			useOnboarding({ sessionViewMounted: true }),
		);
		await waitFor(() => expect(result.current.tourVisible).toBe(true));
		act(() => result.current.back());
		expect(result.current.stepIndex).toBe(0);
	});

	it("stays fully suppressed in E2E mode without the opt-in flag", async () => {
		const w = window as unknown as { __ai14allSuppressOnboarding?: boolean };
		w.__ai14allSuppressOnboarding = true;
		try {
			const { result } = renderHook(() =>
				useOnboarding({ sessionViewMounted: true }),
			);
			await waitFor(() => expect(readRestoreState).toHaveBeenCalled());
			expect(result.current.tourVisible).toBe(false);
			expect(result.current.isCoachmarkVisible("plugins")).toBe(false);
		} finally {
			w.__ai14allSuppressOnboarding = undefined;
		}
	});
});

describe("useOnboarding — coachmarks + replay", () => {
	it("hides coachmarks while the tour is visible, shows them after", async () => {
		const { result } = renderHook(() =>
			useOnboarding({ sessionViewMounted: true }),
		);
		await waitFor(() => expect(result.current.tourVisible).toBe(true));
		expect(result.current.isCoachmarkVisible("plugins")).toBe(false);
		act(() => result.current.skip());
		expect(result.current.isCoachmarkVisible("plugins")).toBe(true);
	});

	it("dismisses the leading coachmark, advances to the next, and persists it", async () => {
		localStorage.setItem(KEY, SEEN);
		const { result } = renderHook(() =>
			useOnboarding({ sessionViewMounted: true }),
		);
		await waitFor(() => expect(result.current.tourVisible).toBe(false));
		// Coachmarks surface one at a time: `plugins` leads. Dismissing it hides
		// `plugins`, promotes the next one (`telemetry`), and persists the dismissal.
		expect(result.current.isCoachmarkVisible("plugins")).toBe(true);
		act(() => result.current.dismissCoachmark("plugins"));
		expect(result.current.isCoachmarkVisible("plugins")).toBe(false);
		expect(result.current.isCoachmarkVisible("telemetry")).toBe(true);
		expect(JSON.parse(localStorage.getItem(DISMISSED) ?? "[]")).toContain(
			"plugins",
		);
	});

	it("replay re-shows the tour after it was seen", async () => {
		localStorage.setItem(KEY, SEEN);
		const { result } = renderHook(() =>
			useOnboarding({ sessionViewMounted: true }),
		);
		await waitFor(() => expect(result.current.tourVisible).toBe(false));
		act(() => result.current.replay());
		expect(result.current.tourVisible).toBe(true);
	});

	it("resetHints restores dismissed coachmarks", async () => {
		localStorage.setItem(KEY, SEEN);
		localStorage.setItem(DISMISSED, JSON.stringify(["plugins"]));
		const { result } = renderHook(() =>
			useOnboarding({ sessionViewMounted: true }),
		);
		await waitFor(() => expect(result.current.tourVisible).toBe(false));
		expect(result.current.isCoachmarkVisible("plugins")).toBe(false);
		act(() => result.current.resetHints());
		expect(result.current.isCoachmarkVisible("plugins")).toBe(true);
	});

	it("subscribes to the Help-menu replay bridge", async () => {
		let handler: (() => void) | undefined;
		(window as unknown as { ai14all?: unknown }).ai14all = {
			events: {
				onShowWelcomeTour: (h: () => void) => {
					handler = h;
					return () => {};
				},
				onResetOnboardingHints: () => () => {},
			},
		};
		localStorage.setItem(KEY, SEEN);
		const { result } = renderHook(() =>
			useOnboarding({ sessionViewMounted: true }),
		);
		await waitFor(() => expect(result.current.tourVisible).toBe(false));
		act(() => handler?.());
		expect(result.current.tourVisible).toBe(true);
	});
});
