// src/components/settings/phone-bridge-format.ts
// Presentation formatters for the phone-bridge panel. Pure functions so they
// unit-test without React.

/** "500563" -> "500 563" for readability; non-6-digit values pass through. */
export function formatSas(sas: string): string {
	return /^\d{6}$/.test(sas) ? `${sas.slice(0, 3)} ${sas.slice(3)}` : sas;
}

/** Milliseconds remaining -> "m:ss", clamped at 0:00. */
export function countdownLabel(msLeft: number): string {
	const total = Math.max(0, Math.ceil(msLeft / 1000));
	const m = Math.floor(total / 60);
	const s = String(total % 60).padStart(2, "0");
	return `${m}:${s}`;
}

/** Humanized elapsed-time label for the paired-device card. */
export function relativeTimeSince(then: number, now: number): string {
	const ms = Math.max(0, now - then);
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	const days = Math.floor(hours / 24);
	return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Grant strings -> user-readable permissions summary. A record persisted
 * before slice 2b.2 has no grants and loads fail-closed as read-only.
 */
export function permissionsLabel(perms: string[] | null): string {
	if (!perms || perms.length === 0) return "session reports (read-only)";
	if (!perms.includes("control:act")) return "session reports (read-only)";
	const parts = ["session reports", "can act on workflows"];
	if (perms.includes("control:pty-write"))
		parts.push("can type into terminals");
	return parts.join(" · ");
}
