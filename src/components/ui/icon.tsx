import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

/**
 * Icon registry.
 *
 * Each entry pairs the glyph the non-TUI palettes already use (`fallback`)
 * with the Nerd Font codepoint shown in every theme (`nf`). Nerd Font
 * codepoints live in the Private Use Area and are supplied by the "Symbols
 * Nerd Font" face (see src/styles/base.css). Every theme renders the Nerd Font
 * glyph; `fallback` is retained as the source-of-truth character and for
 * copy/accessibility tooling.
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
	"git-branch": { fallback: "⎇", nf: "" }, // octicon git-branch U+F418
	"sidebar-collapse": { fallback: "◧", nf: "" }, // octicon sidebar-collapse U+F514
	"sidebar-expand": { fallback: "◨", nf: "" }, // octicon sidebar-expand U+F515
	palette: { fallback: "🎨", nf: "" }, // fa-palette U+EFCC
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
	code: { fallback: "❮❯", nf: "" }, // code </>
	comment: { fallback: "💬", nf: "" }, // comment
	info: { fallback: "ⓘ", nf: "" }, // info-circle
	link: { fallback: "⧉", nf: "" }, // link (nf-fa-link, U+F0C1)
	pin: { fallback: "📌", nf: "" }, // thumb-tack (pin)
	minimize: { fallback: "—", nf: "" }, // minus (minimize / collapse)
	trash: { fallback: "🗑", nf: "" }, // trash (nf-fa-trash, U+F1F8)
	play: { fallback: "▶", nf: "" }, // play (nf-fa-play, U+F04B)
	help: { fallback: "?", nf: "" }, // question-circle (nf-fa-question_circle, U+F059)
} as const;

export type IconName = keyof typeof ICON_GLYPHS;

type IconProps = {
	name: IconName;
	/**
	 * Lucide component carried as the SVG fallback (used by the shadcn
	 * primitives that ship SVG icons today). Hidden in every theme now that the
	 * Nerd Font glyph renders everywhere; retained for the registry contract.
	 */
	lucide?: ComponentType<{ className?: string }>;
	/** Applied to whichever icon element is visible (svg, fallback or glyph). */
	className?: string;
	/**
	 * Overrides the registry fallback glyph. Use when a call site's original
	 * character differs from the shared registry glyph (the same `name` is
	 * reused across sites that historically used different chars). The fallback
	 * is hidden in every theme now that the Nerd Font glyph renders everywhere;
	 * it is kept as the source-of-truth character for the registry.
	 */
	fallback?: string;
};

/**
 * Renders an icon as a Fragment so it drops into existing markup exactly where
 * the old glyph / SVG sat. Exactly one child is ever visible: the Nerd Font
 * glyph (shown in every theme). The Lucide SVG / text fallback is always
 * hidden and kept only so the codepoint registry and call sites stay legible.
 */
export function Icon({
	name,
	lucide: Lucide,
	className,
	fallback: fallbackOverride,
}: IconProps) {
	const { fallback, nf } = ICON_GLYPHS[name];
	const glyph = fallbackOverride ?? fallback;
	return (
		<>
			{Lucide ? (
				<Lucide className={cn("hidden", className)} />
			) : (
				<span className={cn("hidden", className)}>{glyph}</span>
			)}
			<span
				aria-hidden
				data-nf={nf}
				className={cn("app-nf inline-block", className)}
			/>
		</>
	);
}
