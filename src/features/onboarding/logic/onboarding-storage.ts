const TOUR_VERSION_KEY = "ai14all.onboarding.tourVersionSeen";
const DISMISSED_COACHMARKS_KEY = "ai14all.onboarding.dismissedCoachmarks";

export function readTourVersionSeen(): number | null {
	try {
		const raw = localStorage.getItem(TOUR_VERSION_KEY);
		if (raw === null) return null;
		const n = Number.parseInt(raw, 10);
		return Number.isNaN(n) ? null : n;
	} catch {
		return null;
	}
}

export function writeTourVersionSeen(version: number): void {
	try {
		localStorage.setItem(TOUR_VERSION_KEY, String(version));
	} catch {
		/* storage unavailable (e.g. private mode) — keep in-memory state */
	}
}

export function readDismissedCoachmarks(): string[] {
	try {
		const raw = localStorage.getItem(DISMISSED_COACHMARKS_KEY);
		if (raw === null) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((x): x is string => typeof x === "string")
			: [];
	} catch {
		return [];
	}
}

export function writeDismissedCoachmarks(ids: readonly string[]): void {
	try {
		localStorage.setItem(DISMISSED_COACHMARKS_KEY, JSON.stringify(ids));
	} catch {
		/* storage unavailable — keep in-memory state */
	}
}

export function clearDismissedCoachmarks(): void {
	try {
		localStorage.removeItem(DISMISSED_COACHMARKS_KEY);
	} catch {
		/* ignore */
	}
}
