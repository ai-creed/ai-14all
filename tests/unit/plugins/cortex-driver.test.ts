import { describe, expect, it, vi } from "vitest";
import { createCortexDriver } from "../../../services/plugins/cortex/cortex-driver";

const baseOpts = () => ({
	probeImpl: async () => ({ kind: "not-installed" }) as const,
	onAvailabilityChanged: vi.fn(),
});

describe("createCortexDriver", () => {
	it("exposes id 'cortex' and the code-nav-index capability", () => {
		const d = createCortexDriver(baseOpts());
		expect(d.id).toBe("cortex");
		expect(d.capabilities).toEqual(["code-nav-index"]);
	});

	it("probe() delegates to the injected probe", async () => {
		const probeImpl = vi.fn(
			async () =>
				({
					kind: "installed",
					version: "0.15.1",
					installPath: "/x",
					protocolVersion: "",
				}) as const,
		);
		const d = createCortexDriver({ probeImpl, onAvailabilityChanged: vi.fn() });
		expect(await d.probe()).toMatchObject({
			kind: "installed",
			version: "0.15.1",
		});
		expect(probeImpl).toHaveBeenCalledOnce();
	});

	it("start()/stop() emit the availability signal and do not throw", async () => {
		const onAvailabilityChanged = vi.fn();
		const d = createCortexDriver({
			probeImpl: async () => ({ kind: "not-installed" }),
			onAvailabilityChanged,
		});
		const ctx = { reportDegraded: vi.fn(), reportLimited: vi.fn() };
		await expect(d.start(ctx)).resolves.toBeUndefined();
		await expect(d.stop()).resolves.toBeUndefined();
		expect(onAvailabilityChanged).toHaveBeenCalledTimes(2);
	});
});
