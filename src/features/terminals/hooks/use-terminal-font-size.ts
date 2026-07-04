import { useCallback, useEffect, useState } from "react";
import type { Ai14AllDesktopApi } from "../../../../shared/contracts/commands";
import { initialSettings } from "../../../app/hooks/use-settings";

// Exported so SettingsProvider's one-time legacy migration (use-settings.tsx)
// reads/writes the exact same localStorage key.
export const STORAGE_KEY = "ai14all.terminalFontSize";
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 20;

export type FontSizeAction = "increase" | "decrease" | "reset";

export function clampFontSize(n: number): number {
	if (!Number.isFinite(n)) return DEFAULT_TERMINAL_FONT_SIZE;
	return Math.min(
		MAX_TERMINAL_FONT_SIZE,
		Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(n)),
	);
}

export function nextTerminalFontSize(
	prev: number,
	action: FontSizeAction,
): number {
	if (action === "reset") return DEFAULT_TERMINAL_FONT_SIZE;
	return clampFontSize(prev + (action === "increase" ? 1 : -1));
}

export function readPersistedFontSize(): number {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw == null) return DEFAULT_TERMINAL_FONT_SIZE;
		const parsed = Number.parseInt(raw, 10);
		return Number.isNaN(parsed)
			? DEFAULT_TERMINAL_FONT_SIZE
			: clampFontSize(parsed);
	} catch {
		return DEFAULT_TERMINAL_FONT_SIZE;
	}
}

export function persistFontSize(size: number): void {
	try {
		localStorage.setItem(STORAGE_KEY, String(size));
	} catch {
		/* storage unavailable (e.g. private mode) — keep in-memory state */
	}
}

/**
 * Global terminal font size. Value persists via the settings store (see
 * use-settings.tsx) and is adjusted via the native app-menu accelerators
 * (Terminal → Increase/Decrease/Reset Font Size) delivered over the preload
 * bridge. Menu accelerators are used instead of a renderer keydown handler so
 * the shortcut still fires when a terminal pane owns keyboard focus (see
 * Global Constraints).
 */
export function useTerminalFontSize(): {
	fontSize: number;
	increase: () => void;
	decrease: () => void;
	reset: () => void;
} {
	const [fontSize, setFontSize] = useState<number>(
		() => initialSettings().terminalFontSize,
	);

	const apply = useCallback((action: FontSizeAction) => {
		setFontSize((prev) => {
			const next = nextTerminalFontSize(prev, action);
			void (window.ai14all as Ai14AllDesktopApi | undefined)?.settings
				?.write({ terminalFontSize: next })
				.catch(() => {});
			return next;
		});
	}, []);

	useEffect(() => {
		const bridge = (window.ai14all as Ai14AllDesktopApi | undefined)?.events;
		return bridge?.onAdjustTerminalFontSize?.(apply);
	}, [apply]);

	// Converge with settings changes written elsewhere (other windows, or this
	// window's own write above echoed back).
	useEffect(() => {
		const bridge = (window.ai14all as Ai14AllDesktopApi | undefined)?.events;
		return bridge?.onSettingsChanged?.((s) => setFontSize(s.terminalFontSize));
	}, []);

	const increase = useCallback(() => apply("increase"), [apply]);
	const decrease = useCallback(() => apply("decrease"), [apply]);
	const reset = useCallback(() => apply("reset"), [apply]);

	return { fontSize, increase, decrease, reset };
}
