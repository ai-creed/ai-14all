import { describe, expect, it, vi } from "vitest";
import type { ProbeResult } from "../../../shared/models/ecosystem-plugin";
import {
	createPluginRegistry,
	type EcosystemPlugin,
} from "../../../services/plugins/plugin-registry";

function fakeDriver(overrides: Partial<EcosystemPlugin> = {}): EcosystemPlugin {
	return {
		id: "whisper",
		capabilities: ["workflow-lens"],
		probe: vi.fn(
			async (): Promise<ProbeResult> => ({
				kind: "installed",
				version: "0.6.0",
				installPath: "/x",
				protocolVersion: "1",
			}),
		),
		start: vi.fn(async () => {}),
		stop: vi.fn(async () => {}),
		...overrides,
	};
}

function fakeConfig(initial: {
	enabled: boolean;
	installPath?: string | null;
}) {
	let entry = { installPath: null, ...initial };
	const listeners = new Set<() => void>();
	return {
		get: () => entry,
		setEnabled(_id: string, enabled: boolean) {
			entry = { ...entry, enabled };
			for (const cb of listeners) cb();
		},
		onChange(cb: () => void) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
	};
}

describe("createPluginRegistry", () => {
	it("boot: installed + enabled → starts the driver, status on-healthy", async () => {
		const driver = fakeDriver();
		const registry = createPluginRegistry(
			[driver],
			fakeConfig({ enabled: true }),
		);
		await registry.boot();
		expect(driver.start).toHaveBeenCalledOnce();
		expect(registry.snapshots()[0].status).toEqual({
			state: "on-healthy",
			version: "0.6.0",
			limited: false,
		});
	});

	it("boot: installed + disabled → does not start, status installed-off", async () => {
		const driver = fakeDriver();
		const registry = createPluginRegistry(
			[driver],
			fakeConfig({ enabled: false }),
		);
		await registry.boot();
		expect(driver.start).not.toHaveBeenCalled();
		expect(registry.snapshots()[0].status).toEqual({
			state: "installed-off",
			version: "0.6.0",
		});
	});

	it("boot: not-installed + enabled → does not start, status not-installed", async () => {
		const driver = fakeDriver({
			probe: vi.fn(
				async (): Promise<ProbeResult> => ({ kind: "not-installed" }),
			),
		});
		const registry = createPluginRegistry(
			[driver],
			fakeConfig({ enabled: true }),
		);
		await registry.boot();
		expect(driver.start).not.toHaveBeenCalled();
		expect(registry.snapshots()[0].status).toEqual({ state: "not-installed" });
	});

	it("boot: incompatible → status incompatible with reason", async () => {
		const driver = fakeDriver({
			probe: vi.fn(
				async (): Promise<ProbeResult> => ({
					kind: "incompatible",
					found: "pre-env whisper",
					required: "whisper with `env --json` support",
				}),
			),
		});
		const registry = createPluginRegistry(
			[driver],
			fakeConfig({ enabled: true }),
		);
		await registry.boot();
		expect(registry.snapshots()[0].status.state).toBe("incompatible");
	});

	it("config flip on → re-probes and starts; flip off → stops", async () => {
		const driver = fakeDriver();
		const config = fakeConfig({ enabled: false });
		const registry = createPluginRegistry([driver], config);
		await registry.boot();
		config.setEnabled("whisper", true);
		await registry.idle();
		expect(driver.start).toHaveBeenCalledOnce();
		config.setEnabled("whisper", false);
		await registry.idle();
		expect(driver.stop).toHaveBeenCalledOnce();
		expect(registry.snapshots()[0].status.state).toBe("installed-off");
	});

	it("driver start crash → degraded, never throws out of the registry", async () => {
		const driver = fakeDriver({
			start: vi.fn(async () => {
				throw new Error("socket exploded");
			}),
		});
		const registry = createPluginRegistry(
			[driver],
			fakeConfig({ enabled: true }),
		);
		await registry.boot();
		expect(registry.snapshots()[0].status).toEqual({
			state: "degraded",
			reason: "socket exploded",
		});
	});

	it("reportDegraded mid-session flips status and stops the driver", async () => {
		const driver = fakeDriver();
		const registry = createPluginRegistry(
			[driver],
			fakeConfig({ enabled: true }),
		);
		await registry.boot();
		await registry.reportDegraded("whisper", "daemon vanished");
		expect(driver.stop).toHaveBeenCalledOnce();
		expect(registry.snapshots()[0].status).toEqual({
			state: "degraded",
			reason: "daemon vanished",
		});
	});

	it("a config flip racing an in-flight boot does not double-start the driver", async () => {
		let releaseStart: () => void = () => {};
		const startGate = new Promise<void>((r) => {
			releaseStart = r;
		});
		const driver = fakeDriver({
			start: vi.fn(async () => {
				await startGate;
			}),
		});
		const config = fakeConfig({ enabled: true });
		const registry = createPluginRegistry([driver], config);
		const bootPromise = registry.boot();
		// Wait until boot's reconcile is inside driver.start (probe + start are async).
		await vi.waitFor(() => expect(driver.start).toHaveBeenCalledOnce());
		// Config change while start is still pending — must queue, not interleave.
		config.setEnabled("whisper", true);
		releaseStart();
		await bootPromise;
		await registry.idle();
		expect(driver.start).toHaveBeenCalledTimes(1);
	});

	it("notifies snapshot listeners on every state change", async () => {
		const driver = fakeDriver();
		const registry = createPluginRegistry(
			[driver],
			fakeConfig({ enabled: true }),
		);
		const seen: string[] = [];
		registry.onSnapshots((snaps) => seen.push(snaps[0].status.state));
		await registry.boot();
		expect(seen).toContain("on-healthy");
	});
});
