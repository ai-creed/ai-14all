import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSamanthaCommandClient } from "../../../../services/plugins/samantha/samantha-command-client";
import type { WebSocketLike } from "../../../../services/plugins/samantha/samantha-command-client";
import type { CommandFrame } from "../../../../services/plugins/samantha/command-types";

class FakeSocket implements WebSocketLike {
	static instances: FakeSocket[] = [];
	onopen: ((ev?: unknown) => void) | null = null;
	onmessage: ((ev: { data: unknown }) => void) | null = null;
	onclose: ((ev?: unknown) => void) | null = null;
	onerror: ((ev?: unknown) => void) | null = null;
	sent: string[] = [];
	closed = false;
	constructor(public url: string) {
		FakeSocket.instances.push(this);
	}
	send(data: string) {
		this.sent.push(data);
	}
	close() {
		this.closed = true;
		this.onclose?.();
	}
}

const okDispatcher = {
	dispatch: vi.fn(async (frame: CommandFrame) => ({
		type: "commandResult" as const,
		requestId: frame.requestId,
		status: "ok" as const,
		result: { focused: "ai-14all/main" },
	})),
};

function make(reconnectMs = 50) {
	return createSamanthaCommandClient({
		url: "ws://127.0.0.1:7841/connectors/ai-14all/events",
		dispatcher: okDispatcher,
		WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocketLike,
		reconnectMs,
	});
}

beforeEach(() => {
	FakeSocket.instances = [];
	okDispatcher.dispatch.mockClear();
	vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("samantha-command-client", () => {
	it("connect() opens one socket; a valid frame is dispatched and the result is sent back", async () => {
		const client = make();
		client.connect();
		expect(FakeSocket.instances).toHaveLength(1);
		const sock = FakeSocket.instances[0];
		sock.onmessage?.({
			data: JSON.stringify({
				type: "command",
				capabilityId: "focus-worktree",
				requestId: "req_1",
				args: { worktree: "ai-14all/main" },
			}),
		});
		await vi.waitFor(() => expect(sock.sent).toHaveLength(1));
		expect(JSON.parse(sock.sent[0])).toMatchObject({
			type: "commandResult",
			requestId: "req_1",
			status: "ok",
		});
	});

	it("a schema-invalid frame with a recoverable requestId answers invalid-args without throwing", async () => {
		const client = make();
		client.connect();
		const sock = FakeSocket.instances[0];
		expect(() =>
			sock.onmessage?.({
				data: JSON.stringify({ type: "event", requestId: "req_9" }),
			}),
		).not.toThrow();
		await vi.waitFor(() => expect(sock.sent).toHaveLength(1));
		expect(JSON.parse(sock.sent[0])).toMatchObject({
			requestId: "req_9",
			status: "error",
			error: { code: "invalid-args" },
		});
		expect(okDispatcher.dispatch).not.toHaveBeenCalled();
	});

	it("an unparseable frame with no requestId is dropped (no send, no throw)", async () => {
		const client = make();
		client.connect();
		const sock = FakeSocket.instances[0];
		expect(() => sock.onmessage?.({ data: "}{not json" })).not.toThrow();
		expect(() =>
			sock.onmessage?.({ data: JSON.stringify({ type: "x" }) }),
		).not.toThrow();
		expect(sock.sent).toHaveLength(0);
	});

	it("an unexpected close schedules a reconnect", () => {
		const client = make(50);
		client.connect();
		FakeSocket.instances[0].onclose?.();
		expect(FakeSocket.instances).toHaveLength(1);
		vi.advanceTimersByTime(50);
		expect(FakeSocket.instances).toHaveLength(2);
	});

	it("close() prevents any reconnect", () => {
		const client = make(50);
		client.connect();
		client.close();
		vi.advanceTimersByTime(200);
		expect(FakeSocket.instances).toHaveLength(1);
	});

	it("connect() is idempotent while a socket exists", () => {
		const client = make();
		client.connect();
		client.connect();
		expect(FakeSocket.instances).toHaveLength(1);
	});
});
