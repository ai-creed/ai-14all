import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectWhisperEventSocket } from "../../../services/plugins/whisper/whisper-event-socket";

let dir: string;
let socketPath: string;
let server: Server | null = null;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ofa-evsock-"));
	socketPath = join(dir, "events-c1.sock");
});

afterEach(async () => {
	if (server) await new Promise((r) => server?.close(r));
	server = null;
	rmSync(dir, { recursive: true, force: true });
});

function serve(onConnection: (socket: Socket) => void): Promise<void> {
	server = createServer(onConnection);
	return new Promise((resolve) => server?.listen(socketPath, () => resolve()));
}

const HELLO = `${JSON.stringify({ type: "hello", engineVersion: "0.6.0", protocolVersion: "1" })}\n`;

describe("connectWhisperEventSocket", () => {
	it("connects, validates hello, and delivers events", async () => {
		await serve((socket) => {
			socket.write(HELLO);
			socket.write(
				`${JSON.stringify({ type: "event", name: "workflow.halted", payload: { workflowId: "wf1", reason: "boom" }, ts: "t" })}\n`,
			);
		});
		const events: string[] = [];
		const client = await connectWhisperEventSocket(socketPath, {
			onEvent: (name) => events.push(name),
			onClose: () => {},
		});
		expect(client).not.toBeNull();
		await new Promise((r) => setTimeout(r, 50));
		expect(events).toEqual(["workflow.halted"]);
		client?.close();
	});

	it("rejects a protocol-version mismatch (returns null)", async () => {
		await serve((socket) => {
			socket.write(
				`${JSON.stringify({ type: "hello", engineVersion: "9.0.0", protocolVersion: "99" })}\n`,
			);
		});
		const client = await connectWhisperEventSocket(socketPath, {
			onEvent: () => {},
			onClose: () => {},
		});
		expect(client).toBeNull();
	});

	it("returns null when the socket does not exist", async () => {
		const client = await connectWhisperEventSocket(join(dir, "nope.sock"), {
			onEvent: () => {},
			onClose: () => {},
		});
		expect(client).toBeNull();
	});

	it("garbage frames after hello trigger onClose (fallback signal)", async () => {
		await serve((socket) => {
			socket.write(HELLO);
			socket.write("this is not json\n");
		});
		let closed = false;
		const client = await connectWhisperEventSocket(socketPath, {
			onEvent: () => {},
			onClose: () => {
				closed = true;
			},
		});
		expect(client).not.toBeNull();
		await new Promise((r) => setTimeout(r, 50));
		expect(closed).toBe(true);
	});

	it("server disconnect triggers onClose", async () => {
		await serve((socket) => {
			socket.write(HELLO);
			setTimeout(() => socket.destroy(), 20);
		});
		let closed = false;
		await connectWhisperEventSocket(socketPath, {
			onEvent: () => {},
			onClose: () => {
				closed = true;
			},
		});
		await new Promise((r) => setTimeout(r, 80));
		expect(closed).toBe(true);
	});
});
