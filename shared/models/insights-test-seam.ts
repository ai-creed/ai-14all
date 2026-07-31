/**
 * Bounded E2E test seam for the app-focus collector (spec §4). Shared by the
 * main registrar and the preload bridge so BOTH halves are gated by one helper:
 * without the flag the channel is never registered and the bridge is never
 * exposed, so the seam is unreachable in a production build.
 */
export const INSIGHTS_TEST_CHANNEL = "insights:__test";

export const INSIGHTS_TEST_SIGNALS = [
	"focus",
	"blur",
	"idle",
	"suspend",
	"resume",
	"flush",
] as const;

export type InsightsTestSignal = (typeof INSIGHTS_TEST_SIGNALS)[number];

export function isInsightsTestSeamEnabled(env: {
	AI14ALL_E2E?: string;
}): boolean {
	return Boolean(env.AI14ALL_E2E);
}

export interface InsightsTestBridge {
	signal(
		type: InsightsTestSignal,
		arg?: { atMs?: number; idleSeconds?: number },
	): Promise<{ ok: boolean; error?: string }>;
	crashWorker(): Promise<{ ok: boolean; error?: string }>;
	/** Kill the USAGE worker (a different utilityProcess) the same way. */
	crashUsageWorker(): Promise<{ ok: boolean; error?: string }>;
}

/**
 * Build the ACTUAL renderer bridge, or `undefined` when the flag is off. The
 * preload module calls exactly this and assigns the result verbatim — it holds
 * no other logic — so a unit test of this function IS a test of the real
 * preload API construction (the preload module cannot be imported outside
 * Electron). Returning `undefined` is what makes
 * `window.ai14all.__insightsTest` absent in a production build.
 */
export function buildInsightsTestBridge(
	env: { AI14ALL_E2E?: string },
	invoke: (channel: string, payload: unknown) => Promise<unknown>,
): InsightsTestBridge | undefined {
	if (!isInsightsTestSeamEnabled(env)) return undefined;
	return {
		signal: (type, arg = {}) =>
			// `type` LAST: a caller-supplied `arg.type` must never clobber the
			// signal being sent (the main side re-validates independently, but
			// the ordering should not be the thing standing between them).
			invoke(INSIGHTS_TEST_CHANNEL, { ...arg, type }) as Promise<{
				ok: boolean;
				error?: string;
			}>,
		crashWorker: () =>
			invoke(INSIGHTS_TEST_CHANNEL, { type: "crashWorker" }) as Promise<{
				ok: boolean;
				error?: string;
			}>,
		crashUsageWorker: () =>
			invoke(INSIGHTS_TEST_CHANNEL, { type: "crashUsageWorker" }) as Promise<{
				ok: boolean;
				error?: string;
			}>,
	};
}
