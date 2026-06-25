export const ECOSYSTEM_PLUGIN_IDS = ["whisper", "cortex", "samantha"] as const;

export type EcosystemPluginId = (typeof ECOSYSTEM_PLUGIN_IDS)[number];

/**
 * LLM-evaluator credential readiness as reported by `whisper env --json`.
 * `status` is whisper's EvaluatorStatus reason string (e.g. "ready",
 * "missing_anthropic_key", "invalid_config"); `ready` is its boolean rollup.
 * Kept as a plain `string` — like the other whisper read-contract pass-throughs —
 * since the status value set is owned by whisper, not pinned here.
 */
export type EvaluatorReadiness = { ready: boolean; status: string };

export type ProbeResult =
	| { kind: "not-installed" }
	| {
			kind: "installed";
			version: string;
			installPath: string;
			protocolVersion: string;
			/**
			 * whisper-only: LLM-evaluator credential readiness, lifted from
			 * `whisper env --json`. Absent for plugins that don't report it
			 * (cortex/samantha) and for whisper builds predating the field, so the
			 * consumer treats absence as "no warning to show".
			 */
			evaluator?: EvaluatorReadiness;
	  }
	| { kind: "incompatible"; found: string; required: string }
	// Binary resolved but the probe could not get a usable env report (failed to
	// exec, timed out, or returned unreadable output). "Present but unusable" —
	// distinct from not-installed, which is owned by the driver's null-binary
	// check, so the panel shows a Re-probe affordance, never a misleading Install.
	| { kind: "degraded"; reason: string };

// Maps 1:1 to the Plugins-panel chip.
export type PluginRuntimeStatus =
	| { state: "not-installed" }
	| { state: "installed-off"; version: string }
	| { state: "on-healthy"; version: string; limited: boolean }
	| { state: "degraded"; reason: string }
	| { state: "incompatible"; found: string; required: string }
	// Gated off for the current platform (e.g. ai-whisper on Windows until the
	// upstream `tty` issue is fixed). Cannot be enabled or started; the panel
	// shows the reason and no toggle. Takes priority over any probe result.
	| { state: "unsupported"; reason: string };

export type PluginSnapshot = {
	id: EcosystemPluginId;
	enabled: boolean;
	installPath: string | null;
	status: PluginRuntimeStatus;
	/**
	 * Present only when the probe reported it (whisper, new enough). Drives a
	 * non-blocking "configure your LLM evaluator" warning on the card; orthogonal
	 * to `status`, which stays a clean 1:1 map to the chip.
	 */
	evaluator?: EvaluatorReadiness;
};

// --- whisper driver renderer-facing state ---

export type WhisperBindingState = "unbound" | "pending_attach" | "bound";

export type WhisperAgentBinding = {
	agentType: string;
	bindingState: WhisperBindingState;
};

export type WhisperWorkflowSnapshot = {
	workflowId: string;
	// Provisional pass-throughs of whisper's workflows.workflow_type/status
	// columns. Deliberately `string`, not unions: the value sets belong to
	// whisper's read contract and are not pinned until that doc ships.
	// Known statuses today: running | paused | halted | done | canceled.
	workflowType: string;
	/** whisper's workflows.spec_path — the artifact the workflow runs against. */
	specPath: string;
	status: string;
	currentPhaseIndex: number;
	phaseName: string | null;
	// chain_id of the current phase's relay chain, when one exists. Surfaced so
	// the watcher can read the phase's handback history without re-querying.
	currentChainId: string | null;
	round: { current: number; max: number } | null;
	haltReason: string | null;
	updatedAt: string;
};

export type WhisperEscalation = {
	chainId: string;
	reason: string;
};

export type WhisperHandoffEntry = {
	handoffId: string;
	senderAgent: string;
	targetAgent: string;
	requestText: string;
	handbackText: string | null;
	orchestratorVerdict: string | null;
	roundNumber: number | null;
	createdAt: string;
};

export type WhisperWorktreeState = {
	worktreeId: string;
	collabId: string;
	daemonAlive: boolean;
	liveFeed: "socket" | "polling";
	bindings: WhisperAgentBinding[];
	workflow: WhisperWorkflowSnapshot | null;
	escalation: WhisperEscalation | null;
	// Handback history for the active workflow's current phase chain, capped at
	// the last 20 entries. Empty when there is no active chain.
	handoffs: WhisperHandoffEntry[];
};

// Provisional `whisper env --json` shape (whisper-side deliverable mirrors this).
export type WhisperEnvReport = {
	engineVersion: string;
	installPath: string;
	stateRoot: string;
	dbSchemaVersion: number;
	protocolVersion: string;
	// Optional: only whisper builds that ship the evaluator-readiness field emit
	// it, so older engines parse fine and simply surface no warning.
	evaluator?: EvaluatorReadiness;
};

// --- agent CLI probes (capability-probe-service, spec §3.4) ---

export type AgentCliProbe =
	| { kind: "found"; path: string; version: string | null }
	| { kind: "not-found" };

export type AgentCliProbes = Record<"claude" | "codex" | "ezio", AgentCliProbe>;
