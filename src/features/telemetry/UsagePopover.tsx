import { Fragment, useState, type CSSProperties, type Ref } from "react";
import type { UsageRow, UsageSnapshot } from "../../../shared/models/usage.js";
import { Icon } from "@/components/ui/icon";
import { formatReset, formatTokens, formatUsd } from "./format.js";
import { Gauge } from "./Gauge.js";
import { groupByWorkspace } from "./group.js";
import { providerRollup, rowCostUsd } from "./rollup.js";
import { UsageChart } from "./UsageChart.js";

type Scope = "active" | "all";
type Breakdown = "provider" | "workspace" | "worktree";

// Apply scope + untracked toggle. Pulled out so it is unit-testable.
export function selectRows(
	rows: UsageRow[],
	scope: Scope,
	includeUntracked: boolean,
): UsageRow[] {
	let tracked = rows.filter((r) => r.workspaceId !== null);
	if (scope === "active") tracked = tracked.filter((r) => r.active);
	const untracked = includeUntracked
		? rows.filter((r) => r.workspaceId === null)
		: [];
	return [...tracked, ...untracked];
}

function setRange(range: "week" | "month"): void {
	void window.ai14all?.usage?.setRange(range);
}

export function UsagePopover({
	snapshot,
	onClose,
	style,
	rootRef,
	openWorktreePaths,
}: {
	snapshot: UsageSnapshot;
	onClose: () => void;
	style?: CSSProperties;
	rootRef?: Ref<HTMLDivElement>;
	openWorktreePaths?: string[];
	currentWorktreePath?: string | null;
}) {
	const range = snapshot.config.range ?? "week";
	const [breakdown, setBreakdown] = useState<Breakdown>("provider");
	const [scope] = useState<Scope>("all");
	// Seed the toggle from the persisted/effective setting in config (NOT a blank
	// false), so a user who turned "include untracked" on sees it reflected.
	const [includeUntracked, setIncludeUntracked] = useState(
		snapshot.config.includeUntracked ?? false,
	);
	const [showLimits, setShowLimits] = useState(false);
	const now = snapshot.generatedAtMs;
	const providers = snapshot.providers ?? [];
	const series = snapshot.series ?? [];
	const cost = snapshot.cost ?? null;

	const scopedRows = openWorktreePaths
		? snapshot.rows.map((r) => ({
				...r,
				active: r.worktreePath !== null && openWorktreePaths.includes(r.worktreePath),
			}))
		: snapshot.rows;
	const rows = selectRows(scopedRows, scope, includeUntracked);
	const rollup = providerRollup(series, range, cost, now);
	const groups = groupByWorkspace(rows);
	const limits = snapshot.codexLimits ?? null;

	function toggleUntracked() {
		const next = !includeUntracked;
		setIncludeUntracked(next);
		void window.ai14all?.usage?.setIncludeUntracked(next);
	}

	return (
		<div className="usage-pop" role="dialog" style={style} ref={rootRef}>
			{/* chart */}
			<div className="usage-pop-sec">
				<div className="usage-pop-h">
					<span className="usage-range" role="group" aria-label="range">
						<button className={range === "week" ? "on" : ""} onClick={() => setRange("week")}>Week</button>
						<button className={range === "month" ? "on" : ""} onClick={() => setRange("month")}>Month</button>
					</span>
					<span className="usage-pop-total">
						<b>{formatTokens(rollup.totalTokens)}</b>
						{cost ? <span className="usage-dim"> · ~{formatUsd(rollup.totalCost ?? 0)}</span> : null}
					</span>
					<button className="usage-gear" aria-label="close" onClick={onClose}>
						<Icon name="close" />
					</button>
				</div>
				<UsageChart series={series} providers={providers} range={range} nowMs={now} height={74} />
			</div>

			{/* breakdown */}
			<div className="usage-pop-sec">
				<div className="usage-pop-h">
					<span className="usage-seg" role="group" aria-label="breakdown">
						<button className={breakdown === "provider" ? "on" : ""} onClick={() => setBreakdown("provider")}>Provider</button>
						<button className={breakdown === "workspace" ? "on" : ""} onClick={() => setBreakdown("workspace")}>Workspace</button>
						<button className={breakdown === "worktree" ? "on" : ""} onClick={() => setBreakdown("worktree")}>Worktree</button>
					</span>
					{breakdown !== "provider" ? (
						<label className="usage-toggle">
							include untracked
							<input type="checkbox" checked={includeUntracked} onChange={toggleUntracked} />
						</label>
					) : null}
				</div>

				{breakdown === "provider" ? (
					<div className="usage-rollup">
						{rollup.rows.map((r) => (
							<div className="usage-rollup-row" key={r.provider}>
								<span className={`usage-prov usage-prov--${r.provider}`}>{r.provider}</span>
								<span className="usage-share">
									<span
										className="usage-share-fill"
										style={{
											width: `${rollup.totalTokens ? (r.tokens / rollup.totalTokens) * 100 : 0}%`,
											background: `var(--provider-${r.provider})`,
										}}
									/>
								</span>
								<span className="usage-rollup-tok">{formatTokens(r.tokens)}</span>
								<span className="usage-dim">{r.costUsd == null ? "—" : `~${formatUsd(r.costUsd)}`}</span>
							</div>
						))}
						<div className="usage-rollup-row usage-rollup-total">
							<span>total</span>
							<span className="usage-share" />
							<span className="usage-rollup-tok">{formatTokens(rollup.totalTokens)}</span>
							<span className="usage-dim">{cost ? `~${formatUsd(rollup.totalCost ?? 0)}` : "—"}</span>
						</div>
						{cost && cost.unpricedTokens > 0 ? (
							<div className="usage-dim usage-unpriced">
								+{formatTokens(cost.unpricedTokens)} tokens unpriced
							</div>
						) : null}
					</div>
				) : (
					<table className="usage-tbl">
						<thead>
							<tr>
								<th className="l">workspace / worktree · agent</th>
								<th>tokens</th>
								<th>~$</th>
							</tr>
						</thead>
						<tbody>
							{groups.map((g) => (
								<Fragment key={g.workspaceId ?? "untracked"}>
									<tr className="usage-ws">
										<td className="l">{g.workspaceId ?? "untracked"}</td>
										<td>{formatTokens(g.subtotal.billable)}</td>
										<td />
									</tr>
									{g.rows.map((r, i) => {
										const c = rowCostUsd(r, rows, cost);
										return (
											<tr key={`${g.workspaceId}-${r.worktreeId}-${r.provider}-${i}`}>
												<td className="l usage-wt">
													{r.worktreeTitle} ·{" "}
													<span className={`usage-prov usage-prov--${r.provider}`}>{r.provider}</span>
												</td>
												<td>{formatTokens(r.sinceLaunch.billable)}</td>
												<td className="usage-dim">{c == null ? "—" : `~${formatUsd(c)}`}</td>
											</tr>
										);
									})}
								</Fragment>
							))}
						</tbody>
					</table>
				)}
			</div>

			{/* lifetime (Slice 2): rendered only when present */}
			{snapshot.lifetime ? (
				<div className="usage-pop-sec usage-lifetime">
					<div className="usage-life-card">
						<div className="usage-dim">in app</div>
						<div className="usage-life-fig">{formatTokens(snapshot.lifetime.inApp.tokens)}</div>
						<div className="usage-dim">
							{snapshot.lifetime.inApp.costUsd == null ? "—" : `~${formatUsd(snapshot.lifetime.inApp.costUsd)}`} · while app open
						</div>
					</div>
					{snapshot.lifetime.allTime ? (
						<div className="usage-life-card">
							<div className="usage-dim">all-time</div>
							<div className="usage-life-fig">{formatTokens(snapshot.lifetime.allTime.tokens)}</div>
							<div className="usage-dim">
								{snapshot.lifetime.allTime.costUsd == null ? "—" : `~${formatUsd(snapshot.lifetime.allTime.costUsd)}`} · on this machine
							</div>
						</div>
					) : null}
				</div>
			) : null}

			{/* codex native limits — collapsed */}
			{limits ? (
				<div className="usage-pop-sec">
					<button
						className="usage-limits-row"
						aria-expanded={showLimits}
						aria-label="Codex limits"
						onClick={() => setShowLimits((v) => !v)}
					>
						<span className="usage-dim">{showLimits ? "▾" : "▸"} Codex limits · native</span>
					</button>
					{showLimits ? (
						<div className="usage-limits">
							<span className="usage-lim-lbl">5h</span>
							<Gauge percent={limits.fiveHour.percent} />
							<span className="usage-lim-pct">{limits.fiveHour.percent}%</span>
							<span className="usage-reset">
								{formatReset(limits.fiveHour.resetsAtMs, now) ? `resets ${formatReset(limits.fiveHour.resetsAtMs, now)}` : ""}
							</span>
							<span className="usage-lim-lbl">week</span>
							<Gauge percent={limits.weekly.percent} />
							<span className="usage-lim-pct">{limits.weekly.percent}%</span>
							<span className="usage-reset">
								{formatReset(limits.weekly.resetsAtMs, now) ? `resets ${formatReset(limits.weekly.resetsAtMs, now)}` : ""}
							</span>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
