// services/plugins/samantha/samantha-driver.ts
import type { EcosystemPlugin, PluginContext } from "../plugin-registry";
import type {
	SamanthaHealth,
	SamanthaSessionSlice,
} from "../../../shared/contracts/plugins";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import { assembleObserve } from "./observe-assembler";
import { probeSamantha } from "./samantha-probe";
import type {
	SamanthaConnectorClient,
	SnapshotBody,
} from "./samantha-connector-client";
import type {
	ObserveInput,
	SamanthaSignal,
	WorktreeIdentity,
} from "./observe-types";
import {
	buildSessionReport,
	renderReportText,
	resolveWorktreeKey,
} from "./samantha-command-capabilities";
import { createSamanthaCommandDispatcher } from "./samantha-command-dispatcher";
import {
	buildTargetSessionState,
	routeInstruction,
	type AgentTarget,
} from "./session-instruction-router";
import { createActGuard, type PrepResult } from "./act-guard";
import type { ActingAuditEntry } from "../../diagnostics/acting-audit-logger";
import {
	createSamanthaCommandClient,
	type SamanthaCommandClient,
	type WebSocketCtor,
} from "./samantha-command-client";
import { createReconnectBackoff } from "./reconnect-backoff";
import { createIdempotentDispatcher } from "./idempotent-dispatcher";
import { SAMANTHA_CONTRACT_VERSION } from "./command-types";

export type SamanthaDriverOptions = {
	client: SamanthaConnectorClient;
	getIdentities: () => Promise<Record<string, WorktreeIdentity>>;
	getReviewCount: (worktreeId: string) => number;
	getWhisperStates: () => Promise<WhisperWorktreeState[]>;
	subscribeReviews: (cb: () => void) => () => void;
	subscribeWorktrees: (cb: () => void) => () => void;
	pushHealth: (h: SamanthaHealth) => void;
	focusWorktree: (worktreeId: string) => void;
	now?: () => number;
	debounceMs?: number;
	keepAliveMs?: number;
	reconnectMs?: number;
	webSocketImpl?: WebSocketCtor;
	commandPort?: number;
	commandReconnectMs?: number;
	reconnectCapMs?: number;
	reconnectFactor?: number;
	random?: () => number;
	dedupTtlMs?: number;
	dedupMax?: number;
	log?: (message: string, error?: unknown) => void;
	isActingEnabled: () => boolean;
	verifyActingToken: (token: string | undefined) => boolean;
	auditAct: (entry: ActingAuditEntry) => void;
	runManagedInstruction: (
		worktreeId: string,
		decision:
			| { kind: "collab-tell"; target: AgentTarget; instruction: string }
			| { kind: "workflow-resume"; workflowId: string; message: string },
	) => Promise<{ ok: boolean; detail: string }>;
	sendUnmanagedInput: (
		sessionId: string,
		data: string,
	) => { ok: boolean; detail: string };
};

const SPEECH_WORTHY = new Set<SamanthaSignal>([
	"attentionRequired",
	"error",
	"taskCompleted",
]);

const DESCRIPTION = "ai-14all coding sessions across your worktrees";

export const CAPABILITIES = [
	{
		id: "focus-worktree",
		title: "Focus a worktree",
		description: "Bring a worktree's window to the front in ai-14all.",
		inputSchema: {
			type: "object",
			properties: {
				worktree: {
					type: "string",
					description:
						"A '<repo>/<branch>' key exactly as shown in the latest ai-14all snapshot.",
				},
			},
			required: ["worktree"],
		},
	},
	{
		id: "session-report",
		title: "Report session status",
		description:
			"Return a status roll-up of every active ai-14all worktree/session.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		id: "instruct-session",
		title: "Instruct a session",
		description:
			"Deliver an instruction to the agent in a worktree's session. Requires spoken confirmation before it is forwarded.",
		inputSchema: {
			type: "object",
			properties: {
				worktree: {
					type: "string",
					description:
						"A '<repo>/<branch>' key exactly as shown in the latest ai-14all snapshot.",
				},
				instruction: {
					type: "string",
					description: "What to tell the agent in that session.",
				},
			},
			required: ["worktree", "instruction"],
		},
		requiresConfirmation: true,
		risk: "drives-agent",
	},
];

export function createSamanthaDriver(
	options: SamanthaDriverOptions,
): EcosystemPlugin & {
	ingestSessionSlice(slice: SamanthaSessionSlice): void;
	instructSession: (
		args: Record<string, unknown> | undefined,
		token: string | undefined,
	) => Promise<import("./act-guard").ActOutcome>;
	reconnectNow(): void;
} {
	const now = options.now ?? Date.now;
	const debounceMs = options.debounceMs ?? 1000;
	const keepAliveMs = options.keepAliveMs ?? 30000;
	const reconnectMs = options.reconnectMs ?? 3000;
	const httpBackoff = createReconnectBackoff({
		baseMs: reconnectMs,
		factor: options.reconnectFactor ?? 2,
		capMs: options.reconnectCapMs ?? 30000,
		random: options.random,
	});

	let stopped = true;
	let registered = false;
	let session: SamanthaSessionSlice | null = null;
	let lastBody: string | null = null;
	let lastSignals: Record<string, SamanthaSignal> = {};
	let pendingForce = false; // a keep-alive trigger forces a PATCH even if unchanged
	let inFlight = false; // a rebuild is currently running
	let rerun = false; // a trigger arrived mid-flight; coalesce into one more pass
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	const unsubscribers: (() => void)[] = [];

	function health(link: SamanthaHealth["link"]): void {
		options.pushHealth({ link });
	}

	async function gather(): Promise<ObserveInput> {
		const [identities, whisper] = await Promise.all([
			options.getIdentities(),
			options.getWhisperStates(),
		]);
		const reviewCounts: Record<string, number> = {};
		for (const id of Object.keys(identities))
			reviewCounts[id] = options.getReviewCount(id);
		return { identities, reviewCounts, whisper, session };
	}

	const execute: import("./act-guard").ExecuteFn = async (
		worktreeId,
		decision,
	) => {
		if (decision.kind === "send-input")
			return options.sendUnmanagedInput(decision.sessionId, decision.data);
		if (decision.kind === "collab-tell" || decision.kind === "workflow-resume")
			return options.runManagedInstruction(worktreeId, decision);
		// "reject" never reaches execute (ActGuard short-circuits it).
		return { ok: false, detail: "unroutable decision" };
	};

	const actGuard = createActGuard({
		verifyToken: options.verifyActingToken,
		isActingEnabled: options.isActingEnabled,
		execute,
		audit: options.auditAct,
		now,
	});

	const instructSession = async (
		args: Record<string, unknown> | undefined,
		token: string | undefined,
	) => {
		// prepare runs ONLY after ActGuard's token + acting-enabled gates pass.
		const prepare = async (): Promise<PrepResult> => {
			const key = args?.worktree;
			const instruction = args?.instruction;
			if (typeof key !== "string" || key.length === 0)
				return {
					ok: false,
					code: "invalid-args",
					message: "instruct-session requires args.worktree (non-empty string)",
				};
			if (typeof instruction !== "string" || instruction.length === 0)
				return {
					ok: false,
					code: "invalid-args",
					message:
						"instruct-session requires args.instruction (non-empty string)",
				};
			const resolved = resolveWorktreeKey(await options.getIdentities(), key);
			if (resolved.kind === "none")
				return {
					ok: false,
					code: "unknown-worktree",
					message: `no worktree for "${key}"`,
				};
			if (resolved.kind === "ambiguous")
				return {
					ok: false,
					code: "ambiguous-worktree",
					message: `"${key}" matches ${resolved.candidates.length} worktrees`,
				};
			const state = buildTargetSessionState(
				resolved.worktreeId,
				await options.getWhisperStates(),
				session,
			);
			const decision = routeInstruction({ instruction, state });
			return {
				ok: true,
				worktreeId: resolved.worktreeId,
				instruction,
				decision,
			};
		};
		return actGuard.run({ token, prepare });
	};

	const dispatcher = createIdempotentDispatcher(
		createSamanthaCommandDispatcher(
			{
				buildReport: async () => {
					const sessions = buildSessionReport(await gather());
					return { report: renderReportText(sessions), sessions };
				},
				resolveWorktree: async (key) =>
					resolveWorktreeKey(await options.getIdentities(), key),
				focusWorktree: options.focusWorktree,
				instructSession,
			},
			{ log: options.log },
		),
		{
			ttlMs: options.dedupTtlMs ?? 60000,
			max: options.dedupMax ?? 256,
			now,
		},
	);

	const commandPort =
		options.commandPort ??
		(Number(process.env.AI_SAMANTHA_CONNECTOR_PORT) || 7841);
	const commandClient: SamanthaCommandClient | null = options.webSocketImpl
		? createSamanthaCommandClient({
				url: `ws://127.0.0.1:${commandPort}/connectors/ai-14all/events`,
				dispatcher,
				WebSocketImpl: options.webSocketImpl,
				reconnectMs: options.commandReconnectMs,
				reconnectCapMs: options.reconnectCapMs,
				reconnectFactor: options.reconnectFactor,
				random: options.random,
				onStatus: (status) => {
					// A WS-plane open/close maps straight to driver health, so a pure
					// socket drop is observable as reconnecting -> connected.
					if (!stopped) health(status);
				},
				log: options.log,
			})
		: null;

	function setRegistered(value: boolean): void {
		if (value === registered) return;
		registered = value;
		if (value) commandClient?.connect();
		else commandClient?.close();
	}

	function scheduleReconnect(): void {
		if (stopped || reconnectTimer !== null) return;
		health("reconnecting");
		// Route the retry through the scheduler so reconnect attempts serialize with
		// any in-flight rebuild and respect a pending force. rebuild() re-registers
		// itself at the top when !registered, so we don't ensureRegistered() here.
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			scheduleRebuild();
		}, httpBackoff.next());
	}

	async function ensureRegistered(): Promise<boolean> {
		if (stopped) return false;
		const r = await options.client.register({
			id: "ai-14all",
			label: "ai-14all",
			description: DESCRIPTION,
			capabilities: CAPABILITIES,
			contractVersion: SAMANTHA_CONTRACT_VERSION,
		});
		// conflict => already registered; treat as success.
		if (r.ok || (!r.ok && r.reason === "conflict")) {
			setRegistered(true);
			lastBody = null; // force a fresh full snapshot after (re)connect
			health("connected");
			httpBackoff.reset();
			return true;
		}
		setRegistered(false);
		health(r.reason === "refused" ? "samantha-not-running" : "reconnecting");
		return false;
	}

	// Returns false ONLY when a PATCH could not be sent this cycle (so a forced
	// keep-alive obligation must be carried over); true on every other completion,
	// including event-POST bails where a PATCH already succeeded this cycle.
	async function rebuild(force = false): Promise<boolean> {
		if (stopped) return true;
		if (!registered) {
			const ok = await ensureRegistered();
			if (!ok) {
				scheduleReconnect();
				return false;
			}
		}
		// Review counts over ALL worktrees main owns (not just session ones), so
		// reviews show even before the renderer's first slice.
		const input = await gather();
		const identities = input.identities;
		const out = assembleObserve(input);

		const body: SnapshotBody = {
			summary: out.summary,
			status: out.status,
			details: out.details,
			updatedAt: now(),
		};
		// Idempotent on CONTENT: skip a byte-identical body UNLESS this is a forced
		// (keep-alive) rebuild, which must refresh Samantha's freshness ~every 30s.
		const fingerprint = JSON.stringify({
			summary: body.summary,
			status: body.status,
			details: body.details,
		});
		if (force || fingerprint !== lastBody) {
			let r = await options.client.patchSnapshot(body);
			// Samantha restarted and dropped our registration: re-register, then
			// re-PATCH a fresh full snapshot BEFORE any event can be posted.
			if (!r.ok && r.reason === "not-found") {
				setRegistered(false);
				if (await ensureRegistered()) {
					r = await options.client.patchSnapshot(body);
				}
			}
			if (!r.ok) {
				// PATCH still failing: reconnect and bail. Never POST an event
				// without a successful preceding PATCH. No PATCH landed this cycle,
				// so a forced keep-alive obligation must survive (return false).
				setRegistered(false);
				scheduleReconnect();
				return false;
			}
			lastBody = fingerprint;
			health("connected");
			httpBackoff.reset();
		}

		// Events only for transitions INTO a speech-worthy signal. The PATCH above
		// has already refreshed Samantha's snapshot, so PATCH precedes every POST.
		for (const [worktreeId, signal] of Object.entries(out.signals)) {
			const prev = lastSignals[worktreeId];
			if (signal === prev || !SPEECH_WORTHY.has(signal)) continue;
			const wt = session?.worktrees.find((w) => w.worktreeId === worktreeId);
			const branch = identities[worktreeId]?.branch ?? worktreeId;
			// Build the summary from non-empty parts: a whisper-only worktree has no
			// session slice (wt undefined), so avoid a dangling "branch:  —".
			const summary = wt
				? `${branch}: ${[wt.attention, wt.summary]
						.filter((p) => p.length > 0)
						.join(" — ")}`.trim()
				: `${branch} (${signal})`;
			const r = await options.client.postEvent({
				signal,
				summary,
			});
			if (!r.ok) {
				// Samantha went away mid-cycle. Do NOT advance lastSignals, so this
				// transition is re-emitted once the link is restored. In both bails
				// below a PATCH already succeeded this cycle, so a forced keep-alive
				// obligation is already met (return true).
				setRegistered(false);
				if (r.reason === "not-found") {
					// Restart: re-register AND immediately re-PATCH a fresh full
					// snapshot so Samantha is current before the retried event POST
					// (PATCH must precede POST). The scheduled rebuild re-emits it.
					if (await ensureRegistered()) {
						const re = await options.client.patchSnapshot(body);
						if (re.ok) {
							lastBody = fingerprint;
							health("connected");
						}
					}
					scheduleRebuild();
				} else {
					scheduleReconnect();
				}
				return true;
			}
		}
		lastSignals = out.signals;
		return true;
	}

	// Serialize rebuilds: only one runs at a time. A trigger that arrives while a
	// rebuild is in flight coalesces into exactly one more pass afterward.
	async function runRebuild(): Promise<void> {
		if (inFlight) {
			rerun = true;
			return;
		}
		inFlight = true;
		try {
			do {
				rerun = false;
				const force = pendingForce;
				pendingForce = false;
				let patched = false;
				try {
					patched = await rebuild(force);
				} catch {
					// A read tap (getIdentities/getWhisperStates) or client call threw: treat as a
					// failed transient cycle — never let it become an unhandled rejection in main
					// (graceful absence). The next scheduled/keep-alive rebuild retries.
					patched = false;
				}
				// A forced keep-alive PATCH that bailed before sending must survive
				// the bail, or the keep-alive is lost until the next ~30s tick.
				if (force && !patched) pendingForce = true;
			} while (rerun && !stopped);
		} finally {
			inFlight = false;
		}
	}

	function scheduleRebuild(force = false): void {
		if (stopped) return;
		if (force) pendingForce = true;
		if (debounceTimer !== null) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			void runRebuild();
		}, debounceMs);
	}

	function reconnectNow(): void {
		if (stopped) return;
		// Guarded no-op when the link is already healthy (HTTP registered AND the WS
		// socket open): don't churn a healthy connection. The button is only shown
		// when disconnected, so this is a belt-and-suspenders guard at the driver
		// layer. When commandClient is null (no WS plane configured) the WS check is
		// vacuously true, so the guard keys on `registered` alone.
		if (registered && (commandClient?.isOpen() ?? true)) return;
		// Otherwise: cancel any pending HTTP reconnect wait and reset both backoffs so
		// the retry starts from base; force an immediate command-socket reopen and a
		// forced rebuild (force => a PATCH always goes out, so health returns to
		// connected even when content is unchanged). open()/ensureRegistered() are
		// idempotent, so a manual trigger during an in-flight attempt collapses into
		// it rather than double-opening.
		if (reconnectTimer !== null) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		httpBackoff.reset();
		health("connecting");
		commandClient?.reconnectNow();
		scheduleRebuild(true);
	}

	return {
		id: "samantha",
		capabilities: [],
		probe: () => probeSamantha(),
		async start(_ctx: PluginContext) {
			stopped = false;
			setRegistered(false);
			lastBody = null;
			lastSignals = {};
			pendingForce = false;
			health("connecting");
			unsubscribers.push(options.subscribeReviews(() => scheduleRebuild()));
			unsubscribers.push(options.subscribeWorktrees(() => scheduleRebuild()));
			// Keep-alive: force a PATCH ~every keepAliveMs even when content is
			// unchanged, so Samantha's stale-row freshness affordance stays current.
			keepAliveTimer = setInterval(() => scheduleRebuild(true), keepAliveMs);
			scheduleRebuild();
		},
		async stop() {
			stopped = true;
			if (debounceTimer !== null) clearTimeout(debounceTimer);
			if (keepAliveTimer !== null) clearInterval(keepAliveTimer);
			if (reconnectTimer !== null) clearTimeout(reconnectTimer);
			debounceTimer = keepAliveTimer = reconnectTimer = null;
			for (const u of unsubscribers.splice(0)) u();
			if (registered) await options.client.unregister();
			setRegistered(false);
			health("samantha-not-running");
		},
		ingestSessionSlice(slice: SamanthaSessionSlice) {
			session = slice;
			scheduleRebuild();
		},
		instructSession,
		reconnectNow,
	};
}
