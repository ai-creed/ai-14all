/**
 * Bump this when the tour is meaningfully redesigned so it re-fires for everyone
 * exactly once, without resurrecting a previously-seen older version.
 */
export const CURRENT_TOUR_VERSION = 1;

export interface TourStep {
	/** Stable identity for tests and step tracking. */
	id: string;
	/** The `data-tour` anchor this step spotlights. */
	anchorId: string;
	title: string;
	body: string;
	/** 0-based position in the sequence. */
	order: number;
}

export const TOUR_STEPS: readonly TourStep[] = [
	{
		id: "sessions-isolated",
		anchorId: "sidebar-tree",
		title: "Sessions are isolated",
		body: "Each workspace is a repo; each session is its own git worktree, fully isolated.",
		order: 0,
	},
	{
		id: "mount-agent",
		anchorId: "agent-launcher",
		title: "Mount an agent",
		body: "Click + to start Claude, Codex, or ezio in the focused terminal. Mount two for a collab.",
		order: 1,
	},
	{
		id: "needs-you",
		anchorId: "session-row",
		title: "Know who needs you",
		body: 'The attention dot and "needs you" badge surface the session waiting on you.',
		order: 2,
	},
	{
		id: "review-in-window",
		anchorId: "review-bar",
		title: "Review without leaving",
		body: "Inspect diffs and comment in-window — no context switch.",
		order: 3,
	},
];
