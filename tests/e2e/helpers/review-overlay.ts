import { expect, type Page } from "@playwright/test";

/**
 * Idempotent helper: opens the review overlay if it is not currently open.
 * Safe to call multiple times. The overlay is portaled to document.body
 * with data-testid="review-expanded-portal".
 */
export async function ensureReviewOverlayOpen(page: Page): Promise<void> {
	const portal = page.getByTestId("review-expanded-portal");
	if (!(await portal.isVisible().catch(() => false))) {
		await page.getByRole("button", { name: /^open review$/i }).click();
	}
	await expect(portal).toBeVisible();
}
