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

	it("surfaces the probe's evaluator readiness onto the snapshot", async () => {
		const driver = fakeDriver({
			probe: vi.fn(
				async (): Promise<ProbeResult> => ({
					kind: "installed",
					version: "0.6.0",
					installPath: "/x",
					protocolVersion: "1",
					evaluator: { status: "missing_anthropic_key", ready: false },
				}),
			),
		});
		const registry = createPluginRegistry(
			[driver],
			fakeConfig({ enabled: true }),
		);
		await registry.boot();
		expect(registry.snapshots()[0].evaluator).toEqual({
			status: "missing_anthropic_key",
			ready: false,
		});
	});

	it("leaves evaluator undefined when the probe does not report it", async () => {
		const driver = fakeDriver(); // probe returns installed with no evaluator
		const registry = createPluginRegistry(
			[driver],
			fakeConfig({ enabled: true }),
		);
		await registry.boot();
		expect(registry.snapshots()[0].evaluator).toBeUndefined();
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

	it("unsupported: enabled + installed → never probes or starts, status unsupported", async () => {
		const probe = vi.fn(
			async (): Promise<ProbeResult> => ({
				kind: "installed",
				version: "0.6.0",
				installPath: "/x",
				protocolVersion: "1",
			}),
		);
		const driver = fakeDriver({ probe });
		const registry = createPluginRegistry(
			[driver],
			fakeConfig({ enabled: true }),
			{ unsupported: { whisper: "not supported on Windows yet" } },
		);
		await registry.boot();
		// Gated off: the platform check wins before any probe/start.
		expect(probe).not.toHaveBeenCalled();
		expect(driver.start).not.toHaveBeenCalled();
		expect(registry.snapshots()[0].status).toEqual({
			state: "unsupported",
			reason: "not supported on Windows yet",
		});
	});

	it("hidden: filters listed ids out of snapshots but keeps the rest", async () => {
		// Release gate: main hides unreleased plugins (e.g. samantha in packaged
		// builds) so they never reach the panel and cannot be enabled via the UI.
		const whisper = fakeDriver({ id: "whisper" });
		const samantha = fakeDriver({ id: "samantha" });
		const registry = createPluginRegistry(
			[whisper, samantha],
			fakeConfig({ enabled: false }),
			{ hidden: ["samantha"] },
		);
		await registry.boot();
		expect(registry.snapshots().map((s) => s.id)).toEqual(["whisper"]);
	});

	it("hidden: a hidden plugin is also withheld from snapshot listeners", async () => {
		const samantha = fakeDriver({ id: "samantha" });
		const registry = createPluginRegistry(
			[samantha],
			fakeConfig({ enabled: false }),
			{ hidden: ["samantha"] },
		);
		const seen: string[][] = [];
		registry.onSnapshots((snaps) => seen.push(snaps.map((s) => s.id)));
		await registry.boot();
		expect(seen.every((ids) => !ids.includes("samantha"))).toBe(true);
	});

	it("hidden: still starts the driver when the config enables it directly", async () => {
		// Visibility, not capability: hiding removes the card (and the UI enable
		// path), but a config that enables the plugin directly still starts it —
		// it just never appears in snapshots.
		const samantha = fakeDriver({ id: "samantha" });
		const registry = createPluginRegistry(
			[samantha],
			fakeConfig({ enabled: true }),
			{ hidden: ["samantha"] },
		);
		await registry.boot();
		expect(samantha.start).toHaveBeenCalledOnce();
		expect(registry.snapshots()).toHaveLength(0);
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

	it("boot: degraded probe → status degraded with reason, does not start", async () => {
		const driver = fakeDriver({
			probe: vi.fn(
				async (): Promise<ProbeResult> => ({
					kind: "degraded",
					reason: "could not run `whisper env --json`",
				}),
			),
		});
		const registry = createPluginRegistry(
			[driver],
			fakeConfig({ enabled: true }),
		);
		await registry.boot();
		expect(driver.start).not.toHaveBeenCalled();
		expect(registry.snapshots()[0].status).toEqual({
			state: "degraded",
			reason: "could not run `whisper env --json`",
		});
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

	it("a rejecting probe degrades the plugin and the chain self-heals", async () => {
		let failProbe = true;
		const driver = fakeDriver({
			probe: vi.fn(async (): Promise<ProbeResult> => {
				if (failProbe) throw new Error("probe exploded");
				return {
					kind: "installed",
					version: "0.6.0",
					installPath: "/x",
					protocolVersion: "1",
				};
			}),
		});
		const registry = createPluginRegistry(
			[driver],
			fakeConfig({ enabled: true }),
		);
		await expect(registry.boot()).resolves.toBeUndefined();
		expect(registry.snapshots()[0].status).toEqual({
			state: "degraded",
			reason: "probe exploded",
		});
		failProbe = false;
		await registry.reprobe(); // chain not poisoned — this must run and recover
		expect(registry.snapshots()[0].status.state).toBe("on-healthy");
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
