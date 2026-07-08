export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

export type PushSendOutcome =
	| "sent"
	| "dead-token-cleared"
	| "retry-exhausted"
	| "no-token";

// send() deliberately takes no arguments: event data cannot reach the payload,
// so content-freedom holds by construction. The wire payload is the stored
// token plus `_contentAvailable: true` — Expo's silent-notification delivery
// flag (APNs content-available: 1). No title, no body, no data, no category:
// Expo/APNs learn only that a ping happened at time T; the phone wakes in the
// background and pulls. Best-effort: never throws; the token never appears in
// logs or errors.
export function createPushWakeSender(deps: {
	loadToken: () => string | null;
	clearToken: () => void;
	fetchImpl?: typeof fetch;
	maxAttempts?: number;
	retryDelayMs?: number;
}): { send(): Promise<PushSendOutcome> } {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const maxAttempts = deps.maxAttempts ?? 3;
	const retryDelayMs = deps.retryDelayMs ?? 1000;
	const wait = (ms: number) =>
		ms === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

	return {
		async send() {
			const token = deps.loadToken();
			if (token === null) return "no-token";
			for (let attempt = 1; attempt <= maxAttempts; attempt++) {
				try {
					const res = await fetchImpl(EXPO_PUSH_ENDPOINT, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ to: token, _contentAvailable: true }),
						signal: AbortSignal.timeout(10_000),
					});
					if (res.ok) {
						const json = (await res.json()) as {
							data?: Array<{ status?: string; details?: { error?: string } }>;
						};
						const item = json.data?.[0];
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
