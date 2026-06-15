import { targetOwnsTyping } from "./target-owns-typing";

export type Platform = "mac" | "other";

export function detectPlatform(): Platform {
	if (typeof navigator === "undefined") return "other";
	return navigator.platform.toUpperCase().includes("MAC") ? "mac" : "other";
}

export function isFilesOverlayShortcut(
	event: KeyboardEvent,
	platform: Platform,
): boolean {
	if (event.defaultPrevented) return false;

	const keyIsP = event.key === "p" || event.key === "P";
	if (!keyIsP) return false;
	if (event.altKey) return false;

	// Cmd+P (Files) is global navigation that must fire even when the terminal
	// pane holds focus — allowXterm lets it through (the terminal binds no Cmd+P).
	if (
		targetOwnsTyping(event.target as HTMLElement | null, { allowXterm: true })
	)
		return false;

	if (platform === "mac") {
		return event.metaKey && !event.shiftKey && !event.ctrlKey;
	}
	return event.ctrlKey && event.shiftKey && !event.metaKey;
}
