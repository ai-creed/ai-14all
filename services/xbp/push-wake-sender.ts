export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

// MUST mirror GENERIC_BANNER (ai-xavier apps/phone/src/push/push-banner.ts)
// and BannerPolicy.generic (apps/phone/native/nse/BannerPolicy.swift)
// string-for-string — same rule as the phrase table. Em dash U+2014.
export const PUSH_WAKE_TITLE = "Xavier — something needs you";

export type PushSendOutcome =
	| "sent"
	| "dead-token-cleared"
	| "retry-exhausted"
	| "no-token";

// send() deliberately takes no arguments: event data cannot reach the payload,
// so content-freedom holds by construction. The wire payload is the stored
// token plus a visible, still content-free banner: `title` (the constant
// PUSH_WAKE_TITLE) + `mutableContent: true` + `sound: "default"`. No body, no
// data, no category: Expo/APNs learn only that a ping happened at time T; the
// visible-alert + mutable-content pair invokes the phone's NSE (§1), and the
// phone wakes to pull the real content. Best-effort: never throws; the token
// never appears in logs or errors.
export function createPushWakeSender(deps: {
	loadToken: () => string | null;
	clearToken: () => void;
	fetchImpl?: typeof fetch;
	maxAttempts?: number;
	retryDelayMs?: number;
	endpoint?: string;
}): { send(): Promise<PushSendOutcome> } {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const maxAttempts = deps.maxAttempts ?? 3;
	const retryDelayMs = deps.retryDelayMs ?? 1000;
	const endpoint = deps.endpoint ?? EXPO_PUSH_ENDPOINT;
	const wait = (ms: number) =>
		ms === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

	return {
		async send() {
			const token = deps.loadToken();
			if (token === null) return "no-token";
			for (let attempt = 1; attempt <= maxAttempts; attempt++) {
				try {
					const res = await fetchImpl(endpoint, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							to: token,
							title: PUSH_WAKE_TITLE,
							mutableContent: true,
							sound: "default",
						}),
						signal: AbortSignal.timeout(10_000),
					});
					if (res.ok) {
						const json = (await res.json()) as {
							data?:
								| Array<{ status?: string; details?: { error?: string } }>
								| { status?: string; details?: { error?: string } };
						};
						const item = Array.isArray(json.data) ? json.data[0] : json.data;
						if (item?.status !== "error") return "sent";
						if (item.details?.error === "DeviceNotRegistered") {
							// The device is gone — stop pinging it (spec Deliverable 4).
							deps.clearToken();
							return "dead-token-cleared";
						}
						// Other per-receipt errors are transient → fall through to retry.
					}
					// Non-2xx → transient → retry.
				} catch {
					// Network/timeout → transient → retry.
				}
				if (attempt < maxAttempts) await wait(retryDelayMs);
			}
			return "retry-exhausted";
		},
	};
}
