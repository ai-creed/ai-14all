import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSamanthaCommandClient } from "../../../../services/plugins/samantha/samantha-command-client";
import type { WebSocketLike } from "../../../../services/plugins/samantha/samantha-command-client";
import type {
	CommandFrame,
	CommandResult,
} from "../../../../services/plugins/samantha/command-types";

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

	it("does not replay a dispatcher result across a reconnect (drops if the receiving socket closed)", async () => {
		let resolveDispatch!: (r: CommandResult) => void;
		const pending = new Promise<CommandResult>((res) => {
			resolveDispatch = res;
		});
		const slowDispatcher = { dispatch: vi.fn(() => pending) };
		const client = createSamanthaCommandClient({
			url: "ws://127.0.0.1:7841/connectors/ai-14all/events",
			dispatcher: slowDispatcher,
			WebSocketImpl: FakeSocket as unknown as new (
				url: string,
			) => WebSocketLike,
			reconnectMs: 50,
		});
		client.connect();
		const sockA = FakeSocket.instances[0];
		// Command arrives on socket A; dispatch is still pending.
		sockA.onmessage?.({
			data: JSON.stringify({
				type: "command",
				capabilityId: "session-report",
				requestId: "r1",
			}),
		});
		// Socket A drops before the result is ready; reconnect opens socket B.
		sockA.onclose?.();
		vi.advanceTimersByTime(50);
		const sockB = FakeSocket.instances[1];
		expect(sockB).toBeDefined();
		// The original command's dispatch now resolves — its result must NOT be sent
		// on the new socket B (no replay across reconnect), nor on the dead socket A.
		resolveDispatch({
			type: "commandResult",
			requestId: "r1",
			status: "ok",
			result: { report: "late" },
		});
		await pending;
		await Promise.resolve();
		expect(sockB.sent).toHaveLength(0);
		expect(sockA.sent).toHaveLength(0);
	});

	it("reconnect timing follows the backoff curve (random pinned to 0)", () => {
		const client = createSamanthaCommandClient({
			url: "ws://127.0.0.1:7841/connectors/ai-14all/events",
			dispatcher: okDispatcher,
			WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocketLike,
			reconnectMs: 1000,
			reconnectCapMs: 30000,
			reconnectFactor: 2,
			random: () => 0,
		});
		client.connect();
		FakeSocket.instances[0].onclose?.(); // schedule attempt 0 -> raw 1000 -> 500ms
		vi.advanceTimersByTime(499);
		expect(FakeSocket.instances).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(FakeSocket.instances).toHaveLength(2); // fired at 500ms
		FakeSocket.instances[1].onclose?.(); // attempt 1 -> raw 2000 -> 1000ms
		vi.advanceTimersByTime(999);
		expect(FakeSocket.instances).toHaveLength(2);
		vi.advanceTimersByTime(1);
		expect(FakeSocket.instances).toHaveLength(3); // fired at 1000ms
	});

	it("a successful open resets the backoff (the next outage starts from base)", () => {
		const client = createSamanthaCommandClient({
			url: "ws://127.0.0.1:7841/connectors/ai-14all/events",
			dispatcher: okDispatcher,
			WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocketLike,
			reconnectMs: 1000,
			random: () => 0,
		});
		client.connect();
		FakeSocket.instances[0].onclose?.(); // attempt 0 -> 500ms
		vi.advanceTimersByTime(500);
		const s1 = FakeSocket.instances[1];
		s1.onopen?.(); // <- successful open resets the backoff
		s1.onclose?.(); // attempt 0 AGAIN -> 500ms (not 1000ms)
		vi.advanceTimersByTime(499);
		expect(FakeSocket.instances).toHaveLength(2);
		vi.advanceTimersByTime(1);
		expect(FakeSocket.instances).toHaveLength(3);
	});

	it("reconnectNow() cancels the backoff wait and opens immediately", () => {
		const client = createSamanthaCommandClient({
			url: "ws://127.0.0.1:7841/connectors/ai-14all/events",
			dispatcher: okDispatcher,
			WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocketLike,
			reconnectMs: 1000,
			random: () => 0,
		});
		client.connect();
		FakeSocket.instances[0].onclose?.(); // schedule reconnect at 500ms
		client.reconnectNow(); // cancel the timer + open right now
		expect(FakeSocket.instances).toHaveLength(2);
		vi.advanceTimersByTime(2000);
		expect(FakeSocket.instances).toHaveLength(2); // the canceled timer never fired
	});

	it("reconnectNow() is a no-op on an already-open socket (idempotent)", () => {
		const client = createSamanthaCommandClient({
			url: "ws://127.0.0.1:7841/connectors/ai-14all/events",
			dispatcher: okDispatcher,
			WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocketLike,
			reconnectMs: 1000,
			random: () => 0,
		});
		client.connect();
		client.reconnectNow();
		expect(FakeSocket.instances).toHaveLength(1);
	});

	it("reports onStatus 'connected' on open and 'reconnecting' on an unexpected close", () => {
		const statuses: string[] = [];
		const client = createSamanthaCommandClient({
			url: "ws://127.0.0.1:7841/connectors/ai-14all/events",
			dispatcher: okDispatcher,
			WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocketLike,
			reconnectMs: 1000,
			random: () => 0,
			onStatus: (s) => statuses.push(s),
		});
		client.connect();
		FakeSocket.instances[0].onopen?.();
		expect(statuses).toEqual(["connected"]);
		FakeSocket.instances[0].onclose?.();
		expect(statuses).toEqual(["connected", "reconnecting"]);
	});

	it("does NOT report 'reconnecting' when the client is closed deliberately", () => {
		const statuses: string[] = [];
		const client = createSamanthaCommandClient({
			url: "ws://127.0.0.1:7841/connectors/ai-14all/events",
			dispatcher: okDispatcher,
			WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocketLike,
			reconnectMs: 1000,
			random: () => 0,
			onStatus: (s) => statuses.push(s),
		});
		client.connect();
		client.close();
		expect(statuses).not.toContain("reconnecting");
	});
});
