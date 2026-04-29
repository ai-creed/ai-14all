/**
 * Normalize a terminal-emitted title into a usable session label, or `null`
 * if the title looks like a path (which is xterm's default and would be
 * worse than the existing label).
 */
export function normalizeTerminalTitle(title: string): string | null {
	const normalized = title.trim().replace(/\s+/g, " ");
	if (!normalized) return null;
	if (normalized.startsWith("/") || normalized.startsWith("~/")) return null;
	if (/^[A-Za-z]:[\\/]/.test(normalized)) return null;
	return normalized;
}
