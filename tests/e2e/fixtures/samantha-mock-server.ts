import { type Server, createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

export type MockSamantha = {
	port: number;
	requests: { method: string; url: string; body: unknown }[];
	commandResults: unknown[];
	sendCommand(frame: Record<string, unknown>): void;
	close(): Promise<void>;
};

export async function startMockSamantha(): Promise<MockSamantha> {
	const requests: MockSamantha["requests"] = [];
	const commandResults: unknown[] = [];
	let connectorSocket: WebSocket | null = null;

	const server: Server = createServer((req, res) => {
		let raw = "";
		req.on("data", (c) => (raw += c));
		req.on("end", () => {
			requests.push({
				method: req.method ?? "",
				url: req.url ?? "",
				body: raw ? JSON.parse(raw) : null,
			});
			res.statusCode = 200;
			res.end(JSON.stringify({ ok: true }));
		});
	});

	const wss = new WebSocketServer({
		server,
		path: "/connectors/ai-14all/events",
	});
	wss.on("connection", (socket) => {
		connectorSocket = socket;
		socket.on("message", (data) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg && msg.type === "commandResult") commandResults.push(msg);
			} catch {
				// ignore malformed frames in the mock
			}
		});
		socket.on("close", () => {
			if (connectorSocket === socket) connectorSocket = null;
		});
	});

	await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
	const port = (server.address() as { port: number }).port;
	return {
		port,
		requests,
		commandResults,
		sendCommand(frame) {
			connectorSocket?.send(JSON.stringify(frame));
		},
		close: () =>
			new Promise((r) => {
				wss.close();
				server.close(() => r());
			}),
	};
}
