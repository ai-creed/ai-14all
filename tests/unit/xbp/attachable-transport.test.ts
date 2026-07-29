import { describe, expect, it } from "vitest";
import {
	createAttachableTransport,
	type AttachableSocket,
} from "../../../services/xbp/attachable-transport";

function fakeSocket() {
	const sent: Uint8Array[] = [];
	let onMessage: ((f: Uint8Array) => void) | null = null;
	let onClose: (() => void) | null = null;
	const socket: AttachableSocket = {
		send: (d) => sent.push(d),
		close: () => onClose?.(),
		onMessage: (cb) => (onMessage = cb),
		onClose: (cb) => (onClose = cb),
	};
	return {
		socket,
		sent,
		receive: (f: Uint8Array) => onMessage?.(f),
		drop: () => onClose?.(),
	};
}

describe("createAttachableTransport", () => {
	it("fans inbound frames from any attached socket to all handlers", async () => {
		const { transport, attach } = createAttachableTransport();
		const got: Uint8Array[] = [];
		transport.onFrame((f) => got.push(f));
		const a = fakeSocket();
		const b = fakeSocket();
		attach(a.socket);
		attach(b.socket);
		a.receive(new Uint8Array([1]));
		b.receive(new Uint8Array([2]));
		expect(got.map((f) => f[0])).toEqual([1, 2]);
	});
	it("routes send to the socket the last frame arrived on (reply-to-source)", async () => {
		const { transport, attach } = createAttachableTransport();
		transport.onFrame(() => {});
		const a = fakeSocket();
		const b = fakeSocket();
		attach(a.socket);
		attach(b.socket); // newest attach is active until a frame says otherwise
		a.receive(new Uint8Array([1]));
		await transport.send(new Uint8Array([9]));
		expect(a.sent).toHaveLength(1);
		expect(b.sent).toHaveLength(0);
	});
	it("newest attach becomes active when no frame has arrived yet", async () => {
		const { transport, attach } = createAttachableTransport();
		const a = fakeSocket();
		const b = fakeSocket();
		attach(a.socket);
		attach(b.socket);
		await transport.send(new Uint8Array([9]));
		expect(b.sent).toHaveLength(1);
	});
	it("drops the active socket on close and send becomes a no-op", async () => {
		const { transport, attach } = createAttachableTransport();
		const a = fakeSocket();
		attach(a.socket);
		a.drop();
		await transport.send(new Uint8Array([9])); // must not throw
		expect(a.sent).toHaveLength(0);
	});
	it("onFrame unsubscribe stops delivery", () => {
		const { transport, attach } = createAttachableTransport();
		const got: Uint8Array[] = [];
		const off = transport.onFrame((f) => got.push(f));
		const a = fakeSocket();
		attach(a.socket);
		off();
		a.receive(new Uint8Array([1]));
		expect(got).toHaveLength(0);
	});

	it("assigns increasing generations and reports the active socket's generation", () => {
		const t = createAttachableTransport();
		const a = fakeSocket();
		const b = fakeSocket();
		t.attach(a.socket);
		t.attach(b.socket);
		// b attached last => active
		const genB = t.currentInboundGeneration();
		expect(genB).not.toBeNull();
		a.receive(new Uint8Array([1])); // frame delivery flips active to a
		const genA = t.currentInboundGeneration();
		expect(genA).not.toBeNull();
		expect(genA).not.toBe(genB);
	});

	it("isSocketLive tracks the specific socket's lifetime", () => {
		const t = createAttachableTransport();
		const a = fakeSocket();
		const b = fakeSocket();
		t.attach(a.socket);
		a.receive(new Uint8Array([1]));
		const genA = t.currentInboundGeneration() as number;
		t.attach(b.socket);
		expect(t.isSocketLive(genA)).toBe(true);
		a.drop();
		expect(t.isSocketLive(genA)).toBe(false); // a is gone even though b remains open
	});

	it("currentInboundGeneration is null when the active socket closed", () => {
		const t = createAttachableTransport();
		const a = fakeSocket();
		t.attach(a.socket);
		a.drop();
		expect(t.currentInboundGeneration()).toBeNull();
	});
});
