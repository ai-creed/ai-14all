import { expect, type Page } from "@playwright/test";

/**
 * Idempotent helper: opens the review overlay if it is not currently open,
 * and waits for the slide-in entry animation (220ms CSS transition) to settle
 * so interactions with elements inside the portal don't race against
 * `transform: translateY(...)`.
 */
export async function ensureReviewOverlayOpen(page: Page): Promise<void> {
	const portal = page.getByTestId("review-expanded-portal");
	if (!(await portal.isVisible().catch(() => false))) {
		await page.getByRole("button", { name: /^open review$/i }).click();
	}
	await expect(portal).toBeVisible();
	await expect(portal).not.toHaveAttribute("data-leaving", "true");
	// CSS transition is 220ms; wait for the transform to fully settle.
	await page.waitForTimeout(250);
}
