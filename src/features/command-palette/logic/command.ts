/**
 * A runnable command surfaced in the command palette. Registered at runtime via
 * useRegisterCommands; the palette enumerates, filters, and executes these.
 */
export interface Command {
	/** Stable, unique id, e.g. "terminal.new". Last registration for an id wins. */
	id: string;
	/** Display label in the palette, e.g. "New terminal". */
	title: string;
	/** Section header used to group rows, e.g. "Terminal". */
	group: string;
	/** Extra search aliases matched in addition to the title. */
	keywords?: string[];
	/**
	 * Links to a SHORTCUT_REGISTRY entry so the palette can render the key hint.
	 * Omit for palette-only commands (no keybinding).
	 */
	keybindingId?: string;
	/** Executes the command. */
	run: () => void;
	/** Defaults to always-available. When it returns false the command is hidden. */
	isAvailable?: () => boolean;
}
