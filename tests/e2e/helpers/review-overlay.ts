import { expect, type Page } from "@playwright/test";

/**
 * Idempotent helper: opens the review overlay if it is not currently open,
 * and waits for the slide-in entry animation (220ms CSS transition) to settle
 * so interactions with elements inside the portal don't race against
 * `transform: translateY(...)`.
 */
export async function ensureReviewOverlayOpen(page: Page): Promise<void> {
	const portal = page.getByTestId("review-expanded-portal");
	// A prior interaction (e.g. Esc) may have started a collapse — the portal is
	// still present but mid-leave. Let it fully unmount before re-opening so we
	// don't race the exit animation. Guard with count() first: it resolves
	// immediately, whereas getAttribute/waitFor auto-wait and would block for the
	// full timeout when the overlay is already closed (portal absent).
	if ((await portal.count()) > 0) {
		const leaving = await portal.getAttribute("data-leaving").catch(() => null);
		if (leaving === "true") {
			await portal
				.waitFor({ state: "detached", timeout: 5_000 })
				.catch(() => {});
		}
	}
	if (!(await portal.isVisible().catch(() => false))) {
		await page.getByRole("button", { name: /^open review$/i }).click();
	}
	await expect(portal).toBeVisible();
	await expect(portal).not.toHaveAttribute("data-leaving", "true");
	// CSS transition is 220ms; wait for the transform to fully settle.
	await page.waitForTimeout(250);
}
