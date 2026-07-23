// tests/fixtures/fake-relay.ts
import { createServer, type Server } from "node:https";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";

// Derived from import.meta.url, not __dirname: this package is "type":"module",
// and the Playwright e2e run loads this fixture as a native ES module where
// __dirname is undefined (vitest injects it, Playwright's loader does not).
const TLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "tls");

// Frame values are pinned to the vendor relay schema (protocol/relay.ts):
// nonceHex/hostId are 64-char hex, the accept token 32-char hex. The host's
// RelayHostBound.safeParse rejects anything shorter, so the fixture speaks
// schema-valid hex even though it never verifies the challenge signature.
const NONCE_HEX = "00".repeat(32); // 64 hex chars (32-byte nonce)
const HOST_ID_HEX = "ab".repeat(32); // 64 hex chars (32-byte host id)

/**
 * Fake relay for tests: registers any host (challenge-response accepted
 * unverified — the host cannot tell), pushes incoming-session on demand,
 * and hands the test the relay end of each accepted host socket. Frames
 * follow umbrella §6.3 (`t` discriminator); failures close, never error.
 */
export async function startFakeRelay(): Promise<{
	baseUrl: string; // wss://127.0.0.1:<port>
	pushIncomingSession(token: string): void;
	waitForAccept(token: string): Promise<WebSocket>;
	close(): Promise<void>;
}> {
	const server: Server = createServer({
		cert: readFileSync(join(TLS_DIR, "localhost-cert.pem")),
		key: readFileSync(join(TLS_DIR, "localhost-key.pem")),
	});
	const wss = new WebSocketServer({ server });
	let control: WebSocket | null = null;
	const acceptWaiters = new Map<string, (ws: WebSocket) => void>();

	wss.on("connection", (ws, req) => {
		const url = req.url ?? "";
		if (url === "/host") {
			control = ws;
			ws.on("message", (raw) => {
				const msg = JSON.parse(String(raw)) as { t: string };
				if (msg.t === "register") {
					ws.send(JSON.stringify({ t: "challenge", nonceHex: NONCE_HEX }));
				} else if (msg.t === "challenge-response") {
					ws.send(JSON.stringify({ t: "registered", hostId: HOST_ID_HEX }));
				} else {
					ws.close(4400);
				}
			});
			return;
		}
		const accept = /^\/accept\/(.+)$/.exec(url);
		if (accept) {
			acceptWaiters.get(accept[1])?.(ws);
			acceptWaiters.delete(accept[1]);
			return;
		}
		ws.close(4400);
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;

	return {
		baseUrl: `wss://127.0.0.1:${port}`,
		pushIncomingSession: (token) =>
			control?.send(JSON.stringify({ t: "incoming-session", token })),
		waitForAccept: (token) =>
			new Promise<WebSocket>((resolve) => acceptWaiters.set(token, resolve)),
		close: async () => {
			// Forcibly drop every live socket first. ws' WebSocketServer.close()
			// leaves existing connections open when the server was created around an
			// external http(s).Server (our case), and node's https server.close()
			// then never fires its callback while a socket is still up — so without
			// this the close() promise hangs AND a registered host never sees the
			// disconnect that drives it into its retry/backoff state.
			for (const ws of wss.clients) ws.terminate();
			wss.close();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
