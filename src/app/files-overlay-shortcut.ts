export type Platform = "mac" | "other";

export function detectPlatform(): Platform {
	if (typeof navigator === "undefined") return "other";
	return navigator.platform.toUpperCase().includes("MAC") ? "mac" : "other";
}

function targetOwnsTyping(target: HTMLElement | null): boolean {
	if (!target || typeof target.closest !== "function") return false;

	if (target.closest(".xterm")) return true;
	if (target.closest('[role="dialog"]')) return true;
	if (target.closest(".monaco-editor")) return true;
	if (target.closest('[contenteditable="true"]')) return true;
	if (target.closest('[role="textbox"]')) return true;

	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;

	return false;
}

export function isFilesOverlayShortcut(
	event: KeyboardEvent,
	platform: Platform,
): boolean {
	if (event.defaultPrevented) return false;

	const keyIsP = event.key === "p" || event.key === "P";
	if (!keyIsP) return false;
	if (event.altKey) return false;

	if (targetOwnsTyping(event.target as HTMLElement | null)) return false;

	if (platform === "mac") {
		return event.metaKey && !event.ctrlKey && !event.shiftKey;
	}
	return event.ctrlKey && event.shiftKey && !event.metaKey;
}
