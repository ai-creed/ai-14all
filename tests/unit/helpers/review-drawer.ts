import { fireEvent, screen } from "@testing-library/react";

/**
 * Idempotent helper: expands the review drawer if it is currently collapsed.
 * Safe to call multiple times. Synchronous — callers typically `await` the
 * Review region's presence before invoking this.
 *
 * The drawer defaults to `data-open="false"` on new sessions (Slice D). Tabs
 * (Files/Changes/Commits) are only mounted when the drawer is open, so unit
 * tests that interact with those tabs must ensure the drawer is expanded
 * first.
 */
export function ensureReviewDrawerOpen(): void {
	const region = screen.queryByRole("region", { name: "Review" });
	if (region?.getAttribute("data-open") !== "true") {
		const expand = screen.queryByRole("button", {
			name: /expand review drawer/i,
		});
		if (expand) fireEvent.click(expand);
	}
}
