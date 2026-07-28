// Shared "N done · N halted · N failed[ · N active][ · N other]" renderer —
// used by BOTH StatTiles' runs secondary line and WorkspaceTable's runs
// cells/totals row (design spec §4.9 / task-12 brief), so the tile and the
// table are provably built from the same `runsBreakdownLabel` string; only
// the per-class color styling is added here. Design-language rule: outcome
// classes color on --success/--warning/--danger/--info/--muted-foreground,
// never on color alone (the digit + class word both render).
import type React from "react";
import type { RunOutcome, RunOutcomeCounts } from "../runStatus.js";
import { runsBreakdownLabel } from "../runStatus.js";

export const RUN_OUTCOME_COLOR: Record<RunOutcome, string> = {
	done: "var(--success)",
	halted: "var(--warning)",
	failed: "var(--danger)",
	active: "var(--info)",
	other: "var(--muted-foreground)",
};

const CLASS_SUFFIX: Record<RunOutcome, string> = {
	done: "done",
	halted: "halted",
	failed: "failed",
	active: "active",
	other: "other",
};

const CLASS_ORDER = Object.keys(CLASS_SUFFIX) as RunOutcome[];

export function RunsBreakdown({
	counts,
}: {
	counts: RunOutcomeCounts;
}): React.ReactElement {
	const label = runsBreakdownLabel(counts);
	const parts = label.split(" · ").filter(Boolean);
	return (
		<>
			{parts.map((part, i) => {
				const cls =
					CLASS_ORDER.find((k) => part.endsWith(` ${CLASS_SUFFIX[k]}`)) ??
					"other";
				return (
					<span key={cls}>
						{i > 0 ? " · " : ""}
						<span style={{ color: RUN_OUTCOME_COLOR[cls] }}>{part}</span>
					</span>
				);
			})}
		</>
	);
}
