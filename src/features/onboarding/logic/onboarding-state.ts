import { COACHMARKS } from "./coachmarks";
import { CURRENT_TOUR_VERSION } from "./tour-steps";

/** The tour is armed when the user has never seen the current version. */
export function tourArmed(tourVersionSeen: number | null): boolean {
	return tourVersionSeen === null || tourVersionSeen < CURRENT_TOUR_VERSION;
}

/**
 * Arm-then-show gate. Auto-show requires the session view to be mounted, the
 * retro-mark migration to have settled, the FIRST required tour anchor to be
 * measurable in the DOM, and the tour to be armed. The first-anchor clause stops
 * the tour opening onto an empty frame (or auto-advancing/burning steps) before
 * the session view has painted its anchors. A replay (`forceShow`) bypasses the
 * armed/migration/anchor checks but still needs the session view mounted (that
 * is where the anchors live; the overlay's per-step skip handles any single
 * transiently-absent anchor).
 */
export function computeTourVisible(input: {
	tourVersionSeen: number | null;
	forceShow: boolean;
	sessionViewMounted: boolean;
	migrationChecked: boolean;
	firstAnchorMeasurable: boolean;
}): boolean {
	if (!input.sessionViewMounted) return false;
	if (input.forceShow) return true;
	return (
		input.migrationChecked &&
		input.firstAnchorMeasurable &&
		tourArmed(input.tourVersionSeen)
	);
}

/**
 * First-run migration: an upgrading user with saved workspaces but no seen-flag
 * is marked as having seen the tour so it never fires. A fresh profile is left
 * armed.
 */
export function shouldRetroMark(input: {
	tourVersionSeen: number | null;
	workspaceCount: number;
}): boolean {
	return input.tourVersionSeen === null && input.workspaceCount >= 1;
}

/** Idempotently add a coachmark id to the dismissed set (returns a new array). */
export function dismissCoachmark(
	dismissed: readonly string[],
	id: string,
): string[] {
	return dismissed.includes(id) ? [...dismissed] : [...dismissed, id];
}

/**
 * The single coachmark to surface right now: the first in canonical
 * (`COACHMARKS`) order that the user has not dismissed, or null once all are
 * dismissed. Coachmarks are shown one at a time so their cards never stack and
 * overlap in the top chrome.
 */
export function nextVisibleCoachmarkId(
	dismissed: readonly string[],
): string | null {
	return COACHMARKS.find((c) => !dismissed.includes(c.id))?.id ?? null;
}

/**
 * A coachmark shows only when the tour is inactive and it is the current leader
 * — the next undismissed coachmark in order. Exactly one is visible at a time.
 */
export function coachmarkVisible(
	dismissed: readonly string[],
	id: string,
	tourActive: boolean,
): boolean {
	return !tourActive && nextVisibleCoachmarkId(dismissed) === id;
}
