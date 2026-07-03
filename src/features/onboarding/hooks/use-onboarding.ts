import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { Ai14AllDesktopApi } from "../../../../shared/contracts/commands";
import { workspace } from "../../../lib/desktop-client";
import { measureAnchor } from "../logic/measure-anchor";
import {
	coachmarkVisible as computeCoachmarkVisible,
	computeTourVisible,
	dismissCoachmark as reduceDismiss,
	shouldRetroMark,
} from "../logic/onboarding-state";
import {
	clearDismissedCoachmarks,
	readDismissedCoachmarks,
	readTourVersionSeen,
	writeDismissedCoachmarks,
	writeTourVersionSeen,
} from "../logic/onboarding-storage";
import {
	CURRENT_TOUR_VERSION,
	TOUR_STEPS,
	type TourStep,
} from "../logic/tour-steps";

/**
 * In E2E runs the first-launch onboarding is suppressed by default so its
 * overlay/coachmarks never cover unrelated e2e flows (which all start from a
 * fresh profile and load a repo). A spec that exercises onboarding opts in with
 * AI14ALL_E2E_ONBOARDING=1, which flips this flag off in the preload. Always
 * false outside E2E, so real users are unaffected.
 */
function onboardingSuppressedInE2E(): boolean {
	try {
		return (
			(window as unknown as { __ai14allSuppressOnboarding?: boolean })
				.__ai14allSuppressOnboarding === true
		);
	} catch {
		return false;
	}
}

export interface Onboarding {
	tourVisible: boolean;
	steps: readonly TourStep[];
	stepIndex: number;
	next: () => void;
	back: () => void;
	skip: () => void;
	replay: () => void;
	resetHints: () => void;
	isCoachmarkVisible: (id: string) => boolean;
	dismissCoachmark: (id: string) => void;
}

export function useOnboarding(params: {
	sessionViewMounted: boolean;
}): Onboarding {
	const { sessionViewMounted } = params;
	const [tourVersionSeen, setTourVersionSeen] = useState<number | null>(
		readTourVersionSeen,
	);
	const [migrationChecked, setMigrationChecked] = useState(false);
	const [forceShow, setForceShow] = useState(false);
	const [stepIndex, setStepIndex] = useState(0);
	const [dismissed, setDismissed] = useState<string[]>(readDismissedCoachmarks);
	const [firstAnchorMeasurable, setFirstAnchorMeasurable] = useState(false);

	// Run-once-per-mount retro-mark migration. Runs whatever the current screen
	// is, so an upgrading user is marked seen before the session view can mount.
	// Gating auto-show on `migrationChecked` prevents a flash before this
	// settles. NB: deliberately no cross-mount ref guard — under React
	// StrictMode's dev double-mount, such a guard lets the first mount's cleanup
	// cancel the only in-flight read, so `.finally` never sets
	// `migrationChecked` and the tour never auto-shows in `pnpm dev`. The empty
	// dependency array already limits this to once per real mount, and
	// `readRestoreState` is a cheap idempotent read, so a dev-only second read
	// is harmless.
	useEffect(() => {
		let cancelled = false;
		void workspace
			.readRestoreState()
			.then((state) => {
				if (cancelled) return;
				if (
					shouldRetroMark({
						tourVersionSeen: readTourVersionSeen(),
						workspaceCount: state.workspaces.length,
					})
				) {
					writeTourVersionSeen(CURRENT_TOUR_VERSION);
					setTourVersionSeen(CURRENT_TOUR_VERSION);
				}
			})
			.catch(() => {
				/* restore-state read failed — leave onboarding untouched */
			})
			.finally(() => {
				if (!cancelled) setMigrationChecked(true);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// First-anchor measurability: the tour must not auto-show until the first
	// required anchor has actually painted in the mounted session view. Parent
	// effects run after child commits, so a single measurement here already sees
	// the sidebar DOM; a resize listener re-measures on later layout changes.
	useLayoutEffect(() => {
		if (!sessionViewMounted) {
			setFirstAnchorMeasurable(false);
			return;
		}
		const measure = () =>
			setFirstAnchorMeasurable(measureAnchor(TOUR_STEPS[0].anchorId) !== null);
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [sessionViewMounted]);

	const suppressed = onboardingSuppressedInE2E();
	const tourVisible =
		!suppressed &&
		computeTourVisible({
			tourVersionSeen,
			forceShow,
			sessionViewMounted,
			migrationChecked,
			firstAnchorMeasurable,
		});

	const finish = useCallback(() => {
		writeTourVersionSeen(CURRENT_TOUR_VERSION);
		setTourVersionSeen(CURRENT_TOUR_VERSION);
		setForceShow(false);
		setStepIndex(0);
	}, []);

	const next = useCallback(() => {
		if (stepIndex >= TOUR_STEPS.length - 1) finish();
		else setStepIndex(stepIndex + 1);
	}, [stepIndex, finish]);

	const back = useCallback(() => {
		setStepIndex((i) => Math.max(0, i - 1));
	}, []);

	const skip = useCallback(() => finish(), [finish]);

	const replay = useCallback(() => {
		setStepIndex(0);
		setForceShow(true);
	}, []);

	const resetHints = useCallback(() => {
		clearDismissedCoachmarks();
		setDismissed([]);
	}, []);

	const dismissCoachmark = useCallback((id: string) => {
		setDismissed((prev) => {
			const nextIds = reduceDismiss(prev, id);
			writeDismissedCoachmarks(nextIds);
			return nextIds;
		});
	}, []);

	const isCoachmarkVisible = useCallback(
		(id: string) =>
			!suppressed && computeCoachmarkVisible(dismissed, id, tourVisible),
		[suppressed, dismissed, tourVisible],
	);

	// Help-menu / shortcuts-overlay bridge. Optional-chained so non-Electron
	// contexts (unit tests) need no stub.
	useEffect(() => {
		const bridge = (window.ai14all as Ai14AllDesktopApi | undefined)?.events;
		const offShow = bridge?.onShowWelcomeTour?.(replay);
		const offReset = bridge?.onResetOnboardingHints?.(resetHints);
		return () => {
			offShow?.();
			offReset?.();
		};
	}, [replay, resetHints]);

	return {
		tourVisible,
		steps: TOUR_STEPS,
		stepIndex,
		next,
		back,
		skip,
		replay,
		resetHints,
		isCoachmarkVisible,
		dismissCoachmark,
	};
}
