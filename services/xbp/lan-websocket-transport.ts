// services/xbp/lan-websocket-transport.ts
import { networkInterfaces } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import type { Transport } from "@xavier/xbp";

export function primaryLanIPv4(): string | null {
	for (const addrs of Object.values(networkInterfaces())) {
		for (const a of addrs ?? []) {
			if (a.family === "IPv4" && !a.internal) return a.address;
		}
	}
	return null;
}

export async function createLanWebSocketHost(
	opts: { port?: number } = {},
): Promise<{ transport: Transport; port: number; close(): Promise<void> }> {
	const wss = new WebSocketServer({ host: "0.0.0.0", port: opts.port ?? 0 });
	await new Promise<void>((resolve, reject) => {
		wss.once("listening", resolve);
		wss.once("error", reject);
	});
	const address = wss.address();
	const port = typeof address === "object" && address ? address.port : 0;

	const handlers = new Set<(frame: Uint8Array) => void>();
	let socket: WebSocket | null = null;
	wss.on("connection", (ws) => {
		socket = ws;
		ws.on("message", (data) => {
			const frame = new Uint8Array(data as Buffer);
			for (const h of handlers) h(frame);
		});
		ws.on("error", () => {});
		ws.on("close", () => {
			if (socket === ws) socket = null;
		});
	});

	const transport: Transport = {
		send: async (frame) => {
			socket?.send(frame);
		},
		onFrame: (handler) => {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
		close: async () => {
			await new Promise<void>((resolve) => wss.close(() => resolve()));
		},
	};

	return {
		transport,
		port,
		close: () => transport.close(),
	};
}
