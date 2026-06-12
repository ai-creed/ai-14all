import type {
	EcosystemPluginId,
	PluginRuntimeStatus,
	PluginSnapshot,
	ProbeResult,
} from "../../shared/models/ecosystem-plugin.js";

export type PluginCapability =
	| "workflow-lens"
	| "start-collab"
	| "code-nav-index";

export type PluginContext = {
	/** Driver flags itself degraded; registry stops it and updates the chip. */
	reportDegraded(reason: string): void;
	/** Driver reports it fell back to polling (chip shows "limited"). */
	reportLimited(limited: boolean): void;
};

export interface EcosystemPlugin {
	id: EcosystemPluginId;
	capabilities: PluginCapability[];
	probe(): Promise<ProbeResult>;
	start(ctx: PluginContext): Promise<void>;
	stop(): Promise<void>;
}

type ConfigLike = {
	get(id: string): { enabled: boolean; installPath: string | null };
	onChange(cb: () => void): () => void;
};

type Entry = {
	driver: EcosystemPlugin;
	probe: ProbeResult | null;
	running: boolean;
	limited: boolean;
	degradedReason: string | null;
};

export type PluginRegistry = {
	boot(): Promise<void>;
	reprobe(): Promise<void>;
	stopAll(): Promise<void>;
	snapshots(): PluginSnapshot[];
	onSnapshots(cb: (snapshots: PluginSnapshot[]) => void): () => void;
	reportDegraded(id: EcosystemPluginId, reason: string): Promise<void>;
	/** Awaits any in-flight reconcile (config-change handler) — test seam. */
	idle(): Promise<void>;
};

function statusOf(entry: Entry, enabled: boolean): PluginRuntimeStatus {
	if (entry.degradedReason !== null)
		return { state: "degraded", reason: entry.degradedReason };
	const probe = entry.probe;
	if (probe === null || probe.kind === "not-installed")
		return { state: "not-installed" };
	if (probe.kind === "incompatible")
		return {
			state: "incompatible",
			found: probe.found,
			required: probe.required,
		};
	if (!enabled) return { state: "installed-off", version: probe.version };
	if (entry.running)
		return {
			state: "on-healthy",
			version: probe.version,
			limited: entry.limited,
		};
	return { state: "installed-off", version: probe.version };
}

export function createPluginRegistry(
	drivers: EcosystemPlugin[],
	config: ConfigLike,
): PluginRegistry {
	const entries = new Map<EcosystemPluginId, Entry>(
		drivers.map((driver) => [
			driver.id,
			{
				driver,
				probe: null,
				running: false,
				limited: false,
				degradedReason: null,
			},
		]),
	);
	const listeners = new Set<(s: PluginSnapshot[]) => void>();
	let pending: Promise<void> = Promise.resolve();

	function snapshots(): PluginSnapshot[] {
		return [...entries.values()].map((entry) => {
			const cfg = config.get(entry.driver.id);
			return {
				id: entry.driver.id,
				enabled: cfg.enabled,
				installPath: cfg.installPath,
				status: statusOf(entry, cfg.enabled),
			};
		});
	}

	function notify(): void {
		const snaps = snapshots();
		for (const cb of listeners) cb(snaps);
	}

	async function stopEntry(entry: Entry): Promise<void> {
		if (!entry.running) return;
		entry.running = false;
		entry.limited = false;
		try {
			await entry.driver.stop();
		} catch {
			// A failing stop must not block the registry.
		}
	}

	async function reconcile(entry: Entry): Promise<void> {
		const cfg = config.get(entry.driver.id);
		let probe: ProbeResult;
		try {
			probe = await entry.driver.probe();
		} catch (e) {
			// A rejecting probe must degrade this plugin only — never reject
			// reconcile, which would poison the serialized pending chain.
			await stopEntry(entry);
			entry.probe = null;
			entry.degradedReason = e instanceof Error ? e.message : String(e);
			notify();
			return;
		}
		entry.probe = probe;
		const compatible = entry.probe.kind === "installed";
		if (cfg.enabled && compatible && !entry.running) {
			entry.degradedReason = null;
			try {
				const ctx: PluginContext = {
					reportDegraded: (reason) => {
						void reportDegraded(entry.driver.id, reason);
					},
					reportLimited: (limited) => {
						entry.limited = limited;
						notify();
					},
				};
				await entry.driver.start(ctx);
				entry.running = true;
			} catch (e) {
				entry.degradedReason = e instanceof Error ? e.message : String(e);
			}
		} else if ((!cfg.enabled || !compatible) && entry.running) {
			await stopEntry(entry);
		}
		notify();
	}

	async function reconcileAll(): Promise<void> {
		for (const entry of entries.values()) await reconcile(entry);
	}

	async function reportDegraded(
		id: EcosystemPluginId,
		reason: string,
	): Promise<void> {
		const entry = entries.get(id);
		if (!entry) return;
		await stopEntry(entry);
		entry.degradedReason = reason;
		notify();
	}

	function queueReconcileAll(): Promise<void> {
		pending = pending.then(reconcileAll);
		return pending;
	}

	config.onChange(() => {
		void queueReconcileAll();
	});

	return {
		boot: queueReconcileAll,
		reprobe: queueReconcileAll,
		async stopAll() {
			for (const entry of entries.values()) await stopEntry(entry);
		},
		snapshots,
		onSnapshots(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		reportDegraded,
		idle: () => pending,
	};
}
