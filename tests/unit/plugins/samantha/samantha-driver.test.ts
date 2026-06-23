// tests/unit/plugins/samantha/samantha-driver.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSamanthaDriver } from "../../../../services/plugins/samantha/samantha-driver";
import type {
	SamanthaClientResult,
	SamanthaConnectorClient,
	SnapshotBody,
} from "../../../../services/plugins/samantha/samantha-connector-client";
import type { SamanthaSessionSlice } from "../../../../shared/contracts/plugins";
import type { WebSocketLike } from "../../../../services/plugins/samantha/samantha-command-client";

class FakeSocket implements WebSocketLike {
	static instances: FakeSocket[] = [];
	onopen: ((ev?: unknown) => void) | null = null;
	onmessage: ((ev: { data: unknown }) => void) | null = null;
	onclose: ((ev?: unknown) => void) | null = null;
	onerror: ((ev?: unknown) => void) | null = null;
	sent: string[] = [];
	constructor(public url: string) {
		FakeSocket.instances.push(this);
	}
	send(d: string) {
		this.sent.push(d);
	}
	close() {
		this.onclose?.();
	}
}

function okClient(overrides: Partial<SamanthaConnectorClient> = {}) {
	const calls = {
		register: [] as unknown[],
		snapshot: [] as SnapshotBody[],
		event: [] as unknown[],
		unregister: 0,
	};
	const ok: SamanthaClientResult = { ok: true };
	const client: SamanthaConnectorClient = {
		register: async (b) => {
			calls.register.push(b);
			return ok;
		},
		patchSnapshot: async (b) => {
			calls.snapshot.push(b);
			return ok;
		},
		postEvent: async (b) => {
			calls.event.push(b);
			return ok;
		},
		unregister: async () => {
			calls.unregister += 1;
			return ok;
		},
		...overrides,
	};
	return { client, calls };
}

function slice(
	attention: SamanthaSessionSlice["worktrees"][number]["attention"],
): SamanthaSessionSlice {
	return {
		worktrees: [
			{
				worktreeId: "wt1",
				provider: "claude",
				attention,
				summary: "x",
				task: null,
				nextAction: null,
				updatedAt: 1,
				recent: [],
			},
		],
		app: { focusedWorktreeId: "wt1", mode: "ready" },
	};
}

function makeDriver(client: SamanthaConnectorClient) {
	const reviewCbs: (() => void)[] = [];
	const health: { link: string }[] = [];
	const focusWorktree = vi.fn();
	const driver = createSamanthaDriver({
		client,
		getIdentities: async () => ({
			wt1: { repo: "ai-14all", branch: "main", path: "/w" },
		}),
		getReviewCount: () => 0,
		getWhisperStates: async () => [],
		subscribeReviews: (cb) => {
			reviewCbs.push(cb);
			return () => {};
		},
		subscribeWorktrees: () => () => {},
		pushHealth: (h) => health.push(h),
		now: () => 1000,
		debounceMs: 10,
		keepAliveMs: 100000,
		reconnectMs: 50,
		focusWorktree,
		webSocketImpl: FakeSocket as unknown as new (url: string) => WebSocketLike,
		commandPort: 7841,
		commandReconnectMs: 50,
	});
	return { driver, health, focusWorktree };
}

beforeEach(() => {
	vi.useFakeTimers();
	FakeSocket.instances = [];
});
afterEach(() => vi.useRealTimers());

const ctx = { reportDegraded: vi.fn(), reportLimited: vi.fn() };

describe("samantha-driver", () => {
	it("registers on start and pushes connected health", async () => {
		const { client, calls } = okClient();
		const { driver, health } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(30);
		expect(calls.register).toHaveLength(1);
		expect(health.at(-1)?.link).toBe("connected");
	});

	it("PATCHes a full snapshot then POSTs an attentionRequired event on a waiting transition", async () => {
		const { client, calls } = okClient();
		const { driver } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(30);
		driver.ingestSessionSlice(slice("active"));
		await vi.advanceTimersByTimeAsync(30);
		const snapshotsBefore = calls.snapshot.length;
		driver.ingestSessionSlice(slice("waiting"));
		await vi.advanceTimersByTimeAsync(30);
		expect(calls.snapshot.length).toBeGreaterThan(snapshotsBefore);
		expect(calls.event).toHaveLength(1);
		expect((calls.event[0] as { signal: string }).signal).toBe(
			"attentionRequired",
		);
	});

	it("skips a byte-identical snapshot (idempotent)", async () => {
		const { client, calls } = okClient();
		const { driver } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(30);
		driver.ingestSessionSlice(slice("active"));
		await vi.advanceTimersByTimeAsync(30);
		const after = calls.snapshot.length;
		driver.ingestSessionSlice(slice("active")); // identical
		await vi.advanceTimersByTimeAsync(30);
		expect(calls.snapshot.length).toBe(after);
	});

	it("does not emit an event for an active->stale (silent update) transition", async () => {
		const { client, calls } = okClient();
		const { driver } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(30);
		driver.ingestSessionSlice(slice("active"));
		await vi.advanceTimersByTimeAsync(30);
		driver.ingestSessionSlice(slice("stale"));
		await vi.advanceTimersByTimeAsync(30);
		expect(calls.event).toHaveLength(0);
	});

	it("re-registers after a 404 and reports reconnecting on a refused connection", async () => {
		let refuse = true;
		const { calls } = okClient();
		const client: SamanthaConnectorClient = {
			register: async (b) => {
				calls.register.push(b);
				return refuse ? { ok: false, reason: "refused" } : { ok: true };
			},
			patchSnapshot: async () => ({ ok: false, reason: "not-found" }),
			postEvent: async () => ({ ok: true }),
			unregister: async () => ({ ok: true }),
		};
		const { driver, health } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(30);
		expect(
			health.some(
				(h) => h.link === "reconnecting" || h.link === "samantha-not-running",
			),
		).toBe(true);
		refuse = false;
		await vi.advanceTimersByTimeAsync(120);
		expect(calls.register.length).toBeGreaterThan(1);
	});

	it("never calls reportDegraded for a transient disconnect", async () => {
		const client: SamanthaConnectorClient = {
			register: async () => ({ ok: false, reason: "refused" }),
			patchSnapshot: async () => ({ ok: false, reason: "refused" }),
			postEvent: async () => ({ ok: false, reason: "refused" }),
			unregister: async () => ({ ok: true }),
		};
		const localCtx = { reportDegraded: vi.fn(), reportLimited: vi.fn() };
		const { driver } = makeDriver(client);
		await driver.start(localCtx);
		await vi.advanceTimersByTimeAsync(120);
		expect(localCtx.reportDegraded).not.toHaveBeenCalled();
	});

	it("unregisters and pushes samantha-not-running on stop", async () => {
		const { client, calls } = okClient();
		const { driver, health } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(30);
		await driver.stop();
		expect(calls.unregister).toBe(1);
		expect(health.at(-1)?.link).toBe("samantha-not-running");
	});

	it("re-registers and re-PATCHes a fresh snapshot before posting an event after a 404", async () => {
		const order: string[] = [];
		let patchCalls = 0;
		const client: SamanthaConnectorClient = {
			register: async () => {
				order.push("register");
				return { ok: true };
			},
			patchSnapshot: async () => {
				patchCalls += 1;
				order.push("patch");
				// The waiting rebuild's first PATCH 404s (Samantha restarted);
				// the retry after re-registration succeeds.
				return patchCalls === 2
					? { ok: false, reason: "not-found" }
					: { ok: true };
			},
			postEvent: async () => {
				order.push("event");
				return { ok: true };
			},
			unregister: async () => ({ ok: true }),
		};
		const { driver } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(30);
		driver.ingestSessionSlice(slice("waiting"));
		await vi.advanceTimersByTimeAsync(30);
		// On the waiting rebuild: patch(404) -> register -> patch(ok) -> event.
		expect(order.slice(-4)).toEqual(["patch", "register", "patch", "event"]);
	});

	it("reconnects when an event POST is refused and re-emits on the next rebuild", async () => {
		const calls = { snapshot: 0, event: 0, register: 0 };
		let eventOk = false;
		const client: SamanthaConnectorClient = {
			register: async () => {
				calls.register += 1;
				return { ok: true };
			},
			patchSnapshot: async () => {
				calls.snapshot += 1;
				return { ok: true };
			},
			postEvent: async () => {
				calls.event += 1;
				return eventOk ? { ok: true } : { ok: false, reason: "refused" };
			},
			unregister: async () => ({ ok: true }),
		};
		const { driver, health } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(30);
		driver.ingestSessionSlice(slice("waiting"));
		await vi.advanceTimersByTimeAsync(30);
		expect(calls.event).toBe(1);
		expect(
			health.some(
				(h) => h.link === "reconnecting" || h.link === "samantha-not-running",
			),
		).toBe(true);
		// Link restored; the same transition is retried because lastSignals was
		// not advanced after the failed POST.
		eventOk = true;
		driver.ingestSessionSlice(slice("waiting"));
		await vi.advanceTimersByTimeAsync(80);
		expect(calls.event).toBeGreaterThan(1);
	});

	it("re-registers and re-PATCHes a fresh snapshot when an event POST 404s", async () => {
		const order: string[] = [];
		let eventCalls = 0;
		const client: SamanthaConnectorClient = {
			register: async () => {
				order.push("register");
				return { ok: true };
			},
			patchSnapshot: async () => {
				order.push("patch");
				return { ok: true };
			},
			postEvent: async () => {
				eventCalls += 1;
				order.push("event");
				// First event POST 404s (Samantha restarted); the retry succeeds.
				return eventCalls === 1
					? { ok: false, reason: "not-found" }
					: { ok: true };
			},
			unregister: async () => ({ ok: true }),
		};
		const { driver } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(30);
		driver.ingestSessionSlice(slice("waiting"));
		await vi.advanceTimersByTimeAsync(60);
		// The 404 event POST triggers re-register + an immediate fresh re-PATCH...
		const i = order.indexOf("event");
		expect(order.slice(i, i + 3)).toEqual(["event", "register", "patch"]);
		// ...and the transition is re-emitted on the scheduled follow-up rebuild.
		expect(eventCalls).toBeGreaterThan(1);
	});

	it("does not lose a forced keep-alive that fires during an in-flight rebuild (finding 1)", async () => {
		// The forced keep-alive can land while a rebuild is already in flight (mid
		// non-forced PATCH). The connection never drops, content never changes, and
		// lastBody stays seeded — so the ONLY thing that can produce a second PATCH is
		// the carried-over forced obligation. On the unfixed driver the force is lost
		// (cleared by scheduleRebuild's timer before the in-flight rebuild reads it),
		// so no keep-alive PATCH goes out until the next ~30s tick.
		const gate: { release: () => void } = { release: () => {} };
		const calls = { snapshot: 0 };
		const client: SamanthaConnectorClient = {
			register: async () => ({ ok: true }),
			patchSnapshot: async () => {
				calls.snapshot += 1;
				if (calls.snapshot === 1) {
					await new Promise<void>((resolve) => {
						gate.release = resolve;
					});
				}
				return { ok: true };
			},
			postEvent: async () => ({ ok: true }),
			unregister: async () => ({ ok: true }),
		};
		const driver = createSamanthaDriver({
			client,
			// Content is fixed: after the first PATCH seeds lastBody, only a FORCED
			// rebuild can produce another PATCH (content is byte-identical otherwise).
			getIdentities: async () => ({
				wt1: { repo: "ai-14all", branch: "main", path: "/w" },
			}),
			getReviewCount: () => 0,
			getWhisperStates: async () => [],
			subscribeReviews: () => () => {},
			subscribeWorktrees: () => () => {},
			pushHealth: () => {},
			now: () => 1000,
			debounceMs: 10,
			keepAliveMs: 25,
			reconnectMs: 50,
			focusWorktree: () => {},
		});
		await driver.start(ctx);
		// The start rebuild reaches its (hanging) first PATCH and seeds lastBody.
		// (cumulative ~15ms; the start debounce fired at 10ms.)
		await vi.advanceTimersByTimeAsync(15);
		expect(calls.snapshot).toBe(1);
		// While that first rebuild is still mid-PATCH, ONE keep-alive tick (25ms)
		// fires a FORCED rebuild (its debounce fires ~35ms). It must coalesce — not
		// start a second overlapping PATCH — and its forced obligation must persist.
		// (cumulative ~40ms, still before the next keep-alive tick at 50ms.)
		await vi.advanceTimersByTimeAsync(25);
		expect(calls.snapshot).toBe(1); // no overlap; first PATCH still hung
		// Release the hung PATCH; the coalesced pass runs as a FORCED rebuild and
		// emits a second PATCH even though content is unchanged. Stop before the next
		// keep-alive tick (50ms) so no extra forced PATCH is counted.
		gate.release();
		await vi.advanceTimersByTimeAsync(8);
		expect(calls.snapshot).toBe(2);
		await driver.stop();
	});

	it("serializes overlapping rebuilds and runs exactly one coalesced pass (finding 2)", async () => {
		// A controllable PATCH: the first call hangs on a deferred promise so a
		// second trigger arrives while the first rebuild is mid-PATCH.
		const gate: { release: () => void } = { release: () => {} };
		const calls = { snapshot: 0, event: 0 };
		const client: SamanthaConnectorClient = {
			register: async () => ({ ok: true }),
			patchSnapshot: async () => {
				calls.snapshot += 1;
				if (calls.snapshot === 1) {
					await new Promise<void>((resolve) => {
						gate.release = resolve;
					});
				}
				return { ok: true };
			},
			postEvent: async () => {
				calls.event += 1;
				return { ok: true };
			},
			unregister: async () => ({ ok: true }),
		};
		const driver = createSamanthaDriver({
			client,
			getIdentities: async () => ({
				wt1: { repo: "ai-14all", branch: "main", path: "/w" },
			}),
			getReviewCount: () => 0,
			getWhisperStates: async () => [],
			subscribeReviews: () => () => {},
			subscribeWorktrees: () => () => {},
			pushHealth: () => {},
			now: () => 1000,
			debounceMs: 10,
			keepAliveMs: 100000,
			reconnectMs: 50,
			focusWorktree: () => {},
		});
		await driver.start(ctx);
		// Let the start rebuild reach its (hanging) first PATCH.
		await vi.advanceTimersByTimeAsync(15);
		expect(calls.snapshot).toBe(1); // exactly one rebuild in flight, mid-PATCH
		// Fire a second trigger while the first is still mid-PATCH. It must NOT start
		// a second overlapping rebuild — it coalesces into one follow-up pass.
		driver.ingestSessionSlice(slice("waiting"));
		await vi.advanceTimersByTimeAsync(15);
		expect(calls.snapshot).toBe(1); // still no overlap; second rebuild not started
		// Release the hung first PATCH; exactly one coalesced pass runs afterward.
		gate.release();
		await vi.advanceTimersByTimeAsync(15);
		expect(calls.snapshot).toBe(2); // one extra pass, not two
		// The coalesced pass saw the waiting slice and emitted exactly one event.
		expect(calls.event).toBe(1);
		await driver.stop();
	});

	it("swallows a throw from getWhisperStates without crashing and recovers", async () => {
		// The first rebuild's getWhisperStates throws (e.g. a Whisper state.db read
		// error). The driver must swallow it as a failed transient cycle — never let
		// it become an unhandled rejection in main (this test passing proves no
		// unhandled rejection failed the suite) — and recover on a later rebuild.
		let whisperThrew = false;
		const { client, calls } = okClient();
		const driver = createSamanthaDriver({
			client,
			getIdentities: async () => ({
				wt1: { repo: "ai-14all", branch: "main", path: "/w" },
			}),
			getReviewCount: () => 0,
			getWhisperStates: async () => {
				if (!whisperThrew) {
					whisperThrew = true;
					throw new Error("state.db read failed");
				}
				return [];
			},
			subscribeReviews: () => () => {},
			subscribeWorktrees: () => () => {},
			pushHealth: () => {},
			now: () => 1000,
			debounceMs: 10,
			keepAliveMs: 100000,
			reconnectMs: 50,
			focusWorktree: () => {},
		});
		await driver.start(ctx);
		// The first rebuild throws inside getWhisperStates; it must be swallowed.
		await vi.advanceTimersByTimeAsync(30);
		// Now feed a waiting slice and advance: getWhisperStates returns [] this time,
		// so the driver recovers and PATCHes at least one snapshot.
		driver.ingestSessionSlice(slice("waiting"));
		await vi.advanceTimersByTimeAsync(30);
		expect(calls.snapshot.length).toBeGreaterThan(0);
		await driver.stop();
	});

	it("sends a keep-alive PATCH even when content is unchanged", async () => {
		const { client, calls } = okClient();
		const driver = createSamanthaDriver({
			client,
			getIdentities: async () => ({
				wt1: { repo: "ai-14all", branch: "main", path: "/w" },
			}),
			getReviewCount: () => 0,
			getWhisperStates: async () => [],
			subscribeReviews: () => () => {},
			subscribeWorktrees: () => () => {},
			pushHealth: () => {},
			now: () => 1000,
			debounceMs: 10,
			keepAliveMs: 50,
			reconnectMs: 50,
			focusWorktree: () => {},
		});
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(30);
		const after = calls.snapshot.length;
		// No content change; only the keep-alive timer fires (forced PATCH).
		await vi.advanceTimersByTimeAsync(80);
		expect(calls.snapshot.length).toBeGreaterThan(after);
	});

	it("advertises the two capabilities in the register body", async () => {
		const { client, calls } = okClient();
		const { driver } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(20);
		expect(calls.register[0]).toMatchObject({
			capabilities: [
				{ id: "focus-worktree", title: expect.any(String) },
				{ id: "session-report", title: expect.any(String) },
			],
		});
	});

	it("opens the command socket after a successful register and closes it on stop", async () => {
		const { client } = okClient();
		const { driver } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(20);
		expect(FakeSocket.instances).toHaveLength(1);
		const sock = FakeSocket.instances[0];
		expect(sock.url).toBe("ws://127.0.0.1:7841/connectors/ai-14all/events");
		await driver.stop();
		// close() fired onclose; the driver does not reopen after stop.
		await vi.advanceTimersByTimeAsync(200);
		expect(FakeSocket.instances).toHaveLength(1);
	});

	it("a session-report command over the socket is answered with the rendered report", async () => {
		const { client } = okClient();
		const { driver } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(20);
		const sock = FakeSocket.instances[0];
		sock.onmessage?.({
			data: JSON.stringify({
				type: "command",
				capabilityId: "session-report",
				requestId: "r1",
			}),
		});
		await vi.waitFor(() => expect(sock.sent).toHaveLength(1));
		const reply = JSON.parse(sock.sent[0]);
		expect(reply).toMatchObject({ requestId: "r1", status: "ok" });
		expect(typeof reply.result.report).toBe("string");
	});

	it("a focus-worktree command resolves the key and invokes focusWorktree", async () => {
		const { client } = okClient();
		const { driver, focusWorktree } = makeDriver(client);
		await driver.start(ctx);
		await vi.advanceTimersByTimeAsync(20);
		const sock = FakeSocket.instances[0];
		sock.onmessage?.({
			data: JSON.stringify({
				type: "command",
				capabilityId: "focus-worktree",
				requestId: "r2",
				args: { worktree: "ai-14all/main" },
			}),
		});
		await vi.waitFor(() => expect(focusWorktree).toHaveBeenCalledWith("wt1"));
		expect(JSON.parse(sock.sent[0])).toMatchObject({
			requestId: "r2",
			status: "ok",
			result: { focused: "ai-14all/main" },
		});
	});
});
