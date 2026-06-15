import { shell } from "electron";

export type NavigationDecision = "internal" | "external" | "block";

// Schemes we hand to the OS default browser / mail client. Everything else is
// blocked outright rather than opened, so the renderer can never be coerced into
// running file:/javascript:/data: targets.
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Decide what should happen when the renderer tries to navigate to `targetUrl`
 * from the app page currently at `appUrl`.
 *
 * - "internal": the app's own document (same protocol + origin + pathname, i.e.
 *   a reload, a `?query` or `#hash` change) — allow it. The SPA's own route
 *   changes use the history API and never reach `will-navigate` anyway.
 * - "external": an http/https/mailto link — open it in the user's default
 *   browser instead of inside the app.
 * - "block": anything else (file:, javascript:, data:, about:, devtools:, or a
 *   same-origin but *different* document) — cancel it so the app shell can never
 *   be replaced by a web page or local file with no way back.
 */
export function classifyNavigation(
	targetUrl: string,
	appUrl: string,
): NavigationDecision {
	let target: URL;
	try {
		target = new URL(targetUrl);
	} catch {
		return "block";
	}
	let app: URL | null = null;
	try {
		app = new URL(appUrl);
	} catch {
		app = null;
	}
	if (
		app &&
		target.protocol === app.protocol &&
		target.origin === app.origin &&
		target.pathname === app.pathname
	) {
		return "internal";
	}
	return EXTERNAL_SCHEMES.has(target.protocol) ? "external" : "block";
}

export interface GuardableWebContents {
	on(
		event: "will-navigate",
		listener: (event: { preventDefault(): void }, url: string) => void,
	): unknown;
	setWindowOpenHandler(
		handler: (details: { url: string }) => { action: "deny" },
	): void;
	getURL(): string;
}

export interface NavigationGuardOptions {
	/** Defaults to Electron's `shell.openExternal`. */
	openExternal?: (url: string) => unknown;
	/** Live app URL; defaults to reading it from the webContents. */
	getAppUrl?: () => string;
}

/**
 * Force every navigation that would leave the app shell to open in the user's
 * default browser instead of inside this Electron window.
 *
 * Without this, clicking a link in rendered content (markdown preview, a code
 * file) navigates the renderer itself to that URL — turning the app into a stuck
 * embedded browser with no back button. We intercept both navigation paths:
 *   - `will-navigate`: an `<a>` click / `location` assignment that would replace
 *     the current document.
 *   - `setWindowOpenHandler`: `window.open` / `target="_blank"`, which would
 *     otherwise spawn a new embedded Electron window.
 *
 * Note: this opens user-clicked links via `shell.openExternal` directly and so
 * allows any http/https/mailto target. That is deliberately more permissive than
 * the `system:openExternal` IPC (locked to github.com), which guards against a
 * compromised renderer *programmatically* opening arbitrary URLs — a different
 * trust context from a user clicking a link they can see.
 */
export function installNavigationGuard(
	webContents: GuardableWebContents,
	options: NavigationGuardOptions = {},
): void {
	const openExternal =
		options.openExternal ??
		((url: string): void => {
			void shell.openExternal(url).catch(() => undefined);
		});
	const getAppUrl = options.getAppUrl ?? ((): string => webContents.getURL());

	const route = (url: string): NavigationDecision => {
		const decision = classifyNavigation(url, getAppUrl());
		if (decision === "external") openExternal(url);
		return decision;
	};

	webContents.on("will-navigate", (event, url) => {
		if (route(url) !== "internal") event.preventDefault();
	});

	webContents.setWindowOpenHandler(({ url }) => {
		route(url);
		return { action: "deny" };
	});
}
