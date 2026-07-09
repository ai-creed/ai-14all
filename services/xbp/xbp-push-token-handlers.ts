import type {
	DeregisterPushTokenResult,
	RegisterPushTokenArgs,
	RegisterPushTokenResult,
} from "@ai-creed/command-contract";
import type { XbpPushTokenStore } from "./xbp-push-token-store.js";

// Expo tokens look like ExponentPushToken[xxxx] (SDK) or ExpoPushToken[xxxx].
// Bounded length keeps a hostile arg from bloating the encrypted slot.
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\s[\]]{1,256}\]$/;

export type PushTokenHandlers = {
	register(args: RegisterPushTokenArgs): Promise<RegisterPushTokenResult>;
	deregister(): Promise<DeregisterPushTokenResult>;
};

// Executor convention (xbp-acting-executor.ts): expected refusals are returned
// as schema-valid values; only an unexpected throw escapes to the protocol
// layer's rejection net. The token itself never appears in any result/message.
export function createPushTokenHandlers(deps: {
	isPushWakeEnabled: () => boolean;
	store: Pick<XbpPushTokenStore, "save" | "clear">;
	now?: () => number;
}): PushTokenHandlers {
	const now = deps.now ?? Date.now;
	return {
		async register(args) {
			if (!deps.isPushWakeEnabled())
				return { ok: false, code: "push-disabled" };
			if (!EXPO_TOKEN_RE.test(args.expoPushToken))
				return { ok: false, code: "invalid-token" };
			const at = now();
			try {
				deps.store.save({
					expoPushToken: args.expoPushToken,
					platform: args.platform,
					registeredAt: at,
				});
			} catch {
				return { ok: false, code: "internal", message: "persist failed" };
			}
			return { ok: true, registeredAt: new Date(at).toISOString() };
		},
		// Deregistration removes authority, so it is honored even while the
		// feature gate is off — a phone must always be able to revoke itself.
		async deregister() {
			try {
				deps.store.clear();
			} catch {
				return { ok: false, code: "internal", message: "clear failed" };
			}
			return { ok: true, deregisteredAt: new Date(now()).toISOString() };
		},
	};
}
