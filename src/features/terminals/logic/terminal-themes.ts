import type { ITheme } from "xterm";

/** The app palettes that the terminal cells follow (mirrors data-theme). */
export type TerminalPalette = "light" | "dark" | "warm" | "tui";

/**
 * xterm color themes per app palette so the terminal cells match the rest of
 * the chrome (a pure-black terminal looks especially off against light mode).
 * The terminal background is intentionally a step darker than each theme's
 * --app-bg so the terminal "screen" reads as a distinct sunken surface against
 * the surrounding chrome/sidebar; foreground tracks --text-primary and the
 * cursor uses the theme accent.
 */
const DARK: ITheme = {
	background: "#06090d",
	foreground: "#eef7fa",
	cursor: "#67d4b0",
	cursorAccent: "#06090d",
	selectionBackground: "rgba(103, 212, 176, 0.3)",
	black: "#1c2630",
	red: "#e06c75",
	green: "#98c379",
	yellow: "#e5c07b",
	blue: "#61afef",
	magenta: "#c678dd",
	cyan: "#56b6c2",
	white: "#cdd3de",
	brightBlack: "#5c6772",
	brightRed: "#ef7d87",
	brightGreen: "#a9d77f",
	brightYellow: "#f0cd8b",
	brightBlue: "#79c0ff",
	brightMagenta: "#d49be6",
	brightCyan: "#6fd0dd",
	brightWhite: "#ffffff",
};

const LIGHT: ITheme = {
	background: "#fbfcfd",
	foreground: "#1e2530",
	cursor: "#1a7fc1",
	cursorAccent: "#fbfcfd",
	selectionBackground: "rgba(26, 127, 193, 0.25)",
	black: "#2b2f36",
	red: "#c0392b",
	green: "#2e8b57",
	yellow: "#b8860b",
	blue: "#1a6fb0",
	magenta: "#9b4dca",
	cyan: "#1f8a8a",
	white: "#aeb6c2",
	brightBlack: "#4a5260",
	brightRed: "#d0432f",
	brightGreen: "#3aa564",
	brightYellow: "#c79a1f",
	brightBlue: "#2a86c9",
	brightMagenta: "#b25fe0",
	brightCyan: "#2aa9a9",
	brightWhite: "#dfe4ea",
};

const WARM: ITheme = {
	background: "#160f09",
	foreground: "#f6efe4",
	cursor: "#e58a5e",
	cursorAccent: "#160f09",
	selectionBackground: "rgba(229, 138, 94, 0.3)",
	black: "#2a231b",
	red: "#e0674f",
	green: "#9aaf6a",
	yellow: "#e0a857",
	blue: "#6fa8c7",
	magenta: "#c79be0",
	cyan: "#6cbcb8",
	white: "#e7ddcf",
	brightBlack: "#6d5b46",
	brightRed: "#ef7a60",
	brightGreen: "#b3c77f",
	brightYellow: "#f0bc6e",
	brightBlue: "#84bcd9",
	brightMagenta: "#d9b3ec",
	brightCyan: "#84cfca",
	brightWhite: "#f6efe4",
};

const THEMES: Record<TerminalPalette, ITheme> = {
	light: LIGHT,
	dark: DARK,
	warm: WARM,
	// Terminal UI theme reuses the dark xterm palette until a dedicated one
	// lands; its chrome accent (--primary) already matches DARK's cursor teal.
	tui: DARK,
};

export function terminalThemeFor(palette: TerminalPalette): ITheme {
	return THEMES[palette];
}
