import { fireEvent, screen } from "@testing-library/react";

/**
 * Idempotent helper: opens the review overlay if it is not currently open.
 * Safe to call multiple times. The overlay is rendered via createPortal to
 * document.body with data-testid="review-expanded-portal".
 */
export function ensureReviewOverlayOpen(): void {
	const portal = screen.queryByTestId("review-expanded-portal");
	if (portal) return;
	const open = screen.queryByRole("button", { name: /^open review$/i });
	if (open) fireEvent.click(open);
}
