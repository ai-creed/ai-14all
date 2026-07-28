import { describe, it, expect, vi } from "vitest";
import {
	createPushWakeSender,
	EXPO_PUSH_ENDPOINT,
	PUSH_WAKE_TITLE,
} from "../../../services/xbp/push-wake-sender";

const TOKEN = "ExponentPushToken[abc]";

function okResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200 });
}

function makeSender(fetchImpl: typeof fetch, token: string | null = TOKEN) {
	const clearToken = vi.fn();
	const sender = createPushWakeSender({
		loadToken: () => token,
		clearToken,
		fetchImpl,
		retryDelayMs: 0,
	});
	return { sender, clearToken };
}

describe("push-wake sender", () => {
	it("no token stored → no-token, no network call", async () => {
		const fetchSpy = vi.fn();
		const { sender } = makeSender(fetchSpy as unknown as typeof fetch, null);
		await expect(sender.send()).resolves.toBe("no-token");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("sends a visible, still content-free payload: exactly {to,title,mutableContent,sound} — no body/data/category", async () => {
		const fetchSpy = vi.fn(async () =>
			okResponse({ data: [{ status: "ok" }] }),
		);
		const { sender } = makeSender(fetchSpy as unknown as typeof fetch);
		await expect(sender.send()).resolves.toBe("sent");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe(EXPO_PUSH_ENDPOINT);
		const payload = JSON.parse(String(init.body));
		// The spec's test: no session id, no category, no free-text content
		// beyond the constant banner title. The ONLY keys on the wire are the
		// token, the constant title, and the visible-alert delivery flags.
		expect(Object.keys(payload).sort()).toEqual([
			"mutableContent",
			"sound",
			"title",
			"to",
		]);
		expect(payload).toEqual({
			to: TOKEN,
			title: PUSH_WAKE_TITLE,
			mutableContent: true,
			sound: "default",
		});
		for (const forbidden of [
			"body",
			"subtitle",
			"data",
			"categoryId",
			"badge",
			"_contentAvailable",
		]) {
			expect(payload).not.toHaveProperty(forbidden);
		}
		// Belt-and-braces: nothing session/workflow/chain-shaped in the wire bytes.
		for (const leak of ["workflow", "chain", "session", "collab", "status"]) {
			expect(String(init.body).toLowerCase()).not.toContain(leak);
		}
	});

	it("DeviceNotRegistered → clears token, no retry, dead-token-cleared", async () => {
		const fetchSpy = vi.fn(async () =>
			okResponse({
				data: [
					{
						status: "error",
						message: "not registered",
						details: { error: "DeviceNotRegistered" },
					},
				],
			}),
		);
		const { sender, clearToken } = makeSender(
			fetchSpy as unknown as typeof fetch,
		);
		await expect(sender.send()).resolves.toBe("dead-token-cleared");
		expect(clearToken).toHaveBeenCalledTimes(1);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("transient network error → bounded retry then retry-exhausted, token kept", async () => {
		const fetchSpy = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		});
		const { sender, clearToken } = makeSender(
			fetchSpy as unknown as typeof fetch,
		);
		await expect(sender.send()).resolves.toBe("retry-exhausted");
		expect(fetchSpy).toHaveBeenCalledTimes(3); // maxAttempts default
		expect(clearToken).not.toHaveBeenCalled();
	});

	it("HTTP 5xx → retries, then succeeds when the service recovers", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(new Response("oops", { status: 503 }))
			.mockResolvedValueOnce(okResponse({ data: [{ status: "ok" }] }));
		const { sender } = makeSender(fetchSpy as unknown as typeof fetch);
		await expect(sender.send()).resolves.toBe("sent");
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("error status without DeviceNotRegistered is transient (no token clear)", async () => {
		const fetchSpy = vi.fn(async () =>
			okResponse({
				data: [{ status: "error", details: { error: "MessageRateExceeded" } }],
			}),
		);
		const { sender, clearToken } = makeSender(
			fetchSpy as unknown as typeof fetch,
		);
		await expect(sender.send()).resolves.toBe("retry-exhausted");
		expect(clearToken).not.toHaveBeenCalled();
	});

	it("singular-object DeviceNotRegistered response → clears token, no retry, dead-token-cleared", async () => {
		const fetchSpy = vi.fn(async () =>
			okResponse({
				data: {
					status: "error",
					message: "not registered",
					details: { error: "DeviceNotRegistered" },
				},
			}),
		);
		const { sender, clearToken } = makeSender(
			fetchSpy as unknown as typeof fetch,
		);
		await expect(sender.send()).resolves.toBe("dead-token-cleared");
		expect(clearToken).toHaveBeenCalledTimes(1);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("singular-object success response → sent", async () => {
		const fetchSpy = vi.fn(async () => okResponse({ data: { status: "ok" } }));
		const { sender } = makeSender(fetchSpy as unknown as typeof fetch);
		await expect(sender.send()).resolves.toBe("sent");
	});

	it("posts exactly the four content-free keys with the constant title", async () => {
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		const fetchImpl = (async (url: string, init: { body: string }) => {
			calls.push({ url: String(url), body: JSON.parse(init.body) });
			return new Response(JSON.stringify({ data: { status: "ok" } }), {
				status: 200,
			});
		}) as unknown as typeof fetch;
		const sender = createPushWakeSender({
			loadToken: () => "ExponentPushToken[e2e]",
			clearToken: () => {},
			fetchImpl,
		});
		expect(await sender.send()).toBe("sent");
		expect(calls).toHaveLength(1);
		expect(calls[0].body).toEqual({
			to: "ExponentPushToken[e2e]",
			title: PUSH_WAKE_TITLE,
			mutableContent: true,
			sound: "default",
		});
		expect(Object.keys(calls[0].body).sort()).toEqual([
			"mutableContent",
			"sound",
			"title",
			"to",
		]);
	});

	it("title constant is the exact banner string (em dash U+2014)", () => {
		expect(PUSH_WAKE_TITLE).toBe("Xavier — something needs you");
	});

	it("honors the endpoint override seam", async () => {
		const urls: string[] = [];
		const fetchImpl = (async (url: string) => {
			urls.push(String(url));
			return new Response(JSON.stringify({ data: { status: "ok" } }), {
				status: 200,
			});
		}) as unknown as typeof fetch;
		const sender = createPushWakeSender({
			loadToken: () => "t",
			clearToken: () => {},
			fetchImpl,
			endpoint: "http://127.0.0.1:9999/push",
		});
		await sender.send();
		expect(urls).toEqual(["http://127.0.0.1:9999/push"]);
	});
});
