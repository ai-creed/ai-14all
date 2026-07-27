import { Fragment, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "../../app/hooks/use-settings";
import type { PhoneBridgeStatus } from "../../../shared/contracts/commands";
import {
	capabilityRows,
	countdownLabel,
	formatSas,
	relativeTimeSince,
} from "./phone-bridge-format";

type View = "loading" | "off" | "fault" | "paired" | "sas" | "scan" | "idle";

function deriveView(status: PhoneBridgeStatus | null): View {
	if (!status) return "loading";
	if (!status.enabled) return "off";
	if (!status.listening) return "fault";
	if (status.paired) return "paired";
	if (status.pairing === "awaiting-sas") return "sas";
	if (status.pairing === "awaiting-scan") return "scan";
	return "idle";
}

/**
 * Phone Bridge panel body: a single-view state machine derived entirely from
 * the main-process PhoneBridgeStatus (spec 2026-07-15 §4). The renderer holds
 * no pairing state of its own, so reopening the dialog mid-pairing recovers
 * the exact step from status.
 */
export function PhoneBridgePanel(): React.ReactElement {
	const { settings, update } = useSettings();
	const [status, setStatus] = useState<PhoneBridgeStatus | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [nowTick, setNowTick] = useState(() => Date.now());
	const [confirmingUnpair, setConfirmingUnpair] = useState(false);
	// null = not yet loaded from settings.read(). relayCommitted tracks the
	// last known-persisted value (from load, or a successful write) so onBlur
	// can tell an actual edit from a no-op focus/blur.
	const [relayDraft, setRelayDraft] = useState<string | null>(null);
	const relayCommitted = useRef<string | null>(null);
	// D5a: the disclosure opens when a relay is already configured. This is a
	// ref-latched STATE seed, never a prop derived from relayDraft — React
	// only writes the DOM `open` property when the prop value CHANGES, so a
	// derived prop survives a same-value re-render but reopens on remount
	// (bridge off/on, dialog close/reopen) and flips shut mid-edit whenever
	// the derived value changes (e.g. the user clearing the field).
	// relaySeeded (not just relayOpen) guards against StrictMode's
	// double-invoked effects (src/main.tsx) issuing a second settings.read().
	const [relayOpen, setRelayOpen] = useState(false);
	const relaySeeded = useRef(false);
	// Ref latch, not just state: two clicks in the same tick both read the
	// pre-update busy flag, so state alone cannot stop a duplicate invoke.
	const inFlight = useRef(false);

	useEffect(() => {
		const bridge = window.ai14all.phoneBridge;
		void bridge.status().then((s) => {
			if (s) setStatus(s);
		});
		return bridge.onStatusChanged((s) => {
			setStatus(s);
			// Spec §6: a renderer-local action error clears on the next action OR
			// state change — a fresh status supersedes the stale message.
			setActionError(null);
		});
	}, []);

	// Relay URL draft: seeded once from the persisted settings file, not from
	// PhoneBridgeStatus (the relay base URL is renderer-configured, unlike
	// `status.relay` which is main-process-observed registration state).
	useEffect(() => {
		void window.ai14all.settings.read().then(({ settings }) => {
			relayCommitted.current = settings.phoneBridge.relayBaseUrl;
			setRelayDraft(settings.phoneBridge.relayBaseUrl);
			if (!relaySeeded.current) {
				relaySeeded.current = true;
				setRelayOpen(settings.phoneBridge.relayBaseUrl !== "");
			}
		});
	}, []);

	const view = deriveView(status);

	// QR derives from the status-carried offer payload, never from a
	// startPairing return value (spec §4).
	const offer = status?.offer ?? null;
	useEffect(() => {
		if (!offer) {
			setQrDataUrl(null);
			return;
		}
		let stale = false;
		void QRCode.toDataURL(offer).then((url) => {
			if (!stale) setQrDataUrl(url);
		});
		return () => {
			stale = true;
		};
	}, [offer]);

	// Fresh tick on entering the time-sensitive views (countdown, "Paired N
	// ago"), then a 1s interval only while the QR countdown is showing.
	useEffect(() => {
		if (view !== "scan" && view !== "paired") return;
		setNowTick(Date.now());
		if (view !== "scan") return;
		const t = setInterval(() => setNowTick(Date.now()), 1000);
		return () => clearInterval(t);
	}, [view]);

	// Leaving the paired view resets the two-step unpair confirmation.
	useEffect(() => {
		if (view !== "paired") setConfirmingUnpair(false);
	}, [view]);

	async function run(action: () => Promise<unknown>) {
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		setActionError(null);
		try {
			await action();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}

	function commitRelayDraft() {
		if (relayDraft === relayCommitted.current) return;
		window.ai14all.settings
			.write({ phoneBridge: { relayBaseUrl: relayDraft ?? "" } })
			.then((merged) => {
				relayCommitted.current = merged.phoneBridge.relayBaseUrl;
				setRelayDraft(merged.phoneBridge.relayBaseUrl);
			})
			.catch(() =>
				setActionError(
					"Relay URL must be a wss:// URL without query or fragment",
				),
			);
	}

	const bridge = () => window.ai14all.phoneBridge;
	const addrLabel =
		status?.addr && status.port != null
			? `${status.addr}:${status.port}`
			: null;
	const msLeft = (status?.offerExpiresAt ?? 0) - nowTick;

	const caps = capabilityRows(status?.grantedPermissions ?? null, {
		pushWakeEnabled: settings.phoneBridge.pushWakeEnabled,
		ptyInputEnabled: settings.phoneBridge.ptyInputEnabled,
	});
	const anyDenied = caps.some((c) => !c.granted);

	return (
		<div className="phone-bridge" data-view={view}>
			<div className="phone-bridge__strip">
				<span
					className={`phone-bridge__dot phone-bridge__dot--${
						view === "off" || view === "loading"
							? "off"
							: view === "fault"
								? "warn"
								: "on"
					}`}
				/>
				<span className="phone-bridge__addr">
					{view === "loading" && "Loading…"}
					{view === "off" && "Bridge off"}
					{view === "fault" && "Enabled — not listening"}
					{view !== "off" &&
						view !== "fault" &&
						view !== "loading" &&
						addrLabel != null &&
						`Listening on ${addrLabel}`}
				</span>
				<Switch
					checked={status?.enabled ?? false}
					disabled={busy || status == null}
					onCheckedChange={(checked) =>
						void run(() => bridge().setEnabled(checked))
					}
					aria-label="Enable phone bridge"
				/>
			</div>

			{view !== "off" && view !== "loading" && (
				<details
					className="phone-bridge__relay"
					open={relayOpen}
					onToggle={(e) => setRelayOpen(e.currentTarget.open)}
				>
					<summary>Off-network relay · {status?.relay}</summary>
					<div className="phone-bridge__relay-body">
						<label
							className="phone-bridge__label"
							htmlFor="phone-bridge-relay-url"
						>
							Relay URL
						</label>
						<input
							id="phone-bridge-relay-url"
							className="phone-bridge__input"
							type="text"
							placeholder="wss://relay.example.com"
							value={relayDraft ?? ""}
							onChange={(e) => setRelayDraft(e.target.value)}
							onBlur={commitRelayDraft}
						/>
						<p className="phone-bridge__hint phone-bridge__relay-hint">
							Lets a phone reach this Mac when it is not on your Wi-Fi. Leave
							empty for local network only.
						</p>
					</div>
				</details>
			)}

			{view === "loading" && (
				<div className="phone-bridge__view" data-testid="view-loading">
					<p className="phone-bridge__hint">Loading…</p>
				</div>
			)}

			{view === "off" && (
				<div className="phone-bridge__view" data-testid="view-off">
					<p className="phone-bridge__hint">
						The bridge is off. Enable it to let a phone on your local network
						pair and monitor live agent sessions.
					</p>
				</div>
			)}

			{view === "idle" && (
				<div className="phone-bridge__view" data-testid="view-idle">
					<div className="phone-bridge__label">Pairing</div>
					<p className="phone-bridge__hint">No phone paired.</p>
					<button
						type="button"
						className="phone-bridge__btn phone-bridge__btn--primary"
						disabled={busy}
						onClick={() => void run(() => bridge().startPairing())}
					>
						Pair a phone
					</button>
				</div>
			)}

			{view === "scan" && (
				<div className="phone-bridge__view" data-testid="view-scan">
					<div className="phone-bridge__label">Pairing</div>
					<div className="phone-bridge__scan">
						{qrDataUrl && (
							<img
								data-testid="pairing-qr"
								src={qrDataUrl}
								alt="Pairing QR code — scan with your phone"
								className="phone-bridge__qr"
							/>
						)}
						<div className="phone-bridge__scan-meta">
							<span className="phone-bridge__scan-title">
								Scan with your phone
							</span>
							<span className="phone-bridge__hint phone-bridge__hint--tight">
								Open ai-xavier on the same Wi-Fi network.
							</span>
							<span
								className={`phone-bridge__countdown${
									msLeft <= 30_000 ? " phone-bridge__countdown--late" : ""
								}`}
							>
								Expires in {countdownLabel(msLeft)}
							</span>
							<span>
								<button
									type="button"
									className="phone-bridge__btn"
									disabled={busy}
									onClick={() => void run(() => bridge().cancelPairing())}
								>
									Cancel
								</button>
							</span>
						</div>
					</div>
				</div>
			)}

			{view === "sas" && status?.sas != null && (
				<div className="phone-bridge__view" data-testid="view-sas">
					<div className="phone-bridge__label">Verify</div>
					<p className="phone-bridge__hint phone-bridge__hint--tight">
						Confirm this code matches your phone:
					</p>
					<p className="phone-bridge__sas-digits">{formatSas(status.sas)}</p>
					<p className="phone-bridge__hint phone-bridge__hint--tight">
						The same six digits must be showing on the phone.
					</p>
					<div className="phone-bridge__sas-actions">
						<button
							type="button"
							className="phone-bridge__btn phone-bridge__btn--primary"
							disabled={busy}
							onClick={() => void run(() => bridge().confirmSas(true))}
						>
							Confirm
						</button>
						<button
							type="button"
							className="phone-bridge__btn phone-bridge__btn--danger"
							disabled={busy}
							onClick={() => void run(() => bridge().confirmSas(false))}
						>
							Reject
						</button>
					</div>
				</div>
			)}

			{view === "paired" && (
				<div className="phone-bridge__view" data-testid="view-paired">
					<div className="phone-bridge__label">Paired device</div>
					<div className="phone-bridge__device">
						<div className="phone-bridge__device-main">
							<div className="phone-bridge__device-icon" aria-hidden="true" />
							<div className="phone-bridge__device-lines">
								<div className="phone-bridge__device-name">Phone</div>
								{status?.pairedAt != null && (
									<div>
										Paired {relativeTimeSince(status.pairedAt, nowTick)}
									</div>
								)}
							</div>
							{!confirmingUnpair && (
								<button
									type="button"
									className="phone-bridge__btn phone-bridge__btn--quiet-danger phone-bridge__device-action"
									onClick={() => setConfirmingUnpair(true)}
								>
									Unpair
								</button>
							)}
						</div>

						{/* Capability ledger (spec §5): `armed === null` selects the element.
						    Do NOT re-test `granted` here — capabilityRows already folds it in,
						    and a second condition can drift from the model. */}
						<div className="phone-bridge__caps">
							{caps.map((cap) =>
								cap.armed === null ? (
									<p
										key={cap.key}
										className={`phone-bridge__cap${
											cap.granted ? "" : " phone-bridge__cap--denied"
										}`}
									>
										<span className="phone-bridge__cap-mark">
											{cap.granted ? "✓" : "·"}
										</span>
										<span className="phone-bridge__cap-name">{cap.label}</span>
										{!cap.granted && (
											<span className="phone-bridge__cap-deny">
												not granted
											</span>
										)}
									</p>
								) : (
									<Fragment key={cap.key}>
										<button
											type="button"
											className="phone-bridge__cap"
											role="switch"
											aria-checked={cap.armed}
											aria-describedby={
												cap.hint
													? `phone-bridge-cap-${cap.key}-hint`
													: undefined
											}
											disabled={busy}
											onClick={() =>
												void update({
													phoneBridge:
														cap.key === "notify"
															? { pushWakeEnabled: !cap.armed }
															: { ptyInputEnabled: !cap.armed },
												})
											}
										>
											<span
												className="phone-bridge__cap-mark"
												aria-hidden="true"
											>
												{cap.armed ? "[✓]" : "[ ]"}
											</span>
											<span className="phone-bridge__cap-name">
												{cap.label}
											</span>
										</button>
										{cap.hint && (
											<p
												className="phone-bridge__cap-hint"
												id={`phone-bridge-cap-${cap.key}-hint`}
											>
												{cap.hint}
											</p>
										)}
									</Fragment>
								),
							)}
							{anyDenied && (
								<p className="phone-bridge__cap-hint">
									Pair this phone again to grant the newer capabilities.
								</p>
							)}
						</div>

						{confirmingUnpair && (
							<div
								className="phone-bridge__device-confirm"
								data-testid="unpair-confirm"
							>
								<span className="phone-bridge__confirm-text">
									The phone will have to pair again.
								</span>
								<button
									type="button"
									className="phone-bridge__btn phone-bridge__btn--danger"
									disabled={busy}
									onClick={() => void run(() => bridge().forget())}
								>
									Confirm unpair
								</button>
								<button
									type="button"
									className="phone-bridge__btn"
									disabled={busy}
									onClick={() => setConfirmingUnpair(false)}
								>
									Cancel
								</button>
							</div>
						)}
					</div>
				</div>
			)}

			{view === "fault" && (
				<div className="phone-bridge__view" data-testid="view-fault">
					<div className="phone-bridge__fault">
						<div>⚠ Bridge is enabled but not listening.</div>
						{status?.lastError && (
							<div className="phone-bridge__fault-detail">
								{status.lastError}
							</div>
						)}
						<div className="phone-bridge__fault-detail">
							Toggle the bridge off and on to retry.
						</div>
					</div>
				</div>
			)}

			{actionError && (
				<p className="phone-bridge__error" data-testid="action-error">
					✕ {actionError}
				</p>
			)}
			{view !== "fault" && status?.lastError && !actionError && (
				<p className="phone-bridge__error" data-testid="last-error">
					✕ {status.lastError}
				</p>
			)}
		</div>
	);
}
