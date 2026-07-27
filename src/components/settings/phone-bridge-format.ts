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

export type CapabilityKey = "reports" | "act" | "notify" | "pty";

export type CapabilityRow = {
	key: CapabilityKey;
	label: string;
	hint?: string;
	/** Granted at pairing, from status.grantedPermissions. */
	granted: boolean;
	/**
	 * State of this capability's local kill switch. null = the row has NO
	 * control — either no switch exists for it, or the grant is absent so the
	 * switch is moot. `armed !== null` iff the row renders a control.
	 */
	armed: boolean | null;
};

// Hardcoded per spec D7: no src/ module imports @ai-creed/command-contract,
// and permissionsLabel had the identical exposure before this.
const CONTROL_ACT = "control:act";
const CONTROL_NOTIFY = "control:notify";
const CONTROL_PTY_WRITE = "control:pty-write";

/**
 * Grants + local kill switches -> one row per user-facing capability.
 *
 *     armed = (granted && key in {notify, pty}) ? flagFor(key) : null
 *
 * The grant gate is the point: an absent grant means there is nothing to arm,
 * and the executor refuses the call regardless (xbp-pty-input-executor.ts:69,
 * xbp-push-token-handlers.ts:28). control:inspect is deliberately not shown —
 * it is minted at pairing but has no user-facing meaning (spec D3).
 */
export function capabilityRows(
	perms: string[] | null,
	flags: { pushWakeEnabled: boolean; ptyInputEnabled: boolean },
): CapabilityRow[] {
	const has = (p: string) => (perms ?? []).includes(p);
	// `flag: null` marks a capability with no local switch at all.
	const spec: Array<Omit<CapabilityRow, "armed"> & { flag: boolean | null }> = [
		{
			key: "reports",
			label: "Read session reports",
			// Every record carries session reports (xbp-grants.ts:26).
			granted: true,
			flag: null,
		},
		{
			key: "act",
			label: "Act on workflows",
			granted: has(CONTROL_ACT),
			flag: null,
		},
		{
			key: "notify",
			label: "Send notifications to this phone",
			hint: "Pings the phone when a workflow finishes or needs you.",
			granted: has(CONTROL_NOTIFY),
			flag: flags.pushWakeEnabled,
		},
		{
			key: "pty",
			label: "Type into terminals",
			hint: "Sends keystrokes to running agents.",
			granted: has(CONTROL_PTY_WRITE),
			flag: flags.ptyInputEnabled,
		},
	];
	return spec.map(({ flag, ...row }) => ({
		...row,
		armed: row.granted && flag !== null ? flag : null,
	}));
}
