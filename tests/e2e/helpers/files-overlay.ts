import { expect, type Page } from "@playwright/test";

export async function openFilesOverlayViaChipBar(page: Page): Promise<void> {
	await page.getByRole("button", { name: /open files/i }).click();
	await expect(page.getByTestId("files-overlay")).toBeVisible();
}

export async function openFilesOverlayViaShortcut(page: Page): Promise<void> {
	const isMac = process.platform === "darwin";
	await page.keyboard.press(isMac ? "Meta+KeyP" : "Control+Shift+KeyP");
	await expect(page.getByTestId("files-overlay")).toBeVisible();
}

export async function closeFilesOverlay(page: Page): Promise<void> {
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("files-overlay")).toHaveCount(0);
}
