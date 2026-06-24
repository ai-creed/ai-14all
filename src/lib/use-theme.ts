import { useState, useEffect } from "react";
import type { Ai14AllDesktopApi } from "../../shared/contracts/commands";

export type ThemeMode = "light" | "dark" | "system" | "warm" | "tui";
export type ResolvedTheme = "light" | "dark";
/** The value applied to the document's data-theme attribute. */
export type Palette = "light" | "dark" | "warm" | "tui";

function getSystemTheme(): ResolvedTheme {
	return window.matchMedia("(prefers-color-scheme: light)").matches
		? "light"
		: "dark";
}

function paletteForMode(mode: ThemeMode): Palette {
	return mode === "system" ? getSystemTheme() : mode;
}

/** Monaco only understands light/dark; the dark-based warm palette maps to dark. */
function monacoThemeFor(palette: Palette): ResolvedTheme {
	return palette === "light" ? "light" : "dark";
}

function applyTheme(palette: Palette): void {
	document.documentElement.setAttribute("data-theme", palette);
}

export function useTheme(): {
	resolvedTheme: ResolvedTheme;
	/** The palette applied to data-theme — includes "warm" (unlike resolvedTheme). */
	palette: Palette;
	setTheme: (mode: ThemeMode) => void;
} {
	const [mode, setMode] = useState<ThemeMode>("system");
	// Lazy initializer: apply theme synchronously during render to prevent
	// a flash of unstyled content before the first useEffect fires.
	const [palette, setPalette] = useState<Palette>(() => {
		const next = paletteForMode("system");
		applyTheme(next);
		return next;
	});

	useEffect(() => {
		const mql = window.matchMedia("(prefers-color-scheme: light)");

		const next = paletteForMode(mode);
		applyTheme(next);
		setPalette(next);

		if (mode !== "system") return;

		const onChange = (e: Pick<MediaQueryListEvent, "matches">) => {
			const sys: Palette = e.matches ? "light" : "dark";
			applyTheme(sys);
			setPalette(sys);
		};

		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	}, [mode]);

	// React to theme picks from the application menu (sent over the preload
	// bridge). The bridge is absent in non-Electron contexts (e.g. unit tests).
	useEffect(() => {
		const bridge = (window.ai14all as Ai14AllDesktopApi | undefined)?.events;
		return bridge?.onSetTheme?.((next) => setMode(next));
	}, []);

	return { resolvedTheme: monacoThemeFor(palette), palette, setTheme: setMode };
}
