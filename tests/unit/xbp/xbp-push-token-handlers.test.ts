import { describe, it, expect, vi } from "vitest";
import {
	RegisterPushTokenResult,
	DeregisterPushTokenResult,
} from "@ai-creed/command-contract";
import { createPushTokenHandlers } from "../../../services/xbp/xbp-push-token-handlers";

const NOW = 1751932800000;
const validArgs = {
	expoPushToken: "ExponentPushToken[abc123]",
	platform: "ios" as const,
};

function makeHandlers(overrides?: {
	enabled?: boolean;
	save?: () => void;
	clear?: () => void;
}) {
	const save = vi.fn(overrides?.save);
	const clear = vi.fn(overrides?.clear);
	const handlers = createPushTokenHandlers({
		isPushWakeEnabled: () => overrides?.enabled ?? true,
		store: { save, clear },
		now: () => NOW,
	});
	return { handlers, save, clear };
}

describe("push token handlers", () => {
	it("valid token → {ok:true, registeredAt}, stored with platform", async () => {
		const { handlers, save } = makeHandlers();
		const result = await handlers.register(validArgs);
		expect(result).toEqual({
			ok: true,
			registeredAt: new Date(NOW).toISOString(),
		});
		expect(RegisterPushTokenResult.safeParse(result).success).toBe(true);
		expect(save).toHaveBeenCalledWith({
			expoPushToken: validArgs.expoPushToken,
			platform: "ios",
			registeredAt: NOW,
		});
	});

	it("accepts the ExpoPushToken[...] variant too", async () => {
		const { handlers } = makeHandlers();
		await expect(
			handlers.register({ ...validArgs, expoPushToken: "ExpoPushToken[xy]" }),
		).resolves.toMatchObject({ ok: true });
	});

	it("feature off → push-disabled, nothing stored", async () => {
		const { handlers, save } = makeHandlers({ enabled: false });
		await expect(handlers.register(validArgs)).resolves.toMatchObject({
			ok: false,
			code: "push-disabled",
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("malformed token → invalid-token, nothing stored", async () => {
		const { handlers, save } = makeHandlers();
		for (const bad of ["", "not-a-token", "ExponentPushToken[]", "x".repeat(4096)]) {
			await expect(
				handlers.register({ ...validArgs, expoPushToken: bad }),
			).resolves.toMatchObject({ ok: false, code: "invalid-token" });
		}
		expect(save).not.toHaveBeenCalled();
	});

	it("store failure → internal refusal value, never throws, token not echoed", async () => {
		const { handlers } = makeHandlers({
			save: () => {
				throw new Error("safeStorage down");
			},
		});
		const result = await handlers.register(validArgs);
		expect(result).toMatchObject({ ok: false, code: "internal" });
		expect(JSON.stringify(result)).not.toContain(validArgs.expoPushToken);
		expect(RegisterPushTokenResult.safeParse(result).success).toBe(true);
	});

	it("deregister clears and succeeds — even when the feature is off", async () => {
		const { handlers, clear } = makeHandlers({ enabled: false });
		const result = await handlers.deregister();
		expect(result).toEqual({
			ok: true,
			deregisteredAt: new Date(NOW).toISOString(),
		});
		expect(DeregisterPushTokenResult.safeParse(result).success).toBe(true);
		expect(clear).toHaveBeenCalled();
	});

	it("deregister store failure → internal refusal value, never throws", async () => {
		const { handlers } = makeHandlers({
			clear: () => {
				throw new Error("disk gone");
			},
		});
		await expect(handlers.deregister()).resolves.toMatchObject({
			ok: false,
			code: "internal",
		});
	});
});
