// Coverage footer copy (design spec §6). Every "since <date>" caption comes
// from a source's own retained anchor (services/insights/store/coverage-
// anchors.ts) — never from `firstCaptureAt`, which appears only in the
// retention-clip suffix and the empty-state condition (handled elsewhere).

import { startOfLocalDayMs } from "./bucketEdges";
import type { DomainAnchors } from "./bucketEdges";

export interface CoverageFooterInput {
	anchors: DomainAnchors;
	firstCaptureAt: number | null;
	windowFromMs: number;
	windowToMs: number;
	appComplete: boolean; // series completeness === "complete" for the window
}

const RETENTION_CLIP_GRACE_MS = 86_400_000; // 1 day

// "jul 21" — en-US short month lowercased + day.
export function formatShortDate(ms: number): string {
	return new Date(ms)
		.toLocaleDateString("en-US", { month: "short", day: "numeric" })
		.toLowerCase();
}

function appClause(appRetainedSinceMs: number | null): string {
	return appRetainedSinceMs === null
		? "no app time retained"
		: `app time since ${formatShortDate(appRetainedSinceMs)}`;
}

function runsClause(runsRetainedSinceMs: number | null): string {
	return runsRetainedSinceMs === null
		? "no runs retained"
		: `runs since ${formatShortDate(runsRetainedSinceMs)}`;
}

// Merge rule: only when both anchors are non-null AND fall on the same local
// day do the app/runs clauses combine into "app time & runs since <date>";
// otherwise each source states its own clause (never a blended date).
function appRunsClauses(
	appRetainedSinceMs: number | null,
	runsRetainedSinceMs: number | null,
): string[] {
	if (
		appRetainedSinceMs !== null &&
		runsRetainedSinceMs !== null &&
		startOfLocalDayMs(appRetainedSinceMs) ===
			startOfLocalDayMs(runsRetainedSinceMs)
	) {
		return [`app time & runs since ${formatShortDate(appRetainedSinceMs)}`];
	}
	return [appClause(appRetainedSinceMs), runsClause(runsRetainedSinceMs)];
}

export function deriveCoverageFooter(input: CoverageFooterInput): {
	glyph: "●" | "◐";
	text: string;
} {
	const { anchors, firstCaptureAt, windowFromMs, appComplete } = input;
	const { earliestDayMs, appRetainedSinceMs, runsRetainedSinceMs } = anchors;

	const clauses = appRunsClauses(appRetainedSinceMs, runsRetainedSinceMs);
	if (earliestDayMs !== null) {
		clauses.push(`tokens since ${formatShortDate(earliestDayMs)} (ledger)`);
	}

	const healthy =
		appComplete &&
		appRetainedSinceMs !== null &&
		appRetainedSinceMs <= windowFromMs;
	const glyph: "●" | "◐" = healthy ? "●" : "◐";
	const framing = healthy ? "capture healthy" : "mixed coverage";

	const retainedAnchors = [appRetainedSinceMs, runsRetainedSinceMs].filter(
		(v): v is number => v !== null,
	);
	const earliestRetained = retainedAnchors.length
		? Math.min(...retainedAnchors)
		: null;
	const clipped =
		firstCaptureAt !== null &&
		earliestRetained !== null &&
		firstCaptureAt < earliestRetained - RETENTION_CLIP_GRACE_MS;
	const suffix = clipped
		? ` (365-day retention; capture began ${formatShortDate(firstCaptureAt)})`
		: "";

	return { glyph, text: `${framing} — ${clauses.join(" · ")}${suffix}` };
}
