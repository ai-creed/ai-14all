import {
	createNodeSodiumBackend,
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
import {
	createLanWebSocketHost,
	primaryLanIPv4,
} from "./lan-websocket-transport.js";
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
		},
	) {
		this.pairedStore = new XbpPairedDeviceStore({
			dir: opts.dir,
			secureStorage: opts.secureStorage,
		});
	}

	private emitStatusChange(): void {
		this.opts.onStatusChange?.();
	}

	async start(): Promise<{
		listening: boolean;
		addr: string | null;
		port: number | null;
	}> {
		this.backend ??= await createNodeSodiumBackend();
		this.audit = new XbpAuditSink({ dir: this.opts.dir, now: this.opts.now });
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
		return { listening: true, addr: primaryLanIPv4(), port: this.lan.port };
	}

	async startPairing(): Promise<PairingOffer> {
		const addr = primaryLanIPv4() ?? "127.0.0.1";
		return this.pairingHost!.createOffer({
			url: `ws://${addr}:${this.lan!.port}`,
		});
	}

	confirmPairing(ok: boolean): boolean {
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
					pairedAt: (this.opts.now ?? Date.now)(),
					grantedPermissions: [...NEW_PAIRING_GRANTS],
				};
				this.pairedStore.save(this.pairedDevice); // persist — survives restart (AC2)
			}
		}
		this.emitStatusChange();
		return confirmed;
	}

	async forgetDevice(): Promise<void> {
		this.peerSession?.detach();
		// Cancel any in-flight pairing: a stale Confirm must not complete after
		// the forget, and the pre-forget QR offer token must die. ReferenceHost
		// keeps its pending peer/token private and confirmPairing(false) clears
		// neither lastSas nor the token (and would audit spurious rejections), so
		// swap in a fresh pairing host. Whenever pairingHost is non-null,
		// backend/identity/audit are too (all created together in start()).
		if (this.pairingHost) {
			this.pairingHost = new XbpPairingHost({
				backend: this.backend!,
				identity: this.identity!,
				audit: this.audit!,
				now: this.opts.now,
			});
		}
		this.pairedDevice = null;
		this.pairedStore.clear();
		this.opts.pushTokenStore?.clear();
		this.audit?.append({
			cap: null,
			risk: null,
			outcome: "accepted",
			reason: "device-forgotten",
		});
		this.emitStatusChange();
	}

	getStatus(): XbpStatus {
		return {
			enabled: this.enabled,
			listening: this.lan != null,
			addr: this.lan ? primaryLanIPv4() : null,
			port: this.lan?.port ?? null,
			paired: this.pairedDevice != null,
			sas: this.pairingHost?.lastSas ?? null,
		};
	}

	async setEnabled(on: boolean): Promise<void> {
		if (on && !this.enabled) {
			await this.start();
		} else if (!on && this.enabled) {
			await this.stop();
		}
	}

	async stop(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.peerSession?.stop();
		this.peerSession = null;
		if (this.lan) {
			await this.lan.close();
			this.lan = null;
		}
		this.pairingHost = null;
		this.enabled = false;
	}
}
