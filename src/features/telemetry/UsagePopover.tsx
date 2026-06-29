import { Fragment, useState, type CSSProperties, type Ref } from "react";
import type {
	UsageScope,
	UsageSnapshot,
} from "../../../shared/models/usage.js";
import { Icon } from "@/components/ui/icon";
import { formatReset, formatTokens, formatUsd } from "./format.js";
import { Gauge } from "./Gauge.js";
import { groupByWorkspace } from "./group.js";
import { UsageChart } from "./UsageChart.js";

type Breakdown = "provider" | "workspace" | "worktree";

export function UsagePopover({
	snapshot,
	onClose,
	style,
	rootRef,
}: {
	snapshot: UsageSnapshot;
	onClose: () => void;
	style?: CSSProperties;
	rootRef?: Ref<HTMLDivElement>;
	openWorktreePaths?: string[];
	currentWorktreePath?: string | null;
}) {
	// Scope is ephemeral: the popover always opens on Session and resets on every
	// mount/open (UsageStrip mounts the popover only while open, so unmounting on
	// close is what makes reopening return to Session). Not persisted.
	const [scope, setScope] = useState<UsageScope>("session");
	const [breakdown, setBreakdown] = useState<Breakdown>("provider");
	// Seed the toggle from the persisted/effective setting in config (NOT a blank
	// false), so a user who turned "include untracked" on sees it reflected.
	const [includeUntracked, setIncludeUntracked] = useState(
		snapshot.config.includeUntracked ?? false,
	);
	const [showLimits, setShowLimits] = useState(false);
	const now = snapshot.generatedAtMs;
	const data = snapshot.scopes[scope];
	const cost = data.cost;
	const rows = data.rows.filter(
		(r) => includeUntracked || r.workspaceId !== null,
	);
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
					<span className="usage-seg" role="group" aria-label="scope">
						<button
							className={scope === "session" ? "on" : ""}
							onClick={() => setScope("session")}
						>
							Session
						</button>
						<button
							className={scope === "week" ? "on" : ""}
							onClick={() => setScope("week")}
						>
							Week
						</button>
						<button
							className={scope === "month" ? "on" : ""}
							onClick={() => setScope("month")}
						>
							Month
						</button>
						<button
							className={scope === "all-time" ? "on" : ""}
							onClick={() => setScope("all-time")}
						>
							All-time
						</button>
					</span>
					<span className="usage-pop-total">
						<b>{formatTokens(data.totalTokens)}</b>
						<span className="usage-dim" title="notional">
							{" "}
							· ~{formatUsd(cost.total)} notional
						</span>
					</span>
					<button className="usage-gear" aria-label="close" onClick={onClose}>
						<Icon name="close" />
					</button>
				</div>
				{scope === "session" ? (
					<UsageChart
						kind="hourly"
						hourly={snapshot.seriesHourly}
						providers={snapshot.providers}
						nowMs={now}
					/>
				) : scope === "all-time" ? null : (
					<UsageChart
						kind="daily"
						daily={snapshot.seriesDaily}
						providers={snapshot.providers}
						range={scope}
						nowMs={now}
						showDayLabels
					/>
				)}
			</div>

			{/* breakdown */}
			<div className="usage-pop-sec">
				<div className="usage-pop-h">
					<span className="usage-seg" role="group" aria-label="breakdown">
						<button
							className={breakdown === "provider" ? "on" : ""}
							onClick={() => setBreakdown("provider")}
						>
							Provider
						</button>
						<button
							className={breakdown === "workspace" ? "on" : ""}
							onClick={() => setBreakdown("workspace")}
						>
							Workspace
						</button>
						<button
							className={breakdown === "worktree" ? "on" : ""}
							onClick={() => setBreakdown("worktree")}
						>
							Worktree
						</button>
					</span>
					{breakdown !== "provider" ? (
						<label className="usage-toggle">
							include untracked
							<input
								type="checkbox"
								checked={includeUntracked}
								onChange={toggleUntracked}
							/>
						</label>
					) : null}
				</div>

				{breakdown === "provider" ? (
					<div className="usage-rollup">
						{data.byProvider.map((r) => (
							<div className="usage-rollup-row" key={r.provider}>
								<span className={`usage-prov usage-prov--${r.provider}`}>
									{r.provider}
								</span>
								<span className="usage-share">
									<span
										className="usage-share-fill"
										style={{
											width: `${data.totalTokens ? (r.tokens / data.totalTokens) * 100 : 0}%`,
											background: `var(--provider-${r.provider})`,
										}}
									/>
								</span>
								<span className="usage-rollup-tok">
									{formatTokens(r.tokens)}
								</span>
								<span className="usage-dim" title="notional">
									{r.costUsd == null ? "—" : `~${formatUsd(r.costUsd)}`}
								</span>
							</div>
						))}
						<div className="usage-rollup-row usage-rollup-total">
							<span>total</span>
							<span className="usage-share" />
							<span className="usage-rollup-tok">
								{formatTokens(data.totalTokens)}
							</span>
							<span className="usage-dim" title="notional">
								~{formatUsd(cost.total)}
							</span>
						</div>
						{cost.unpricedTokens > 0 ? (
							<div className="usage-dim usage-unpriced">
								+{formatTokens(cost.unpricedTokens)} tokens unpriced
							</div>
						) : null}
						<div className="usage-dim usage-rollup-note" title="notional">
							~$ = notional API-equivalent value
						</div>
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
										<td className="l">{g.label}</td>
										<td>{formatTokens(g.subtotal.billable)}</td>
										<td />
									</tr>
									{g.rows.map((r, i) => (
										<tr
											key={`${g.workspaceId}-${r.worktreeId}-${r.provider}-${i}`}
										>
											<td className="l usage-wt">
												{r.worktreeTitle} ·{" "}
												<span
													className={`usage-prov usage-prov--${r.provider}`}
												>
													{r.provider}
												</span>
											</td>
											<td>{formatTokens(r.tokens.billable)}</td>
											<td className="usage-dim">
												{r.costUsd == null ? "—" : `~${formatUsd(r.costUsd)}`}
											</td>
										</tr>
									))}
								</Fragment>
							))}
						</tbody>
					</table>
				)}
			</div>

			{/* codex native limits — collapsed */}
			{limits ? (
				<div className="usage-pop-sec">
					<button
						className="usage-limits-row"
						aria-expanded={showLimits}
						aria-label="Codex limits"
						onClick={() => setShowLimits((v) => !v)}
					>
						<span className="usage-dim">
							{showLimits ? "▾" : "▸"} Codex limits · native
						</span>
						{!showLimits && (
							<span className="usage-lim-summary">
								5h {limits.fiveHour.percent}% · wk {limits.weekly.percent}%
							</span>
						)}
					</button>
					{showLimits ? (
						<div className="usage-limits">
							<span className="usage-lim-lbl">5h</span>
							<Gauge percent={limits.fiveHour.percent} />
							<span className="usage-lim-pct">{limits.fiveHour.percent}%</span>
							<span className="usage-reset">
								{formatReset(limits.fiveHour.resetsAtMs, now)
									? `resets ${formatReset(limits.fiveHour.resetsAtMs, now)}`
									: ""}
							</span>
							<span className="usage-lim-lbl">week</span>
							<Gauge percent={limits.weekly.percent} />
							<span className="usage-lim-pct">{limits.weekly.percent}%</span>
							<span className="usage-reset">
								{formatReset(limits.weekly.resetsAtMs, now)
									? `resets ${formatReset(limits.weekly.resetsAtMs, now)}`
									: ""}
							</span>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
