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

export type CapabilityKey = "reports" | "act" | "notify" | "inspect" | "pty";

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

// Hardcoded per spec D7: no src/ module imports @ai-creed/command-contract, so
// the renderer restates the permission strings rather than opening that door.
// Risk noted in spec §9 — if NEW_PAIRING_GRANTS ever renames one, the ledger
// silently shows "not granted".
const CONTROL_ACT = "control:act";
const CONTROL_NOTIFY = "control:notify";
const CONTROL_INSPECT = "control:inspect";
const CONTROL_PTY_WRITE = "control:pty-write";

/**
 * Grants + local kill switches -> one row per user-facing capability.
 *
 *     armed = (granted && key in {notify, pty}) ? flagFor(key) : null
 *
 * The grant gate is the point: an absent grant means there is nothing to arm,
 * so offering a switch for it would be offering a control that cannot change
 * anything (spec §2 problem 3).
 *
 * NOTE on what the host actually enforces: grants ARE checked host-side, at
 * the protocol layer — `Peer.dispatchRequest` (@xavier/xbp peer.ts) rejects
 * with "permission-denied" when the sender lacks the capability descriptor's
 * permission, checking the permission set minted at pairing and passed
 * through `addPeer` in xbp-peer-session.ts. The two executor checks
 * (xbp-pty-input-executor.ts `isPtyInputEnabled`, xbp-push-token-handlers.ts
 * `isPushWakeEnabled`) are a second, independent local kill-switch gate, not
 * the grant check. Either way, `granted` here is a faithful report of what
 * was minted at pairing (xbp-grants.ts), and the reason a denied row shows no
 * control is that re-pairing, not a switch, is its only upgrade path.
 *
 * control:inspect IS shown (spec D10, superseding D3). It is the permission on
 * five pty-inspect capabilities — "List terminals", "Watch terminal", "Stop
 * watching terminal", "Terminal rows" ("Pull styled terminal rows (replay page
 * or live-tail delta)") and "Resize watched terminal" — so it grants reading
 * agent terminal OUTPUT, not merely metadata. D3 originally omitted it as
 * having "no user-facing meaning"; that was wrong, and omitting it left the
 * ledger stating the phone could type into terminals while saying nothing
 * about it reading them. It carries no kill switch, so it renders as a bare
 * fact row.
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
		// Sits immediately before `pty` so the read/write pair on the SAME
		// terminals reads as a pair — that contrast is the reason this row exists.
		{
			key: "inspect",
			label: "Read terminal output",
			hint: "The phone can live-tail agent terminals — everything they print — and resize the one it watches.",
			granted: has(CONTROL_INSPECT),
			// No local kill switch exists for pty-inspect — re-pairing is the only
			// way to change it, same as `act`.
			flag: null,
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
