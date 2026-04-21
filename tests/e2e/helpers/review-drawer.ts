import { expect, type Page } from "@playwright/test";

/**
 * Idempotent helper: expands the review drawer if it is currently collapsed.
 * Safe to call multiple times.
 *
 * The drawer defaults to `data-open="false"` on new sessions (Slice D). Tabs
 * (Files/Changes/Commits) are only mounted when the drawer is open, so tests
 * that interact with those tabs must ensure the drawer is expanded first.
 */
export async function ensureReviewDrawerOpen(page: Page): Promise<void> {
	const review = page.getByRole("region", { name: "Review" });
	if ((await review.getAttribute("data-open")) !== "true") {
		await page.getByRole("button", { name: /expand review drawer/i }).click();
	}
	await expect(review).toHaveAttribute("data-open", "true");
}
