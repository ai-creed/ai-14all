// services/xbp/attachable-transport.ts
import type { Transport } from "@xavier/xbp";

export interface AttachableSocket {
	send(data: Uint8Array): void;
	close(): void;
	onMessage(cb: (frame: Uint8Array) => void): void;
	onClose(cb: () => void): void;
}

/**
 * One Transport, many attachable sockets (LAN accepts and relay accept-dials
 * share it — child spec §2). Replies route to the socket the last inbound
 * frame arrived on; a fresh attach becomes active until a frame says
 * otherwise. The peer session cannot tell the transports apart.
 *
 * Generations exist so push-wake suppression can bind an authenticated call
 * to the specific socket that carried it (child spec §3 gate 2).
 */
export function createAttachableTransport(): {
	transport: Transport;
	attach(socket: AttachableSocket): void;
	currentInboundGeneration(): number | null;
	isSocketLive(generation: number): boolean;
	close(): Promise<void>;
} {
	const handlers = new Set<(frame: Uint8Array) => void>();
	const sockets = new Set<AttachableSocket>();
	let active: AttachableSocket | null = null;
	let nextGeneration = 1;
	const generations = new Map<AttachableSocket, number>();

	const attach = (socket: AttachableSocket): void => {
		sockets.add(socket);
		generations.set(socket, nextGeneration++);
		socket.onMessage((frame) => {
			active = socket;
			for (const h of handlers) h(frame);
		});
		socket.onClose(() => {
			sockets.delete(socket);
			generations.delete(socket);
			if (active === socket) active = null;
		});
		active = socket;
	};

	const transport: Transport = {
		send: async (frame) => {
			active?.send(frame);
		},
		onFrame: (handler) => {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
		close: async () => {
			for (const s of [...sockets]) s.close();
			sockets.clear();
			generations.clear();
			active = null;
		},
	};

	return {
		transport,
		attach,
		currentInboundGeneration: (): number | null =>
			active ? (generations.get(active) ?? null) : null,
		isSocketLive: (generation: number): boolean =>
			[...generations.values()].includes(generation),
		close: () => transport.close(),
	};
}
