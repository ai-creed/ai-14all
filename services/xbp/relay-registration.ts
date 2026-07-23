import { WebSocket } from "ws";
import {
	RELAY_CLOSE_PROTOCOL_VIOLATION,
	RelayHostBound,
	fromHex,
	toHex,
} from "@xavier/xbp/node";

export type RelayRegistrationState =
	| "off"
	| "connecting"
	| "authenticating"
	| "registered"
	| "backoff";

export interface RelayControlSocket {
	send(text: string): void;
	close(code?: number): void;
	onOpen(cb: () => void): void;
	onMessage(cb: (data: unknown) => void): void;
	onClose(cb: (code: number) => void): void;
}

export interface RelayRegistrationDeps {
	socketFactory: (url: string) => RelayControlSocket;
	signPubHex: string;
	sign: (bytes: Uint8Array) => Uint8Array; // detached, identity sign key
	onIncomingSession: (acceptUrl: string) => void;
	onStateChange: (state: RelayRegistrationState) => void;
	audit: (e: {
		event: "relay-registered" | "relay-registration-lost";
		reason?: string;
	}) => void;
	setTimer: (cb: () => void, ms: number) => unknown;
	clearTimer: (handle: unknown) => void;
	jitter: () => number; // [0, 1)
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 60_000;

export function createRelayRegistration(deps: RelayRegistrationDeps): {
	setBaseUrl(url: string): void; // "" = off/teardown; url change = restart
	stop(): void;
	state(): RelayRegistrationState;
} {
	let baseUrl = "";
	let state: RelayRegistrationState = "off";
	let socket: RelayControlSocket | null = null;
	let attempt = 0;
	let timerHandle: unknown = null;
	// Sub-state within "authenticating": a `registered` frame is only valid
	// after a `challenge` has been answered — the public state alone can't
	// distinguish that ordering, so track it per connection attempt.
	let challenged = false;

	function setState(next: RelayRegistrationState): void {
		state = next;
		deps.onStateChange(state);
	}

	function armBackoffTimer(): void {
		if (timerHandle !== null) {
			deps.clearTimer(timerHandle);
			timerHandle = null;
		}
		const delay =
			Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS) *
			(0.5 + 0.5 * deps.jitter());
		attempt++;
		timerHandle = deps.setTimer(() => {
			timerHandle = null;
			connect();
		}, delay);
	}

	// Single entry point for connection loss. The close event is the ONLY
	// caller — failure handling elsewhere just closes the socket and lets the
	// resulting close event land here, so backoff can never double-arm.
	function lost(reason?: string): void {
		if (state === "off") return; // deliberate teardown, not a loss
		socket = null;
		setState("backoff");
		deps.audit({ event: "relay-registration-lost", reason });
		armBackoffTimer();
	}

	function teardown(): void {
		if (timerHandle !== null) {
			deps.clearTimer(timerHandle);
			timerHandle = null;
		}
		setState("off");
		const s = socket;
		socket = null;
		s?.close();
	}

	function connect(): void {
		challenged = false;
		setState("connecting");
		const s = deps.socketFactory(`${baseUrl}/host`);
		socket = s;
		// Real ws.close() is async — a stale event from a socket already
		// superseded by a later setBaseUrl()/connect() must not touch the new
		// connection's state. The fake test harness closes synchronously, so
		// this guard is a no-op against every scripted test above.
		s.onOpen(() => {
			if (socket !== s) return;
			setState("authenticating");
			s.send(JSON.stringify({ t: "register", signPubHex: deps.signPubHex }));
		});
		s.onMessage((data) => {
			if (socket !== s) return;
			handleMessage(s, data);
		});
		s.onClose((code) => {
			if (socket !== s) return;
			lost(`closed:${code}`);
		});
	}

	function handleMessage(s: RelayControlSocket, data: unknown): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(String(data));
		} catch {
			s.close(RELAY_CLOSE_PROTOCOL_VIOLATION);
			return;
		}
		const result = RelayHostBound.safeParse(parsed);
		if (!result.success) {
			s.close(RELAY_CLOSE_PROTOCOL_VIOLATION);
			return;
		}
		const msg = result.data;
		switch (msg.t) {
			case "challenge": {
				if (state !== "authenticating") {
					s.close(RELAY_CLOSE_PROTOCOL_VIOLATION);
					return;
				}
				challenged = true;
				const sigHex = toHex(deps.sign(fromHex(msg.nonceHex)));
				s.send(JSON.stringify({ t: "challenge-response", sigHex }));
				return;
			}
			case "registered": {
				if (state !== "authenticating" || !challenged) {
					s.close(RELAY_CLOSE_PROTOCOL_VIOLATION);
					return;
				}
				attempt = 0;
				setState("registered");
				deps.audit({
					event: "relay-registered",
					reason: `${msg.hostId} @ ${baseUrl}`,
				});
				return;
			}
			case "incoming-session": {
				if (state !== "registered") {
					s.close(RELAY_CLOSE_PROTOCOL_VIOLATION);
					return;
				}
				deps.onIncomingSession(`${baseUrl}/accept/${msg.token}`);
				return;
			}
		}
	}

	return {
		setBaseUrl(url: string): void {
			if (url === baseUrl) return;
			teardown();
			baseUrl = url;
			if (url !== "") {
				attempt = 0;
				connect();
			}
		},
		stop(): void {
			teardown();
			baseUrl = "";
		},
		state(): RelayRegistrationState {
			return state;
		},
	};
}

// Real adapter. Keepalive note: the `ws` library answers pings
// automatically (child spec §5) — no application-level heartbeat needed here.
export function wsRelaySocket(url: string): RelayControlSocket {
	const ws = new WebSocket(url);
	return {
		send: (text) => ws.send(text),
		close: (code) => ws.close(code),
		onOpen: (cb) => ws.on("open", cb),
		onMessage: (cb) => ws.on("message", (d) => cb(String(d))),
		onClose: (cb) => {
			ws.on("close", (code) => cb(code));
			ws.on("error", () => {}); // close always follows error; backoff handles it
		},
	};
}
