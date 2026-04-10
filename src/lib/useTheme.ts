import { useState, useEffect } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

function getSystemTheme(): ResolvedTheme {
	return window.matchMedia("(prefers-color-scheme: light)").matches
		? "light"
		: "dark";
}

function applyTheme(resolved: ResolvedTheme): void {
	document.documentElement.setAttribute("data-theme", resolved);
}

export function useTheme(): {
	resolvedTheme: ResolvedTheme;
	setTheme: (mode: ThemeMode) => void;
} {
	const [mode, setMode] = useState<ThemeMode>("system");
	// Lazy initializer: apply theme synchronously during render to prevent
	// a flash of unstyled content before the first useEffect fires.
	const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
		const resolved = getSystemTheme();
		applyTheme(resolved);
		return resolved;
	});

	useEffect(() => {
		const mql = window.matchMedia("(prefers-color-scheme: light)");

		const resolved: ResolvedTheme =
			mode === "system" ? (mql.matches ? "light" : "dark") : mode;
		setResolvedTheme(resolved);
		applyTheme(resolved);

		if (mode !== "system") return;

		const onChange = (e: Pick<MediaQueryListEvent, "matches">) => {
			const next: ResolvedTheme = e.matches ? "light" : "dark";
			setResolvedTheme(next);
			applyTheme(next);
		};

		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	}, [mode]);

	return { resolvedTheme, setTheme: setMode };
}
