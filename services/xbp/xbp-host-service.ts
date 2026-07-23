import {
	createNodeSodiumBackend,
	deriveHostId,
	fromHex,
	toHex,
	type Identity,
	type PairingOffer,
	type SodiumBackend,
} from "@xavier/xbp/node";
import type { SessionReportResult } from "@ai-creed/command-contract";
import { XbpIdentityStore, type SecureStorage } from "./xbp-identity-store.js";
import {
	XbpPairedDeviceStore,
	type PairedDevice,
} from "./xbp-paired-device-store.js";
import { XbpAuditSink } from "./xbp-audit-sink.js";
import { NEW_PAIRING_GRANTS, grantsForStoredDevice } from "./xbp-grants.js";
import { XbpPairingHost } from "./xbp-pairing-host.js";
import { WebSocket } from "ws";
import {
	createLanWebSocketHost,
	primaryLanIPv4,
	wsToAttachable,
} from "./lan-websocket-transport.js";
import type { AttachableSocket } from "./attachable-transport.js";
import {
	createRelayRegistration,
	wsRelaySocket,
	type RelayControlSocket,
	type RelayRegistrationState,
} from "./relay-registration.js";
import { XbpPeerSession, type PtyInspectBinding } from "./xbp-peer-session.js";
import type { XbpActingExecutor } from "./xbp-acting-executor.js";
import type { XbpPushTokenStore } from "./xbp-push-token-store.js";
import type { PushTokenHandlers } from "./xbp-push-token-handlers.js";

export interface XbpStatus {
	enabled: boolean;
	listening: boolean;
	addr: string | null;
	port: number | null;
	paired: boolean;
	sas: string | null;
	pairing: "idle" | "awaiting-scan" | "awaiting-sas";
	offer: string | null;
	offerExpiresAt: number | null;
	pairedAt: number | null;
	grantedPermissions: string[] | null;
	lastError: string | null;
	// Off-LAN relay reachability (umbrella §6): "off" when no relay base is
	// configured or registration is torn down, "retrying" while connecting or in
	// backoff, "registered" once the relay accepts the host.
	relay: "off" | "retrying" | "registered";
}

export class XbpHostService {
	private backend: SodiumBackend | null = null;
	private identity: Identity | null = null;
	private audit: XbpAuditSink | null = null;
	private pairingHost: XbpPairingHost | null = null;
	private lan: Awaited<ReturnType<typeof createLanWebSocketHost>> | null = null;
	private peerSession: XbpPeerSession | null = null;
	private pairedStore: XbpPairedDeviceStore;
	private pairedDevice: PairedDevice | null = null;
	private unsubscribe: (() => void) | null = null;
	private enabled = false;
	private killSwitchOn = false;
	private pendingOffer: { payload: string; expiresAt: number } | null = null;
	private offerExpiryTimer: ReturnType<typeof setTimeout> | null = null;
	private lastError: string | null = null;
	// Source of truth for the relay candidate URL advertised in pairing
	// offers; mutated by applyRelayBaseUrl.
	private relayBaseUrl: string;
	// Live relay control-channel registration (null while off). relayState is the
	// last state the machine reported; getStatus() collapses it to the coarse
	// three-value XbpStatus.relay.
	private relayRegistration: ReturnType<typeof createRelayRegistration> | null =
		null;
	private relayState: RelayRegistrationState = "off";

	constructor(
		private readonly opts: {
			dir: string;
			secureStorage: SecureStorage;
			getSessionReport: () => Promise<SessionReportResult>;
			subscribeChanges: (cb: () => void) => () => void;
			onStatusChange?: () => void;
			acting?: XbpActingExecutor;
			pushTokenStore?: XbpPushTokenStore;
			pushTokenHandlers?: PushTokenHandlers;
			ptyInspect?: PtyInspectBinding;
			now?: () => number;
			initialRelayBaseUrl?: string;
			// Test seams: script the relay control channel and accept-dial without
			// touching the network. Production leaves these undefined and uses the
			// real ws-backed defaults.
			relaySocketFactory?: (url: string) => RelayControlSocket;
			relayJitter?: () => number;
			relayAcceptDial?: (
				url: string,
				attach: (socket: AttachableSocket) => void,
			) => void;
		},
	) {
		this.pairedStore = new XbpPairedDeviceStore({
			dir: opts.dir,
			secureStorage: opts.secureStorage,
		});
		this.relayBaseUrl = opts.initialRelayBaseUrl ?? "";
	}

	private emitStatusChange(): void {
		this.opts.onStatusChange?.();
	}

	private now(): number {
		return (this.opts.now ?? Date.now)();
	}

	// Replace or clear the pending offer, keeping the expiry timer in lockstep
	// so the UI flips back to idle without polling when the offer dies.
	private setPendingOffer(
		offer: { payload: string; expiresAt: number } | null,
	): void {
		if (this.offerExpiryTimer) {
			clearTimeout(this.offerExpiryTimer);
			this.offerExpiryTimer = null;
		}
		this.pendingOffer = offer;
		if (offer) {
			const delay = Math.max(0, offer.expiresAt - this.now());
			const timer = setTimeout(() => {
				this.offerExpiryTimer = null;
				this.pendingOffer = null;
				this.emitStatusChange();
			}, delay);
			timer.unref?.();
			this.offerExpiryTimer = timer;
		}
	}

	// Fresh pairing host: drops the pending peer, pending offer token, and
	// lastSas in one move with zero audit noise (unpair spec §3.2). The vendor
	// host clears lastSas on NEITHER confirm outcome, so both paths need this.
	private resetPairingHost(): void {
		if (this.pairingHost) {
			this.pairingHost = new XbpPairingHost({
				backend: this.backend!,
				identity: this.identity!,
				audit: this.audit!,
				now: this.opts.now,
			});
			this.pairingHost.killSwitch = this.killSwitchOn;
		}
	}

	private recordFailure(err: unknown): void {
		this.lastError = err instanceof Error ? err.message : String(err);
		this.emitStatusChange();
	}

	async start(): Promise<{
		listening: boolean;
		addr: string | null;
		port: number | null;
	}> {
		try {
			this.backend ??= await createNodeSodiumBackend();
			this.audit = new XbpAuditSink({
				dir: this.opts.dir,
				now: this.opts.now,
			});
			// Fail-closed: the store throws XbpSecureStorageUnavailableError if encryption is off.
			// AC6: audit the refusal before re-throwing so the rejection is traceable.
			let loaded: ReturnType<XbpIdentityStore["load"]>;
			try {
				loaded = new XbpIdentityStore({
					dir: this.opts.dir,
					backend: this.backend,
					secureStorage: this.opts.secureStorage,
				}).load();
			} catch (err) {
				this.audit.append({
					cap: null,
					risk: null,
					outcome: "rejected",
					reason: "safe-storage-unavailable",
				});
				throw err;
			}
			this.identity = loaded.identity;

			this.pairingHost = new XbpPairingHost({
				backend: this.backend,
				identity: this.identity,
				audit: this.audit,
				now: this.opts.now,
			});
			this.pairingHost.killSwitch = this.killSwitchOn;
			this.lan = await createLanWebSocketHost();
			this.peerSession = new XbpPeerSession({
				backend: this.backend,
				identity: this.identity,
				transport: this.lan.transport,
				audit: this.audit,
				getSessionReport: this.opts.getSessionReport,
				acting: this.opts.acting,
				pushToken: this.opts.pushTokenHandlers,
				ptyInspect: this.opts.ptyInspect,
				now: this.opts.now,
			});
			this.peerSession.setKillSwitch(this.killSwitchOn);

			// Route inbound frames to the pairing host; send its responses back, then
			// notify the UI so a freshly-computed SAS surfaces immediately.
			this.lan.transport.onFrame((frame) => {
				const reply = this.pairingHost!.handle(frame);
				if (reply) void this.lan!.transport.send(reply);
				this.emitStatusChange();
			});

			// Re-attach a previously-paired device so a restart keeps the phone paired (AC2).
			this.pairedDevice = this.pairedStore.load();
			if (this.pairedDevice) {
				this.peerSession.attach(
					fromHex(this.pairedDevice.signPubHex),
					fromHex(this.pairedDevice.boxPubHex),
					grantsForStoredDevice(this.pairedDevice),
				);
			} else {
				// Device-forget path: today forgetting = removing paired-device.enc
				// (no in-app unpair until Arc C). A leftover push token must not
				// outlive the pairing that authorized it.
				this.opts.pushTokenStore?.clear();
			}

			this.unsubscribe = this.opts.subscribeChanges(() =>
				this.peerSession?.notifyChanged(),
			);
			this.enabled = true;
			this.lastError = null;
			// Bring the relay control channel up alongside the LAN listener. No-op
			// when no relay base is configured (byte-identical LAN-only path).
			this.startRelayRegistration();
			return { listening: true, addr: primaryLanIPv4(), port: this.lan.port };
		} catch (err) {
			this.recordFailure(err);
			throw err;
		}
	}

	async startPairing(): Promise<PairingOffer> {
		try {
			const addr = primaryLanIPv4() ?? "127.0.0.1";
			const urls: [string, ...string[]] = [`ws://${addr}:${this.lan!.port}`]; // LAN always first (umbrella §6)
			if (this.relayBaseUrl) {
				const hostId = deriveHostId(
					this.backend!,
					this.identity!.sign.publicKey,
				);
				urls.push(`${this.relayBaseUrl}/connect/${hostId}`);
			}
			const offer = this.pairingHost!.createOffer({ urls });
			this.setPendingOffer({
				payload: JSON.stringify(offer),
				expiresAt: offer.expiresAt,
			});
			this.lastError = null;
			this.emitStatusChange();
			return offer;
		} catch (err) {
			this.recordFailure(err);
			throw err;
		}
	}

	confirmPairing(ok: boolean): boolean {
		try {
			const confirmed = this.pairingHost!.confirmPairing(ok);
			if (confirmed) {
				const peer = this.pairingHost!.activePeer();
				if (peer) {
					this.peerSession!.attach(peer.signPub, peer.boxPub, [
						...NEW_PAIRING_GRANTS,
					]);
					// A fresh pairing is a fresh device (or a reset one): it must not
					// inherit the previous registration. The new phone re-registers.
					this.opts.pushTokenStore?.clear();
					this.pairedDevice = {
						signPubHex: toHex(peer.signPub),
						boxPubHex: toHex(peer.boxPub),
						pairedAt: this.now(),
						grantedPermissions: [...NEW_PAIRING_GRANTS],
					};
					this.pairedStore.save(this.pairedDevice); // persist — survives restart (AC2)
				}
			}
			// Both outcomes: the vendor host never clears lastSas (accept keeps
			// it, reject keeps it), so without this swap getStatus() would report
			// paired:true with pairing:"awaiting-sas". Also kills the spent token.
			this.resetPairingHost();
			this.setPendingOffer(null);
			this.lastError = null;
			this.emitStatusChange();
			return confirmed;
		} catch (err) {
			this.recordFailure(err);
			throw err;
		}
	}

	async cancelPairing(): Promise<void> {
		try {
			this.resetPairingHost();
			this.setPendingOffer(null);
			this.audit?.append({
				cap: null,
				risk: null,
				outcome: "accepted",
				reason: "pairing-cancelled",
			});
			this.lastError = null;
			this.emitStatusChange();
		} catch (err) {
			this.recordFailure(err);
			throw err;
		}
	}

	async forgetDevice(): Promise<void> {
		try {
			this.peerSession?.detach();
			// Cancel any in-flight pairing: a stale Confirm must not complete after
			// the forget, and the pre-forget QR offer token must die (unpair spec §3.2).
			this.resetPairingHost();
			this.setPendingOffer(null);
			this.pairedDevice = null;
			this.pairedStore.clear();
			this.opts.pushTokenStore?.clear();
			this.audit?.append({
				cap: null,
				risk: null,
				outcome: "accepted",
				reason: "device-forgotten",
			});
			this.lastError = null;
			this.emitStatusChange();
		} catch (err) {
			this.recordFailure(err);
			throw err;
		}
	}

	getStatus(): XbpStatus {
		const sas = this.pairingHost?.lastSas ?? null;
		const offerLive =
			this.pendingOffer != null && this.pendingOffer.expiresAt > this.now();
		return {
			enabled: this.enabled,
			listening: this.lan != null,
			addr: this.lan ? primaryLanIPv4() : null,
			port: this.lan?.port ?? null,
			paired: this.pairedDevice != null,
			sas,
			pairing:
				sas != null ? "awaiting-sas" : offerLive ? "awaiting-scan" : "idle",
			offer: offerLive ? this.pendingOffer!.payload : null,
			offerExpiresAt: offerLive ? this.pendingOffer!.expiresAt : null,
			pairedAt: this.pairedDevice?.pairedAt ?? null,
			grantedPermissions: this.pairedDevice?.grantedPermissions
				? [...this.pairedDevice.grantedPermissions]
				: null,
			lastError: this.lastError,
			relay:
				this.relayState === "registered"
					? "registered"
					: this.relayState === "off"
						? "off"
						: "retrying",
		};
	}

	// Kill switch (child spec §5): gates capability execution on both the
	// pairing host (pre-pairing sealed frames) and the live peer session
	// (post-pairing capabilities), without touching the LAN listener, the
	// pairing host itself, or relay registration. killSwitchOn is the source
	// of truth re-applied at every (re)construction site — resetPairingHost()
	// and start() — so the flag survives an unpair, a re-pair, and a
	// stop()/start() cycle.
	setKillSwitch(on: boolean): void {
		this.killSwitchOn = on;
		if (this.pairingHost) this.pairingHost.killSwitch = on;
		this.peerSession?.setKillSwitch(on);
	}

	// Relay lifecycle audits are informational (umbrella §9): no capability, no
	// risk, always "accepted" — they record connectivity events, not access
	// decisions.
	private relayAudit(event: string, reason?: string): void {
		this.audit?.append({
			cap: null,
			risk: null,
			outcome: "accepted",
			level: "info",
			event,
			reason,
		});
	}

	// Bring up the relay control channel if a base URL is configured. Idempotent:
	// a live registration or an empty base is a no-op. The registration machine
	// owns reconnect/backoff; we only mirror its state and route its events.
	private startRelayRegistration(): void {
		if (this.relayRegistration || !this.relayBaseUrl) return;
		this.relayRegistration = createRelayRegistration({
			socketFactory: this.opts.relaySocketFactory ?? wsRelaySocket,
			signPubHex: toHex(this.identity!.sign.publicKey),
			sign: (bytes) =>
				this.backend!.sign(bytes, this.identity!.sign.privateKey),
			onIncomingSession: (acceptUrl) => this.dialRelayAccept(acceptUrl),
			onStateChange: (state) => {
				this.relayState = state;
				this.emitStatusChange();
			},
			audit: (e) => this.relayAudit(e.event, e.reason),
			setTimer: (cb, ms) => setTimeout(cb, ms),
			clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
			jitter: this.opts.relayJitter ?? Math.random,
		});
		this.relayRegistration.setBaseUrl(this.relayBaseUrl);
	}

	private stopRelayRegistration(): void {
		this.relayRegistration?.stop();
		this.relayRegistration = null;
		this.relayState = "off";
	}

	// Accept dial is a SEPARATE, binary XBP transport — it must not ride the
	// text-only relay control channel. One dial per token; failures are logged
	// and dropped (the relay expires the token; the phone retries via candidate
	// machinery — child spec §5).
	private dialRelayAccept(acceptUrl: string): void {
		if (this.opts.relayAcceptDial) {
			// Test seam: report the dial; the socket lands in lan.attach() exactly
			// as the real path does when the caller invokes attach().
			this.opts.relayAcceptDial(acceptUrl, (socket) => {
				this.lan?.attach(socket);
				this.relayAudit("relay-session-accepted");
			});
			return;
		}
		const ws = new WebSocket(acceptUrl);
		ws.on("open", () => {
			this.lan?.attach(wsToAttachable(ws));
			this.relayAudit("relay-session-accepted");
		});
		ws.on("error", (err) => {
			console.warn("[xbp-relay] accept dial failed:", err);
		});
	}

	// UI/settings entry point for changing the relay base at runtime. No-op on an
	// unchanged value; teardown on ""; restart on a new base (only while the
	// bridge is enabled). Always emits so the status surface reflects the change.
	applyRelayBaseUrl(url: string): void {
		if (url === this.relayBaseUrl) return;
		this.relayBaseUrl = url;
		this.stopRelayRegistration();
		if (this.enabled && url) this.startRelayRegistration();
		this.emitStatusChange();
	}

	async setEnabled(on: boolean): Promise<void> {
		try {
			if (on && !this.enabled) {
				this.enabled = true;
				await this.start();
			} else if (!on && this.enabled) {
				await this.stop();
			}
			this.lastError = null;
			this.emitStatusChange();
		} catch (err) {
			this.recordFailure(err);
			throw err;
		}
	}

	async stop(): Promise<void> {
		try {
			this.unsubscribe?.();
			this.unsubscribe = null;
			// Tear the relay control channel down with the bridge (child spec §5:
			// disable stops connectivity; kill-switch does not).
			this.stopRelayRegistration();
			this.peerSession?.stop();
			this.peerSession = null;
			if (this.lan) {
				await this.lan.close();
				this.lan = null;
			}
			this.pairingHost = null;
			this.setPendingOffer(null);
			this.enabled = false;
			this.lastError = null;
		} catch (err) {
			this.recordFailure(err);
			throw err;
		}
	}
}
