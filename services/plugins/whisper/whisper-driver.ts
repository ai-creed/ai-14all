import { join } from "node:path";
import type {
	ProbeResult,
	WhisperWorktreeState,
} from "../../../shared/models/ecosystem-plugin.js";
import type { ResolvedBinary } from "../binary-resolver.js";
import type { EcosystemPlugin, PluginContext } from "../plugin-registry.js";
import { createWhisperCollabWatcher } from "./whisper-collab-watcher.js";
import {
	connectWhisperEventSocket,
	type WhisperEventSocketClient,
} from "./whisper-event-socket.js";
import { WhisperStoreReader } from "./whisper-store-reader.js";

export type WhisperDriverOptions = {
	/** `~/.ai-whisper` in production; probe's stateRoot when available. */
	getStateRoot: () => string;
	getBinary: () => Promise<ResolvedBinary | null>;
	probeImpl: () => Promise<ProbeResult>;
	resolveWorktreeId: (workspaceRoot: string) => Promise<string | null>;
	pushState: (states: WhisperWorktreeState[]) => void;
	pollIntervalMs?: number;
	now?: () => number;
};

export function createWhisperDriver(
	options: WhisperDriverOptions,
): EcosystemPlugin {
	const pollIntervalMs = options.pollIntervalMs ?? 3000;
	let watcher: ReturnType<typeof createWhisperCollabWatcher> | null = null;
	const sockets = new Map<string, WhisperEventSocketClient>();
	const socketDead = new Set<string>(); // collabs whose socket attach failed
	const retryTimers = new Set<ReturnType<typeof setTimeout>>();
	let stopped = true;

	async function attachSocket(
		collabId: string,
		refresh: () => void,
	): Promise<void> {
		if (sockets.has(collabId) || socketDead.has(collabId)) return;
		const path = join(
			options.getStateRoot(),
			"sockets",
			`events-${collabId}.sock`,
		);
		const client = await connectWhisperEventSocket(path, {
			onEvent: () => refresh(),
			onClose: () => {
				sockets.delete(collabId);
				// Silent downgrade to polling; retry on a later snapshot in case
				// the daemon restarted.
				socketDead.add(collabId);
				const t = setTimeout(() => {
					socketDead.delete(collabId);
					retryTimers.delete(t);
				}, 30_000);
				retryTimers.add(t);
			},
		});
		if (client === null) {
			socketDead.add(collabId);
			const t = setTimeout(() => {
				socketDead.delete(collabId);
				retryTimers.delete(t);
			}, 30_000);
			retryTimers.add(t);
			return;
		}
		if (stopped) {
			client.close();
			return;
		}
		sockets.set(collabId, client);
	}

	return {
		id: "whisper",
		capabilities: ["workflow-lens", "start-collab"],
		probe: () => options.probeImpl(),
		async start(ctx: PluginContext) {
			stopped = false;
			const reader = new WhisperStoreReader(
				join(options.getStateRoot(), "state.db"),
			);
			watcher = createWhisperCollabWatcher({
				reader,
				resolveWorktreeId: options.resolveWorktreeId,
				now: options.now,
			});
			const refresh = () => {
				void watcher?.snapshot().then(publish);
			};
			const publish = (states: WhisperWorktreeState[]) => {
				if (stopped) return;
				let anySocket = false;
				const annotated = states.map((state) => {
					// Fire-and-forget: a freshly-seen collab reports "polling" in
					// this batch and upgrades to "socket" on the next publish once
					// the attach completes — intended eventual consistency.
					if (state.daemonAlive) void attachSocket(state.collabId, refresh);
					const hasSocket = sockets.has(state.collabId);
					anySocket = anySocket || hasSocket;
					return {
						...state,
						liveFeed: hasSocket ? ("socket" as const) : ("polling" as const),
					};
				});
				// "limited" = EVERY collab is stuck on polling (chip shows
				// "limited (upgrade for live events)").
				ctx.reportLimited(states.length > 0 && !anySocket);
				options.pushState(annotated);
			};
			watcher.onSnapshot(publish);
			watcher.start(pollIntervalMs);
		},
		async stop() {
			stopped = true;
			watcher?.stop();
			watcher = null;
			for (const client of sockets.values()) client.close();
			sockets.clear();
			socketDead.clear();
			for (const t of retryTimers) clearTimeout(t);
			retryTimers.clear();
			options.pushState([]);
		},
	};
}
