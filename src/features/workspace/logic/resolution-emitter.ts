import type { AgentProvider } from "../../../../shared/models/agent-attention";
import type { DiagnosticsAttentionLogEvent } from "../../../../shared/contracts/commands";

/**
 * One worktree's currently-displayed sidebar attention, distilled to the
 * fields a resolution diagnostic event records. `processId`/`provider` are
 * carried from the top process row when the displayed value is process-sourced
 * (so Task 11's CLI can attribute the resolution to a concrete agent), and are
 * `null` for session-sourced (MCP) display, which has no single owning process.
 */
export type DisplayedAttentionEntry = {
	worktreeId: string;
	processId: string | null;
	provider: AgentProvider | null;
	// `state`/`source` are deliberately untyped display strings (the rendered
	// sidebar label/source), NOT the `AgentAttentionState` enum — display
	// strings differ from the canonical states. Do not "tighten" this to the
	// enum; that would be a regression against the displayed values.
	state: string;
	source: string;
	summary?: string;
};

/** Map keyed by worktreeId — the renderer's per-render displayed-attention. */
export type DisplayedAttentionSnapshot = Record<
	string,
	DisplayedAttentionEntry
>;

/**
 * A resolution event payload minus the `ts` (the caller stamps `Date.now()`
 * at emit time so this stays a pure, deterministic function).
 *
 * Bound to the IPC contract's renderer-facing mirror type
 * ({@link DiagnosticsAttentionLogEvent}, the same payload Task 9's
 * `diagnostics.logAttentionEvent` wrapper accepts) so this hand-maintained
 * shape can't drift from the schema. We deliberately bind to the `shared/`
 * mirror, not the canonical `ResolutionLogEvent` in
 * `services/diagnostics/agent-attention-logger.ts`: renderer logic must not
 * import from `services/` (same layering rule that forces `shared/` to mirror
 * the union). The mirror is kept in sync with the canonical schema by the
 * `_AttentionLogEventSchemaInSync` assertions in the logger module.
 */
export type ResolutionChange = Omit<
	Extract<DiagnosticsAttentionLogEvent, { type: "resolution" }>,
	"ts"
>;

function toSnapshot(entry: DisplayedAttentionEntry): {
	state: string;
	source: string;
	summary?: string;
} {
	return entry.summary === undefined
		? { state: entry.state, source: entry.source }
		: { state: entry.state, source: entry.source, summary: entry.summary };
}

/**
 * Change-detection equality. `processId`/`provider` are intentionally excluded:
 * the spec scopes a "genuine change" to `{state, source, summary}` only. A
 * reader (or Task 11's CLI) must therefore NOT assume processId/provider
 * continuity between consecutive resolution records for the same worktree.
 */
function displayedEqual(
	a: DisplayedAttentionEntry,
	b: DisplayedAttentionEntry,
): boolean {
	return (
		a.state === b.state && a.source === b.source && a.summary === b.summary
	);
}

/**
 * Pure diff of two displayed-attention snapshots. Returns one
 * {@link ResolutionChange} per worktree whose displayed `{state, source,
 * summary}` genuinely changed since `prev`.
 *
 * First-appearance semantics: a key present in `next` but absent from `prev`
 * emits once with `before: null` (the {@link ResolutionLogEvent} schema allows
 * a null `before`). This gives Task 11's CLI a baseline "first observed
 * attention" record per worktree rather than silently swallowing it.
 *
 * Keys that disappear from `next` are intentionally not emitted (there is no
 * meaningful "after" to record; the process/worktree simply went away).
 */
export function diffResolutions(
	prev: DisplayedAttentionSnapshot,
	next: DisplayedAttentionSnapshot,
): ResolutionChange[] {
	const changes: ResolutionChange[] = [];

	for (const worktreeId of Object.keys(next)) {
		const nextEntry = next[worktreeId];
		if (!nextEntry) continue;
		const prevEntry = prev[worktreeId];

		if (prevEntry && displayedEqual(prevEntry, nextEntry)) continue;

		changes.push({
			type: "resolution",
			worktreeId,
			processId: nextEntry.processId,
			provider: nextEntry.provider,
			before: prevEntry ? toSnapshot(prevEntry) : null,
			after: toSnapshot(nextEntry),
		});
	}

	return changes;
}

/**
 * Module-scoped previous-snapshot store for {@link diffAndAdvanceResolutions}.
 *
 * This deliberately lives at module scope (NOT in an App-mounted `useRef`):
 * React `<StrictMode>` (dev + E2E builds) mounts the renderer twice, recreating
 * any per-mount ref to `{}` on the 2nd mount, which would re-emit every
 * worktree's first-appearance `before:null` resolution a second time and
 * pollute the JSONL stream Task 11's CLI parses / Task 12's E2E asserts on.
 * Module state survives StrictMode's simulated unmount/remount, and there is
 * only ever one renderer process / one App, so a single store is safe.
 */
let prevSnapshot: DisplayedAttentionSnapshot = {};

/**
 * Stateful wrapper over the pure {@link diffResolutions}: diffs `next` against
 * the module-scoped previous snapshot, advances the store to `next`, and
 * returns the changes. Idempotent on the same snapshot — calling twice with an
 * equivalent `next` emits the delta once then nothing (the StrictMode-safety
 * property).
 */
export function diffAndAdvanceResolutions(
	next: DisplayedAttentionSnapshot,
): ResolutionChange[] {
	const changes = diffResolutions(prevSnapshot, next);
	prevSnapshot = next;
	return changes;
}

/** Test-only: reset the module-scoped prev-snapshot between cases. */
export function __resetResolutionState(): void {
	prevSnapshot = {};
}
