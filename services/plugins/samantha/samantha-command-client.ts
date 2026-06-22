import {
	type CommandFrame,
	type CommandResult,
	errorResult,
	parseCommandFrame,
	serializeCommandResult,
} from "./command-types";

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
	reconnectMs?: number;
	log?: (message: string, error?: unknown) => void;
};

export type SamanthaCommandClient = {
	connect(): void;
	close(): void;
	isOpen(): boolean;
};

export function createSamanthaCommandClient(
	opts: SamanthaCommandClientOptions,
): SamanthaCommandClient {
	const reconnectMs = opts.reconnectMs ?? 3000;
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
		}, reconnectMs);
	}

	function handleMessage(raw: unknown): void {
		// The receive handler must NEVER throw out — a bad frame must not kill the
		// socket. Parsing, dispatch, and the reply are each guarded.
		let text: string;
		try {
			text = typeof raw === "string" ? raw : String(raw);
			const json: unknown = JSON.parse(text);
			const parsed = parseCommandFrame(json);
			if (!parsed.ok) {
				if (parsed.requestId !== null)
					socket?.send(
						serializeCommandResult(
							errorResult(
								parsed.requestId,
								"invalid-args",
								"malformed command frame",
							),
						),
					);
				else opts.log?.("samantha: dropped uncorrelatable command frame");
				return;
			}
			void opts.dispatcher
				.dispatch(parsed.frame)
				.then((result) => socket?.send(serializeCommandResult(result)))
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
			ws.onmessage = (ev) => handleMessage(ev.data);
			ws.onclose = () => {
				socket = null;
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
	};
}
