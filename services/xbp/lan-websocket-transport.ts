// services/xbp/lan-websocket-transport.ts
import { networkInterfaces } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import type { Transport } from "@xavier/xbp";
import {
	createAttachableTransport,
	type AttachableSocket,
} from "./attachable-transport.js";

type InterfacesMap = ReturnType<typeof networkInterfaces>;

// Tailscale hands out CGNAT addresses (100.64.0.0/10); a physical LAN never
// should, so range membership is what splits the two offer-candidate slots.
function isTailscaleCgnat(address: string): boolean {
	const [a, b] = address.split(".").map(Number);
	return a === 100 && b >= 64 && b <= 127;
}

export function pickPrimaryLanIPv4(ifaces: InterfacesMap): string | null {
	for (const addrs of Object.values(ifaces)) {
		for (const a of addrs ?? []) {
			if (a.family === "IPv4" && !a.internal && !isTailscaleCgnat(a.address))
				return a.address;
		}
	}
	return null;
}

export function pickTailscaleIPv4(ifaces: InterfacesMap): string | null {
	for (const addrs of Object.values(ifaces)) {
		for (const a of addrs ?? []) {
			if (a.family === "IPv4" && !a.internal && isTailscaleCgnat(a.address))
				return a.address;
		}
	}
	return null;
}

export function primaryLanIPv4(): string | null {
	return pickPrimaryLanIPv4(networkInterfaces());
}

export function tailscaleIPv4(): string | null {
	return pickTailscaleIPv4(networkInterfaces());
}

export function wsToAttachable(ws: WebSocket): AttachableSocket {
	return {
		send: (data) => ws.send(data),
		close: () => ws.close(),
		onMessage: (cb) =>
			ws.on("message", (data) => cb(new Uint8Array(data as Buffer))),
		onClose: (cb) => {
			ws.on("close", cb);
			ws.on("error", () => {});
		},
	};
}

export async function createLanWebSocketHost(
	opts: { port?: number } = {},
): Promise<{
	transport: Transport;
	port: number;
	attach(socket: AttachableSocket): void;
	close(): Promise<void>;
}> {
	const wss = new WebSocketServer({ host: "0.0.0.0", port: opts.port ?? 0 });
	await new Promise<void>((resolve, reject) => {
		wss.once("listening", resolve);
		wss.once("error", reject);
	});
	const address = wss.address();
	const port = typeof address === "object" && address ? address.port : 0;

	const { transport, attach, close } = createAttachableTransport();
	wss.on("connection", (ws) => attach(wsToAttachable(ws)));

	return {
		transport,
		port,
		attach,
		close: async () => {
			await close();
			await new Promise<void>((resolve) => wss.close(() => resolve()));
		},
	};
}
