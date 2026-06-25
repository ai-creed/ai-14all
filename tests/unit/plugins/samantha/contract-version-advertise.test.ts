import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSamanthaDriver } from "../../../../services/plugins/samantha/samantha-driver";
import { SAMANTHA_CONTRACT_VERSION } from "../../../../services/plugins/samantha/command-types";
import type {
	RegisterBody,
	SamanthaConnectorClient,
	SamanthaClientResult,
} from "../../../../services/plugins/samantha/samantha-connector-client";

function stubClient(
	onRegister: (body: RegisterBody) => void,
): SamanthaConnectorClient {
	const ok: SamanthaClientResult = { ok: true };
	return {
		register: async (body) => {
			onRegister(body);
			return ok;
		},
		patchSnapshot: async () => ok,
		postEvent: async () => ok,
		unregister: async () => ok,
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("register payload advertises contractVersion", () => {
	it("sends the canonical contractVersion on register", async () => {
		expect(SAMANTHA_CONTRACT_VERSION).toBe(1);
		let seen: RegisterBody | null = null;
		const driver = createSamanthaDriver({
			client: stubClient((b) => {
				seen = b;
			}),
			// Minimal required deps — only the register path is exercised.
			getIdentities: async () => ({}),
			getReviewCount: () => 0,
			getWhisperStates: async () => [],
			subscribeReviews: () => () => {},
			subscribeWorktrees: () => () => {},
			pushHealth: () => {},
			focusWorktree: () => {},
			debounceMs: 10,
			isActingEnabled: () => false,
			verifyActingToken: () => false,
			auditAct: () => {},
			runManagedInstruction: async () => ({ ok: true as const, detail: "" }),
			sendUnmanagedInput: () => ({ ok: true as const, detail: "" }),
		});
		const ctx = { reportDegraded: vi.fn(), reportLimited: vi.fn() };
		await driver.start(ctx);
		// Advance past debounce so the register call fires.
		await vi.advanceTimersByTimeAsync(30);
		expect(seen).not.toBeNull();
		expect(seen!.contractVersion).toBe(SAMANTHA_CONTRACT_VERSION);
		driver.stop();
	});
});
