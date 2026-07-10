import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Switch } from "@/components/ui/switch";

type BridgeStatus = {
	enabled: boolean;
	listening: boolean;
	addr: string | null;
	port: number | null;
	paired: boolean;
	sas: string | null;
};

/**
 * Settings panel that exposes the XBP Phone Bridge: live status, enable/disable
 * toggle, QR-code pairing flow, SAS confirmation dialog, and paired-device list.
 */
export function PhoneBridgePanel(): React.ReactElement {
	const [status, setStatus] = useState<BridgeStatus | null>(null);
	const [offerQr, setOfferQr] = useState<string | null>(null);
	const [pairingBusy, setPairingBusy] = useState(false);
	const [confirmingUnpair, setConfirmingUnpair] = useState(false);
	const [unpairBusy, setUnpairBusy] = useState(false);
	// Ref latch, not just state: two clicks in the same tick both read the
	// pre-update unpairBusy, so state alone cannot stop a double forget().
	const unpairInFlight = useRef(false);

	useEffect(() => {
		const bridge = window.ai14all.phoneBridge;
		void bridge.status().then((s) => {
			if (s) setStatus(s);
		});
		const unsub = bridge.onStatusChanged((s) => setStatus(s));
		return unsub;
	}, []);

	async function handleStartPairing() {
		if (pairingBusy) return;
		setPairingBusy(true);
		try {
			const result = await window.ai14all.phoneBridge.startPairing();
			if (result.offer) {
				const dataUrl = await QRCode.toDataURL(result.offer);
				setOfferQr(dataUrl);
			}
		} finally {
			setPairingBusy(false);
		}
	}

	async function handleConfirmSas(ok: boolean) {
		try {
			await window.ai14all.phoneBridge.confirmSas(ok);
		} catch {
			// ignore: surfaced via status refresh
		}
	}

	async function handleForget() {
		if (unpairInFlight.current) return;
		unpairInFlight.current = true;
		setUnpairBusy(true);
		try {
			const s = await window.ai14all.phoneBridge.forget();
			if (s) setStatus(s);
		} catch {
			// ignore: surfaced via status refresh
		} finally {
			unpairInFlight.current = false;
			setUnpairBusy(false);
			setConfirmingUnpair(false);
		}
	}

	const addrLabel =
		status?.addr && status.port != null
			? `${status.addr}:${status.port}`
			: null;

	return (
		<div className="phone-bridge-panel">
			<h2 className="phone-bridge-panel__title">Phone Bridge</h2>

			{/* Status line + toggle */}
			<div className="phone-bridge-panel__status-row">
				<span className="phone-bridge-panel__addr">
					{addrLabel ?? (status ? "Not listening" : "Loading…")}
				</span>
				<Switch
					checked={status?.enabled ?? false}
					onCheckedChange={(checked) => {
						void window.ai14all.phoneBridge.setEnabled(checked);
					}}
					aria-label="Enable phone bridge"
				/>
			</div>

			{/* Pair a phone button + QR */}
			<div className="phone-bridge-panel__pair-section">
				<button
					type="button"
					className="phone-bridge-panel__pair-button"
					disabled={pairingBusy || !status?.enabled || status?.paired}
					onClick={() => void handleStartPairing()}
				>
					Pair a phone
				</button>
				{offerQr && (
					<img
						data-testid="pairing-qr"
						src={offerQr}
						alt="Pairing QR code — scan with your phone"
						className="phone-bridge-panel__qr"
					/>
				)}
			</div>

			{/* SAS confirmation block — driven by status.sas */}
			{status?.sas != null && (
				<div className="phone-bridge-panel__sas-block">
					<p className="phone-bridge-panel__sas-label">
						Confirm this code matches your phone:
					</p>
					<p className="phone-bridge-panel__sas-digits">{status.sas}</p>
					<div className="phone-bridge-panel__sas-actions">
						<button
							type="button"
							className="phone-bridge-panel__sas-confirm"
							onClick={() => void handleConfirmSas(true)}
						>
							Confirm
						</button>
						<button
							type="button"
							className="phone-bridge-panel__sas-reject"
							onClick={() => void handleConfirmSas(false)}
						>
							Reject
						</button>
					</div>
				</div>
			)}

			{/* Paired device list */}
			{status?.paired && (
				<div className="phone-bridge-panel__paired-list">
					<p className="phone-bridge-panel__paired-row">Paired</p>
					{!confirmingUnpair ? (
						<button
							type="button"
							className="phone-bridge-panel__unpair-button"
							onClick={() => setConfirmingUnpair(true)}
						>
							Unpair phone
						</button>
					) : (
						<div className="phone-bridge-panel__unpair-confirm">
							<p className="phone-bridge-panel__unpair-label">
								Confirm unpair? The phone will have to re-pair.
							</p>
							<button
								type="button"
								className="phone-bridge-panel__unpair-confirm-button"
								disabled={unpairBusy}
								onClick={() => void handleForget()}
							>
								Confirm unpair
							</button>
							<button
								type="button"
								className="phone-bridge-panel__unpair-cancel"
								onClick={() => setConfirmingUnpair(false)}
							>
								Cancel
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
