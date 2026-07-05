import { useCallback, useState, useEffect } from "react";
import type { Ai14AllDesktopApi } from "../../shared/contracts/commands";
import type { ThemeMode as PersistedThemeMode } from "../../shared/models/persisted-settings";
import { initialSettings } from "../app/hooks/use-settings";

// Re-exported so existing `import type { ThemeMode } from "../lib/use-theme"`
// call sites keep working while `shared/models/persisted-settings` stays the
// single source of truth for the type.
export type ThemeMode = PersistedThemeMode;
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
	mode: ThemeMode;
	setTheme: (mode: ThemeMode) => void;
} {
	const [mode, setMode] = useState<ThemeMode>(() => initialSettings().theme);
	// Lazy initializer: apply theme synchronously during render — using the same
	// persisted initial mode as `mode` above — to prevent a flash of the wrong
	// palette before the first useEffect fires.
	const [palette, setPalette] = useState<Palette>(() => {
		const next = paletteForMode(mode);
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

	const setTheme = useCallback((next: ThemeMode) => {
		setMode(next);
		void (window.ai14all as Ai14AllDesktopApi | undefined)?.settings
			?.write({ theme: next })
			.catch(() => {});
	}, []);

	// React to theme picks from the application menu (sent over the preload
	// bridge); write-through so the pick persists. The bridge is absent in
	// non-Electron contexts (e.g. unit tests).
	useEffect(() => {
		const bridge = (window.ai14all as Ai14AllDesktopApi | undefined)?.events;
		return bridge?.onSetTheme?.((next) => setTheme(next));
	}, [setTheme]);

	// Converge with settings changes written elsewhere (other windows, or this
	// window's own write above echoed back) without re-writing.
	useEffect(() => {
		const bridge = (window.ai14all as Ai14AllDesktopApi | undefined)?.events;
		return bridge?.onSettingsChanged?.((s) => setMode(s.theme));
	}, []);

	return {
		resolvedTheme: monacoThemeFor(palette),
		palette,
		mode,
		setTheme,
	};
}
