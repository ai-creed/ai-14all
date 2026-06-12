import { connect } from "node:net";
import { z } from "zod";

export const WHISPER_EVENT_PROTOCOL_VERSION = "1";
const HELLO_TIMEOUT_MS = 3000;

const HelloFrameSchema = z.object({
	type: z.literal("hello"),
	engineVersion: z.string(),
	protocolVersion: z.string(),
});

const EventFrameSchema = z.object({
	type: z.literal("event"),
	name: z.string(),
	payload: z.unknown(),
	ts: z.string(),
});

export type WhisperEventSocketClient = {
	close(): void;
};

export type WhisperEventSocketHandlers = {
	onEvent: (name: string, payload: unknown) => void;
	/** Fired once on disconnect or protocol garbage — the fallback signal. */
	onClose: () => void;
};

/**
 * Connects to a per-collab daemon event socket. Resolves null when the socket
 * is absent, unreachable, or the hello handshake fails — callers fall back to
 * DB polling; never throws.
 */
export function connectWhisperEventSocket(
	socketPath: string,
	handlers: WhisperEventSocketHandlers,
): Promise<WhisperEventSocketClient | null> {
	return new Promise((resolve) => {
		const socket = connect(socketPath);
		let buffer = "";
		let helloSeen = false;
		let settled = false;
		let closedFired = false;

		const fireClose = () => {
			if (closedFired) return;
			closedFired = true;
			handlers.onClose();
		};

		const fail = () => {
			clearTimeout(helloTimer);
			socket.destroy();
			if (!settled) {
				settled = true;
				closedFired = true; // resolved null — suppress all future onClose calls
				resolve(null);
			} else if (helloSeen) {
				fireClose();
			}
			// settled && !helloSeen: already resolved null, nothing more to do
		};

		// Safe to reference from `fail`: events/timeouts can only fire after
		// this synchronous block completes, by which point it is assigned.
		const helloTimer = setTimeout(fail, HELLO_TIMEOUT_MS);

		socket.on("error", fail);
		socket.on("close", () => {
			if (settled && helloSeen) fireClose();
			else fail();
		});

		socket.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			let newline = buffer.indexOf("\n");
			while (newline !== -1) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
				if (line.length === 0) continue;
				let parsed: unknown;
				try {
					parsed = JSON.parse(line);
				} catch {
					fail();
					return;
				}
				if (!helloSeen) {
					const hello = HelloFrameSchema.safeParse(parsed);
					if (
						!hello.success ||
						hello.data.protocolVersion !== WHISPER_EVENT_PROTOCOL_VERSION
					) {
						fail();
						return;
					}
					helloSeen = true;
					clearTimeout(helloTimer);
					settled = true;
					resolve({
						close() {
							clearTimeout(helloTimer);
							closedFired = true; // intentional close is not a fallback signal
							socket.destroy();
						},
					});
					continue;
				}
				const event = EventFrameSchema.safeParse(parsed);
				if (!event.success) {
					fail();
					return;
				}
				handlers.onEvent(event.data.name, event.data.payload);
			}
		});
	});
}
