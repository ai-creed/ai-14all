import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

/**
 * Terminal UI icon registry.
 *
 * Each entry pairs the glyph the non-TUI palettes already use (`fallback`)
 * with the Nerd Font codepoint shown under `data-theme="tui"` (`nf`). Nerd
 * Font codepoints live in the Private Use Area and are supplied by the
 * "Symbols Nerd Font" face (see src/app/shell.css). The fallback keeps
 * dark / light / warm pixel-identical to today -- only the TUI palette swaps
 * to the Nerd Font glyph, making it the sole icon set there.
 *
 * Glyphs are written as \u escapes so codepoints survive editing
 * unambiguously; the trailing comment names each one.
 */
export const ICON_GLYPHS = {
	close: { fallback: "✕", nf: "" }, // close
	check: { fallback: "✓", nf: "" }, // check
	refresh: { fallback: "↻", nf: "" }, // refresh
	push: { fallback: "⬆", nf: "" }, // cloud-upload
	download: { fallback: "⤓", nf: "" }, // download
	"arrow-up": { fallback: "↑", nf: "" }, // arrow-up
	"arrow-down": { fallback: "↓", nf: "" }, // arrow-down
	"arrow-right": { fallback: "→", nf: "" }, // arrow-right
	plus: { fallback: "＋", nf: "" }, // plus
	gear: { fallback: "⚙", nf: "" }, // cog
	grid: { fallback: "▦", nf: "" }, // grid (th)
	"external-link": { fallback: "↗", nf: "" }, // external-link
	edit: { fallback: "✎", nf: "" }, // pencil
	eye: { fallback: "👁", nf: "" }, // eye
	folder: { fallback: "🗂", nf: "" }, // folder
	file: { fallback: "🗎", nf: "" }, // file
	note: { fallback: "📝", nf: "" }, // sticky-note
	plugins: { fallback: "🧩", nf: "" }, // puzzle-piece
	"caret-right": { fallback: "▸", nf: "" }, // caret-right
	"caret-down": { fallback: "▾", nf: "" }, // caret-down
	"caret-left": { fallback: "◂", nf: "" }, // caret-left
	"chevron-right": { fallback: "›", nf: "" }, // angle-right
	"chevron-left": { fallback: "‹", nf: "" }, // angle-left
	dot: { fallback: "●", nf: "" }, // circle
	comment: { fallback: "💬", nf: "" }, // comment
	info: { fallback: "ⓘ", nf: "" }, // info-circle
} as const;

export type IconName = keyof typeof ICON_GLYPHS;

type IconProps = {
	name: IconName;
	/**
	 * Lucide component to render in the non-TUI palettes instead of the text
	 * fallback (used by the shadcn primitives that ship SVG icons today).
	 */
	lucide?: ComponentType<{ className?: string }>;
	/** Applied to whichever icon element is visible (svg, fallback or glyph). */
	className?: string;
};

/**
 * Renders an icon as a Fragment so it drops into existing markup exactly where
 * the old glyph / SVG sat. Exactly one child is ever visible: the non-TUI
 * representation (Lucide SVG or text glyph) outside the TUI palette, and the
 * Nerd Font glyph inside it.
 */
export function Icon({ name, lucide: Lucide, className }: IconProps) {
	const { fallback, nf } = ICON_GLYPHS[name];
	return (
		<>
			{Lucide ? (
				<Lucide className={cn("tui:hidden", className)} />
			) : (
				<span className={cn("tui:hidden", className)}>{fallback}</span>
			)}
			<span
				aria-hidden
				data-nf={nf}
				className={cn("app-nf hidden tui:inline-block", className)}
			/>
		</>
	);
}
