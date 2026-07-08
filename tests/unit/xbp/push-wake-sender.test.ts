import { describe, it, expect, vi } from "vitest";
import {
	createPushWakeSender,
	EXPO_PUSH_ENDPOINT,
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

	it("sends a content-free payload: exactly {to,_contentAvailable} — no title/body/data/category", async () => {
		const fetchSpy = vi.fn(async () =>
			okResponse({ data: [{ status: "ok" }] }),
		);
		const { sender } = makeSender(fetchSpy as unknown as typeof fetch);
		await expect(sender.send()).resolves.toBe("sent");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(EXPO_PUSH_ENDPOINT);
		const payload = JSON.parse(String(init.body));
		// The spec's test: no session id, no category, no content. The ONLY
		// keys on the wire are the token and the silent-wake delivery flag.
		expect(Object.keys(payload).sort()).toEqual(["_contentAvailable", "to"]);
		expect(payload).toEqual({ to: TOKEN, _contentAvailable: true });
		for (const forbidden of [
			"title",
			"body",
			"subtitle",
			"data",
			"categoryId",
			"sound",
			"badge",
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
});
