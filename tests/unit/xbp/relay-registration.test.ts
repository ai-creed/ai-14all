import { describe, expect, it } from "vitest";
import { RELAY_CLOSE_PROTOCOL_VIOLATION } from "@xavier/xbp/node"; // name as verified in Task 1
import {
	createRelayRegistration,
	type RelayControlSocket,
} from "../../../services/xbp/relay-registration";

// The relay's real contract pins hex fields at the schema (hostIdHex/nonceHex
// require 64 hex chars = 32 bytes, tokenHex requires 32 hex chars = 16
// bytes) — RelayHostBound.safeParse rejects the brief's short/non-hex
// placeholders ("h", "01", "tok-1"). Adapted here to schema-valid hex so the
// happy-path/ordering assertions exercise routing logic, not parse failure.
// See task-6-report.md "Adaptations" for the full list.
const HOST_ID_HEX = "ab".repeat(32); // 64 hex chars
const NONCE_HEX = "01" + "00".repeat(31); // 64 hex chars; leading 0x01 byte
const SIG_HEX = "00".repeat(31) + "01"; // reverse(NONCE_HEX bytes) -> trailing 0x01
const TOKEN_HEX = "11".repeat(16); // 32 hex chars

function harness() {
	const dialed: string[] = [];
	const sent: unknown[] = [];
	const states: string[] = [];
	const audits: { event: string; reason?: string }[] = [];
	const incoming: string[] = [];
	const closedWith: number[] = []; // codes the MACHINE passed to socket.close()
	const timers: { cb: () => void; ms: number }[] = [];
	let sock: {
		open: () => void;
		message: (m: unknown) => void;
		closeFromRelay: (code: number) => void;
	} | null = null;

	const reg = createRelayRegistration({
		socketFactory: (url) => {
			dialed.push(url);
			let onOpen: (() => void) | null = null;
			let onMessage: ((d: unknown) => void) | null = null;
			let onClose: ((c: number) => void) | null = null;
			const s: RelayControlSocket = {
				send: (text) => sent.push(JSON.parse(text)),
				// Mirrors ws: a local close() also fires the close event.
				close: (code) => {
					closedWith.push(code ?? 1000);
					onClose?.(code ?? 1000);
				},
				onOpen: (cb) => (onOpen = cb),
				onMessage: (cb) => (onMessage = cb),
				onClose: (cb) => (onClose = cb),
			};
			sock = {
				open: () => onOpen?.(),
				message: (m) => onMessage?.(JSON.stringify(m)),
				closeFromRelay: (c) => onClose?.(c),
			};
			return s;
		},
		signPubHex: "aa".repeat(32),
		sign: (bytes) => new Uint8Array([...bytes].reverse()),
		onIncomingSession: (url) => incoming.push(url),
		onStateChange: (s) => states.push(s),
		audit: (e) => audits.push(e),
		setTimer: (cb, ms) => (timers.push({ cb, ms }), timers.length - 1),
		clearTimer: () => {},
		jitter: () => 1, // deterministic: full backoff value
	});
	const fireNextTimer = () => timers.shift()?.cb();
	const timersPeekMs = () => timers[0]?.ms;
	const timersCount = () => timers.length;
	return {
		reg,
		dialed,
		sent,
		states,
		audits,
		incoming,
		closedWith,
		fireNextTimer,
		timersPeekMs,
		timersCount,
		sock: () => sock!,
	};
}

describe("relay registration", () => {
	it("happy path: register → challenge → response → registered", () => {
		const h = harness();
		h.reg.setBaseUrl("wss://relay.example.com");
		expect(h.dialed).toEqual(["wss://relay.example.com/host"]);
		h.sock().open();
		expect(h.sent[0]).toEqual({ t: "register", signPubHex: "aa".repeat(32) });
		h.sock().message({ t: "challenge", nonceHex: NONCE_HEX });
		// sign() reverses bytes: leading 0x01 byte moves to the trailing byte.
		expect(h.sent[1]).toEqual({ t: "challenge-response", sigHex: SIG_HEX });
		h.sock().message({ t: "registered", hostId: HOST_ID_HEX });
		expect(h.reg.state()).toBe("registered");
		expect(h.audits[0]?.event).toBe("relay-registered");
	});
	it("bad-auth close (4401) → backoff arms exactly one timer → redial", () => {
		const h = harness();
		h.reg.setBaseUrl("wss://relay.example.com");
		h.sock().open();
		h.sock().closeFromRelay(4401);
		expect(h.reg.state()).toBe("backoff");
		expect(h.audits.at(-1)?.event).toBe("relay-registration-lost");
		expect(h.timersCount()).toBe(1);
		h.fireNextTimer();
		expect(h.dialed).toHaveLength(2);
	});
	it("malformed relay frame → machine closes with 4400 → exactly one backoff timer", () => {
		const h = harness();
		h.reg.setBaseUrl("wss://relay.example.com");
		h.sock().open();
		h.sock().message({ t: "not-a-relay-message" });
		expect(h.closedWith).toEqual([RELAY_CLOSE_PROTOCOL_VIOLATION]); // 4400
		expect(h.reg.state()).toBe("backoff");
		expect(h.timersCount()).toBe(1); // self-close fired onClose; loss must not double-arm
	});
	it("out-of-order frame (registered before challenge) → close 4400 → backoff", () => {
		const h = harness();
		h.reg.setBaseUrl("wss://relay.example.com");
		h.sock().open();
		h.sock().message({ t: "registered", hostId: HOST_ID_HEX });
		expect(h.closedWith).toEqual([RELAY_CLOSE_PROTOCOL_VIOLATION]);
		expect(h.reg.state()).toBe("backoff");
		expect(h.timersCount()).toBe(1);
	});
	it("loss after registered → backoff with reset attempt counter → re-register", () => {
		const h = harness();
		h.reg.setBaseUrl("wss://relay.example.com");
		h.sock().open();
		h.sock().message({ t: "challenge", nonceHex: NONCE_HEX });
		h.sock().message({ t: "registered", hostId: HOST_ID_HEX });
		h.sock().closeFromRelay(1006);
		expect(h.reg.state()).toBe("backoff");
		h.fireNextTimer();
		expect(h.reg.state()).toBe("connecting");
	});
	it("backoff delay doubles per attempt and caps at 60s", () => {
		const h = harness();
		h.reg.setBaseUrl("wss://relay.example.com");
		// jitter()=1 → delay = min(1000 * 2^n, 60000)
		const delays: number[] = [];
		for (let i = 0; i < 8; i++) {
			h.sock().open();
			h.sock().closeFromRelay(1006);
			delays.push(h.timersPeekMs() ?? NaN);
			h.fireNextTimer();
		}
		expect(delays.slice(0, 7)).toEqual([
			1000, 2000, 4000, 8000, 16000, 32000, 60000,
		]);
	});
	it("incoming-session while registered dials the accept URL once", () => {
		const h = harness();
		h.reg.setBaseUrl("wss://relay.example.com");
		h.sock().open();
		h.sock().message({ t: "challenge", nonceHex: NONCE_HEX });
		h.sock().message({ t: "registered", hostId: HOST_ID_HEX });
		h.sock().message({ t: "incoming-session", token: TOKEN_HEX });
		expect(h.incoming).toEqual([`wss://relay.example.com/accept/${TOKEN_HEX}`]);
	});
	it("setBaseUrl('') is deliberate teardown: no loss audit, no timer, no redial", () => {
		const h = harness();
		h.reg.setBaseUrl("wss://relay.example.com");
		h.sock().open();
		const dials = h.dialed.length;
		h.reg.setBaseUrl("");
		expect(h.reg.state()).toBe("off");
		// the machine's own close fires the close event — teardown must ignore it
		expect(h.timersCount()).toBe(0);
		expect(h.dialed).toHaveLength(dials);
		expect(h.audits.some((a) => a.event === "relay-registration-lost")).toBe(
			false,
		);
	});
	it("stop() after registered: closes cleanly with zero timers and no redial", () => {
		const h = harness();
		h.reg.setBaseUrl("wss://relay.example.com");
		h.sock().open();
		h.sock().message({ t: "challenge", nonceHex: NONCE_HEX });
		h.sock().message({ t: "registered", hostId: HOST_ID_HEX });
		h.reg.stop();
		expect(h.reg.state()).toBe("off");
		expect(h.timersCount()).toBe(0);
		expect(h.dialed).toHaveLength(1);
	});
	it("setBaseUrl to a new value restarts against the new base", () => {
		const h = harness();
		h.reg.setBaseUrl("wss://relay.example.com");
		h.sock().open();
		h.reg.setBaseUrl("wss://relay.two.example");
		expect(h.dialed.at(-1)).toBe("wss://relay.two.example/host");
		expect(h.timersCount()).toBe(0); // restart is not a loss
	});
});
