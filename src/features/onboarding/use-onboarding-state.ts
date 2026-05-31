import { useCallback, useEffect, useState } from "react";

/**
 * Onboarding progress flags. Each step is a one-way latch: once a user has
 * passed it, it stays true forever (per local install). Used by FirstRunHint,
 * GuidedTour, HelpHint, and SystemCheckStrip to decide when to surface
 * contextual hints — and by the Preferences dialog to reset the whole flow.
 *
 * Persisted to localStorage under `STORAGE_KEY`. Storage is best-effort: if
 * localStorage is unavailable (private mode, disabled), we silently fall back
 * to in-memory state and behave as if every step is already complete (the
 * conservative choice — don't pester the user with no way to dismiss).
 */
export type OnboardingState = {
	repositoryLoaded: boolean;
	firstSessionCreated: boolean;
	firstShellSpawned: boolean;
	firstReviewOpened: boolean;
	tourCompleted: boolean;
	firstRunHintDismissed: boolean;
};

export type OnboardingStep = keyof OnboardingState;

const STORAGE_KEY = "ai14all.onboarding.v1";

const DEFAULT_STATE: OnboardingState = {
	repositoryLoaded: false,
	firstSessionCreated: false,
	firstShellSpawned: false,
	firstReviewOpened: false,
	tourCompleted: false,
	firstRunHintDismissed: false,
};

// Fallback when storage is unavailable: behave as if user has completed
// everything — silent rather than pestering with un-dismissable hints.
const COMPLETED_STATE: OnboardingState = {
	repositoryLoaded: true,
	firstSessionCreated: true,
	firstShellSpawned: true,
	firstReviewOpened: true,
	tourCompleted: true,
	firstRunHintDismissed: true,
};

function readState(): OnboardingState {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_STATE;
		const parsed = JSON.parse(raw) as Partial<OnboardingState>;
		return { ...DEFAULT_STATE, ...parsed };
	} catch {
		return COMPLETED_STATE;
	}
}

function writeState(state: OnboardingState): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// best-effort
	}
}

export function useOnboardingState() {
	const [state, setState] = useState<OnboardingState>(readState);

	// Sync across windows (defensive — Electron is single-window today).
	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (e.key !== STORAGE_KEY) return;
			setState(readState());
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const markStep = useCallback((step: OnboardingStep) => {
		setState((prev) => {
			if (prev[step]) return prev;
			const next = { ...prev, [step]: true };
			writeState(next);
			return next;
		});
	}, []);

	const reset = useCallback(() => {
		writeState(DEFAULT_STATE);
		setState(DEFAULT_STATE);
	}, []);

	return { state, markStep, reset };
}
