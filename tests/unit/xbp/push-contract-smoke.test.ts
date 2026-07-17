import { describe, it, expect } from "vitest";
import {
	CONTROL_NOTIFY,
	COMMAND_CONTRACT_VERSION,
	RegisterPushTokenArgs,
	RegisterPushTokenResult,
	DeregisterPushTokenResult,
	registerPushTokenCapability,
	deregisterPushTokenCapability,
} from "@ai-creed/command-contract";

describe("push-token contract surface (v4)", () => {
	it("exposes register/deregister under control:notify", () => {
		expect(CONTROL_NOTIFY).toBe("control:notify");
		expect(COMMAND_CONTRACT_VERSION).toBe(4);
		expect(registerPushTokenCapability.id).toBe(
			"xavier.control.register-push-token",
		);
		expect(deregisterPushTokenCapability.id).toBe(
			"xavier.control.deregister-push-token",
		);
		for (const cap of [
			registerPushTokenCapability,
			deregisterPushTokenCapability,
		]) {
			expect(cap.permission).toBe(CONTROL_NOTIFY);
			expect(cap.risk).toBe("low");
		}
	});

	it("validates args and result unions", () => {
		expect(
			RegisterPushTokenArgs.safeParse({
				expoPushToken: "ExponentPushToken[abc]",
				platform: "ios",
			}).success,
		).toBe(true);
		expect(RegisterPushTokenArgs.safeParse({}).success).toBe(false);
		expect(
			RegisterPushTokenResult.safeParse({
				ok: true,
				registeredAt: "2026-07-08T00:00:00.000Z",
			}).success,
		).toBe(true);
		expect(
			RegisterPushTokenResult.safeParse({ ok: false, code: "push-disabled" })
				.success,
		).toBe(true);
		expect(
			DeregisterPushTokenResult.safeParse({
				ok: true,
				deregisteredAt: "2026-07-08T00:00:00.000Z",
			}).success,
		).toBe(true);
	});
});
