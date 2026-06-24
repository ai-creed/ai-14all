import {
	type CommandFrame,
	type CommandResult,
	errorResult,
	parseCommandFrame,
	serializeCommandResult,
} from "./command-types";
import { createReconnectBackoff } from "./reconnect-backoff";

export type WebSocketLike = {
	send(data: string): void;
	close(): void;
	onopen: ((ev?: unknown) => void) | null;
	onmessage: ((ev: { data: unknown }) => void) | null;
	onclose: ((ev?: unknown) => void) | null;
	onerror: ((ev?: unknown) => void) | null;
};

export type WebSocketCtor = new (url: string) => WebSocketLike;

export type SamanthaCommandClientOptions = {
	url: string;
	dispatcher: { dispatch: (frame: CommandFrame) => Promise<CommandResult> };
	WebSocketImpl: WebSocketCtor;
	reconnectMs?: number; // base reconnect delay (ms); default 3000
	reconnectCapMs?: number; // backoff cap (ms); default 30000
	reconnectFactor?: number; // backoff multiplier; default 2
	random?: () => number; // injected for deterministic tests; defaults Math.random
	onStatus?: (status: "connected" | "reconnecting") => void; // plane up/down -> driver health
	log?: (message: string, error?: unknown) => void;
};

export type SamanthaCommandClient = {
	connect(): void;
	close(): void;
	isOpen(): boolean;
	reconnectNow(): void;
};

export function createSamanthaCommandClient(
	opts: SamanthaCommandClientOptions,
): SamanthaCommandClient {
	const backoff = createReconnectBackoff({
		baseMs: opts.reconnectMs ?? 3000,
		factor: opts.reconnectFactor ?? 2,
		capMs: opts.reconnectCapMs ?? 30000,
		random: opts.random,
	});
	let socket: WebSocketLike | null = null;
	let closedByUs = false;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	function clearReconnect(): void {
		if (reconnectTimer !== null) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	}

	function scheduleReconnect(): void {
		if (closedByUs || reconnectTimer !== null) return;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			open();
		}, backoff.next());
	}

	function replyOn(
		receivingSocket: WebSocketLike,
		result: CommandResult,
	): void {
		// Reply ONLY on the connection that received the command. If that socket has
		// been replaced by a reconnect (or closed), drop + log — a command result must
		// never be replayed across reconnects (spec edge case: a command is best-effort;
		// Samantha re-issues on the new connection).
		if (receivingSocket !== socket) {
			opts.log?.(
				`samantha: dropped command result for ${result.requestId} — receiving socket closed before reply`,
			);
			return;
		}
		receivingSocket.send(serializeCommandResult(result));
	}

	function handleMessage(raw: unknown, receivingSocket: WebSocketLike): void {
		// The receive handler must NEVER throw out — a bad frame must not kill the
		// socket. Parsing, dispatch, and the reply are each guarded.
		let text: string;
		try {
			text = typeof raw === "string" ? raw : String(raw);
			const json: unknown = JSON.parse(text);
			const parsed = parseCommandFrame(json);
			if (!parsed.ok) {
				if (parsed.requestId !== null)
					replyOn(
						receivingSocket,
						errorResult(
							parsed.requestId,
							"invalid-args",
							"malformed command frame",
						),
					);
				else opts.log?.("samantha: dropped uncorrelatable command frame");
				return;
			}
			void opts.dispatcher
				.dispatch(parsed.frame)
				.then((result) => replyOn(receivingSocket, result))
				.catch((error) => opts.log?.("samantha: dispatch rejected", error));
		} catch (error) {
			opts.log?.("samantha: dropped unparseable command frame", error);
		}
	}

	function open(): void {
		if (socket !== null) return; // idempotent
		closedByUs = false;
		try {
			const ws = new opts.WebSocketImpl(opts.url);
			socket = ws;
			ws.onmessage = (ev) => handleMessage(ev.data, ws);
			ws.onopen = () => {
				backoff.reset();
				opts.onStatus?.("connected");
			};
			ws.onclose = () => {
				socket = null;
				if (!closedByUs) opts.onStatus?.("reconnecting");
				scheduleReconnect();
			};
			ws.onerror = (error) =>
				opts.log?.("samantha: command socket error", error);
		} catch (error) {
			// Samantha absent / connect threw synchronously: stay inert, retry later.
			socket = null;
			opts.log?.("samantha: command socket connect failed", error);
			scheduleReconnect();
		}
	}

	return {
		connect: open,
		close() {
			closedByUs = true;
			clearReconnect();
			const ws = socket;
			socket = null;
			try {
				ws?.close();
			} catch {
				// closing an already-dead socket must not throw out of stop()/teardown.
			}
		},
		isOpen() {
			return socket !== null;
		},
		reconnectNow() {
			if (closedByUs) return; // a deliberately-closed client stays closed
			clearReconnect();
			backoff.reset();
			open(); // idempotent: a no-op if a socket already exists
		},
	};
}
