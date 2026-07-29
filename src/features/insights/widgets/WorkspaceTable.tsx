// Workspaces view table (design spec §4.8/AC5, prototype `#ws-grid`/
// `#ws-total`). Rows/totals are the `buildWorkspaceRows` view-model as-is —
// this widget only renders; the equality-with-tiles guarantee (AC5) is
// structural in that view-model, not something this component computes.
import type React from "react";
import { Fragment } from "react";
import { AGENT_PROVIDERS } from "../../../../shared/models/agent-provider.js";
import type { WorkspaceRowVM } from "../workspaceRows.js";
import { fmtCostUsd, fmtTokens } from "./format.js";
import { RunsBreakdown } from "./RunsBreakdown.js";

function providerColor(provider: string): string {
	return (
		AGENT_PROVIDERS.find((p) => p.id === provider)?.brand ??
		"var(--muted-foreground)"
	);
}

export function WorkspaceTable({
	rows,
	totals,
	usageDisabled,
}: {
	rows: WorkspaceRowVM[];
	totals: Pick<WorkspaceRowVM, "runs" | "tokens" | "costUsd">;
	usageDisabled: boolean;
}): React.ReactElement {
	const maxTokens = Math.max(...rows.map((r) => r.tokens), 1);

	return (
		<div className="idb-ws">
			<div className="idb-ws-grid">
				<div className="hd">workspace</div>
				<div className="hd">agent runs</div>
				<div className="hd">token share</div>
				<div className="hd r">tokens</div>
				<div className="hd r">est. cost</div>
				{rows.map((r, i) => {
					const last = i === rows.length - 1 ? " row-last" : "";
					const widthPct = (r.tokens / maxTokens) * 100;
					// Every cell of a row carries the SAME per-row testid (rows sort
					// tokens-desc, so DOM/visual order never identifies a specific
					// workspace's row — e.g. the untracked row can sort first) —
					// combined with the cell's own class it unambiguously scopes to
					// "this row's runs cell" / "this row's tokens cell" without
					// depending on sort position. `r.key` is the workspace's registry
					// id (or UNTRACKED_KEY), stable per row.
					const rowTestId = `ws-row-${r.key}`;
					return (
						<Fragment key={r.key}>
							<div className={`cell${last}`} data-testid={rowTestId}>
								<div className="ws-name">{r.name}</div>
								<div className="ws-path">{r.detail}</div>
							</div>
							<div className={`cell ws-runs${last}`} data-testid={rowTestId}>
								<RunsBreakdown counts={r.runs} />
							</div>
							<div className={`cell${last}`} data-testid={rowTestId}>
								{usageDisabled ? null : (
									<div
										className="ws-share"
										style={{ width: `${widthPct.toFixed(1)}%` }}
									>
										{r.mix.map((m) => (
											<span
												key={m.provider}
												className="p"
												style={{
													width: `${((m.tokens / (r.tokens || 1)) * 100).toFixed(1)}%`,
													background: providerColor(m.provider),
												}}
											/>
										))}
									</div>
								)}
							</div>
							<div className={`cell r ws-tok${last}`} data-testid={rowTestId}>
								{usageDisabled ? "—" : fmtTokens(r.tokens)}
							</div>
							<div className={`cell r ws-cost${last}`} data-testid={rowTestId}>
								{usageDisabled ? "—" : fmtCostUsd(r.costUsd)}
							</div>
						</Fragment>
					);
				})}
			</div>
			<div className="idb-ws-total" data-testid="ws-totals">
				<div>total</div>
				<div className="ws-runs">
					<RunsBreakdown counts={totals.runs} />
				</div>
				<div />
				<div className="r">
					{usageDisabled ? "—" : fmtTokens(totals.tokens)}
				</div>
				<div className="r">
					{usageDisabled ? "—" : fmtCostUsd(totals.costUsd)}
				</div>
			</div>
			<div className="idb-ws-note">
				<span className="g">›</span> focused / engaged per workspace lands with
				the workspace-active collector (follow-up slice) — the "effort on
				project X" number.
			</div>
		</div>
	);
}
