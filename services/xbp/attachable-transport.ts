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
 */
export function createAttachableTransport(): {
	transport: Transport;
	attach(socket: AttachableSocket): void;
	close(): Promise<void>;
} {
	const handlers = new Set<(frame: Uint8Array) => void>();
	const sockets = new Set<AttachableSocket>();
	let active: AttachableSocket | null = null;

	const attach = (socket: AttachableSocket): void => {
		sockets.add(socket);
		socket.onMessage((frame) => {
			active = socket;
			for (const h of handlers) h(frame);
		});
		socket.onClose(() => {
			sockets.delete(socket);
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
			active = null;
		},
	};

	return { transport, attach, close: () => transport.close() };
}
