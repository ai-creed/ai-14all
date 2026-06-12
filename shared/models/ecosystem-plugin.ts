export const ECOSYSTEM_PLUGIN_IDS = ["whisper", "cortex"] as const;

export type EcosystemPluginId = (typeof ECOSYSTEM_PLUGIN_IDS)[number];

export type ProbeResult =
	| { kind: "not-installed" }
	| {
			kind: "installed";
			version: string;
			installPath: string;
			protocolVersion: string;
	  }
	| { kind: "incompatible"; found: string; required: string };

// Maps 1:1 to the Plugins-panel chip.
export type PluginRuntimeStatus =
	| { state: "not-installed" }
	| { state: "installed-off"; version: string }
	| { state: "on-healthy"; version: string; limited: boolean }
	| { state: "degraded"; reason: string }
	| { state: "incompatible"; found: string; required: string };

export type PluginSnapshot = {
	id: EcosystemPluginId;
	enabled: boolean;
	installPath: string | null;
	status: PluginRuntimeStatus;
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
	status: string;
	currentPhaseIndex: number;
	phaseName: string | null;
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
};

// Provisional `whisper env --json` shape (whisper-side deliverable mirrors this).
export type WhisperEnvReport = {
	engineVersion: string;
	installPath: string;
	stateRoot: string;
	dbSchemaVersion: number;
	protocolVersion: string;
};

// --- agent CLI probes (capability-probe-service, spec §3.4) ---

export type AgentCliProbe =
	| { kind: "found"; path: string; version: string | null }
	| { kind: "not-found" };

export type AgentCliProbes = Record<"claude" | "codex", AgentCliProbe>;
