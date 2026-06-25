import { type Server, createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

export type MockSamantha = {
	readonly port: number;
	requests: { method: string; url: string; body: unknown }[];
	commandResults: unknown[];
	sendCommand(frame: Record<string, unknown>): void;
	/** Force-close the active connector WebSocket (simulate a drop). */
	dropSocket(): void;
	/** Snapshot PATCH and event POST return 404 until a fresh register arrives. */
	forgetRegistration(): void;
	/** Cumulative count of WS connections accepted (never reset across restart). */
	readonly connectionCount: number;
	/** Resolve once connectionCount >= n (polls; rejects after timeoutMs). */
	waitForConnection(n: number, timeoutMs?: number): Promise<void>;
	/** Tear the HTTP+WS server down but keep the port for a later restart(). */
	stop(): Promise<void>;
	/** Re-listen on the same port (retries to dodge TIME_WAIT). */
	restart(): Promise<void>;
	close(): Promise<void>;
};

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export async function startMockSamantha(): Promise<MockSamantha> {
	const requests: MockSamantha["requests"] = [];
	const commandResults: unknown[] = [];
	let connectorSocket: WebSocket | null = null;
	let connectionCount = 0;
	let registrationForgotten = false;
	let server: Server;
	let wss: WebSocketServer;
	let boundPort = 0;
	let live = false;

	function build(): void {
		server = createServer((req, res) => {
			let raw = "";
			req.on("data", (c) => (raw += c));
			req.on("end", () => {
				const url = req.url ?? "";
				const method = req.method ?? "";
				requests.push({ method, url, body: raw ? JSON.parse(raw) : null });
				// A fresh register clears the "forgotten" flag (Samantha came back).
				if (url === "/connectors/register") registrationForgotten = false;
				// While forgotten, snapshot PATCH and event POST 404 — exactly what a
				// restarted Samantha that dropped our registration returns.
				if (
					registrationForgotten &&
					(url === "/connectors/ai-14all/snapshot" ||
						url === "/connectors/ai-14all/events")
				) {
					res.statusCode = 404;
					res.end(JSON.stringify({ error: "not-found" }));
					return;
				}
				res.statusCode = 200;
				res.end(JSON.stringify({ ok: true }));
			});
		});

		wss = new WebSocketServer({ server, path: "/connectors/ai-14all/events" });
		wss.on("connection", (socket) => {
			connectionCount += 1;
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
	}

	async function listen(port: number): Promise<void> {
		build();
		for (let attempt = 0; ; attempt++) {
			try {
				await new Promise<void>((resolve, reject) => {
					const onError = (e: Error) => reject(e);
					server.once("error", onError);
					server.listen(port, "127.0.0.1", () => {
						server.removeListener("error", onError);
						resolve();
					});
				});
				break;
			} catch (e) {
				if (attempt >= 20) throw e; // give up after ~1s of TIME_WAIT retries
				await delay(50);
			}
		}
		boundPort = (server.address() as { port: number }).port;
		live = true;
	}

	async function teardown(): Promise<void> {
		if (!live) return;
		live = false;
		await new Promise<void>((resolve) => {
			for (const client of wss.clients) client.terminate();
			wss.close();
			server.close(() => resolve());
		});
	}

	await listen(0);

	return {
		get port() {
			return boundPort;
		},
		requests,
		commandResults,
		sendCommand(frame) {
			connectorSocket?.send(JSON.stringify(frame));
		},
		dropSocket() {
			connectorSocket?.close();
		},
		forgetRegistration() {
			registrationForgotten = true;
		},
		get connectionCount() {
			return connectionCount;
		},
		async waitForConnection(n, timeoutMs = 10000) {
			const deadline = Date.now() + timeoutMs;
			while (connectionCount < n) {
				if (Date.now() > deadline)
					throw new Error(
						`waitForConnection(${n}) timed out at ${connectionCount}`,
					);
				await delay(25);
			}
		},
		async stop() {
			await teardown();
		},
		async restart() {
			if (live) await teardown();
			await listen(boundPort);
		},
		async close() {
			await teardown();
		},
	};
}
