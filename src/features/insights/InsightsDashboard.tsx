// The shared insights dashboard surface (design spec §5, prototype
// `.idb-shell`), rendered as (a) the main window's expanded overlay and (b)
// the detached window's root — `host` picks which header actions render.
//
// Status-driven blocks (loading line / empty state / error state / the
// stats+body pair) are CONDITIONALLY rendered rather than always-mounted +
// CSS-hidden: the state text ("no insights data yet", "insights store
// unavailable", …) must be genuinely absent from the DOM when not in that
// state (§6/AC6 — the states are meant to be distinguishable, and this
// task's tests assert `.not.toBeInTheDocument()` for the non-active ones).
// The `.idb-shell.state-*` classes are still applied for CSS/prod parity
// with the transcribed prototype selectors, but the JSX conditionals are
// authoritative. View switching (overview vs workspaces) is likewise
// component-owned conditional rendering (Task 11 carry-note).
import type React from "react";
import { useInsightsDashboardData } from "./useInsightsDashboardData.js";
import type { RangeKey } from "./bucketEdges.js";
import type { WorkspaceIndex } from "./workspaceRows.js";
import { StatTiles } from "./widgets/StatTiles.js";
import { AppTimeArea } from "./widgets/AppTimeArea.js";
import { RhythmChart } from "./widgets/RhythmChart.js";
import { RunsChart } from "./widgets/RunsChart.js";
import { TokenBurnChart } from "./widgets/TokenBurnChart.js";
import { WorkspaceTable } from "./widgets/WorkspaceTable.js";

const RANGES: RangeKey[] = ["today", "7d", "30d", "all"];
const EMPTY_DOMAIN = { mode: "day" as const, edges: [] as number[] };

function formatUpdatedAt(updatedAt: number | null): string {
	if (updatedAt === null) return "—";
	return new Date(updatedAt).toLocaleTimeString("en-GB", { hour12: false });
}

export function InsightsDashboard({
	host,
	workspaces,
	onClose,
	onDetach,
	onReattach,
	onOpenSettings,
}: {
	host: "overlay" | "window";
	workspaces: WorkspaceIndex;
	onClose: () => void;
	onDetach: () => void;
	onReattach: () => void;
	onOpenSettings: () => void;
}): React.ReactElement {
	const data = useInsightsDashboardData(workspaces);
	const domain = data.domain ?? EMPTY_DOMAIN;
	const showStats = data.status === "loading" || data.status === "live";
	const stateSuffix = data.status !== "live" ? ` state-${data.status}` : "";

	return (
		<div
			className={`idb-shell${host === "window" ? " is-window" : ""}${stateSuffix}`}
			data-testid="insights-dashboard"
		>
			{host === "window" && (
				<div className="idb-titlebar">
					<span className="tb-title">ai-14all — insights</span>
					<button
						type="button"
						className="tb-btn"
						title="Reattach to main window"
						onClick={onReattach}
					>
						⇱ reattach
					</button>
				</div>
			)}

			<div className="idb-frame">
				<div className="idb-head">
					<span className="idb-title">
						insights ▸ <b>dashboard</b>
					</span>
					<div className="idb-seg">
						<button
							type="button"
							className={data.view === "overview" ? "on" : ""}
							onClick={() => data.setView("overview")}
						>
							overview
						</button>
						<button
							type="button"
							className={data.view === "workspaces" ? "on" : ""}
							onClick={() => data.setView("workspaces")}
						>
							workspaces
						</button>
					</div>
					<div className="idb-seg">
						{RANGES.map((r) => (
							<button
								key={r}
								type="button"
								className={data.range === r ? "on" : ""}
								onClick={() => data.setRange(r)}
							>
								{r}
							</button>
						))}
					</div>
					<span className="spacer" />
					{host === "overlay" && (
						<button
							type="button"
							className="idb-act idb-act--detach"
							title="Detach into its own window"
							onClick={onDetach}
						>
							⧉ detach
						</button>
					)}
					{host === "overlay" && (
						<button
							type="button"
							className="idb-act"
							title="Close"
							onClick={onClose}
						>
							✕
						</button>
					)}
				</div>

				{showStats && (
					<StatTiles
						status={data.status}
						range={data.range}
						tiles={data.tiles}
						usageDisabled={data.usageDisabled}
					/>
				)}

				{showStats && (
					<div className="idb-body">
						{data.view === "overview" ? (
							<>
								<div className="idb-grid">
									<AppTimeArea
										domain={domain}
										series={data.series}
										appRetainedSinceMs={
											data.anchors?.appRetainedSinceMs ?? null
										}
									/>
									<RhythmChart rhythm={data.rhythm} />
								</div>
								<div className="idb-grid idb-grid--half">
									<RunsChart
										domain={domain}
										runs={data.runs}
										runsRetainedSinceMs={
											data.anchors?.runsRetainedSinceMs ?? null
										}
									/>
									<TokenBurnChart
										domain={domain}
										days={data.usage?.days ?? []}
										earliestDayMs={data.usage?.earliestDayMs ?? null}
										usageDisabled={data.usageDisabled}
									/>
								</div>
							</>
						) : (
							<WorkspaceTable
								rows={data.workspaceRows.rows}
								totals={data.workspaceRows.totals}
								usageDisabled={data.usageDisabled}
							/>
						)}
					</div>
				)}

				{data.status === "loading" && (
					<div className="idb-loading-line">querying local store…</div>
				)}

				{data.status === "empty" && (
					<div className="idb-state idb-state--empty">
						<span className="glyph">◌</span>
						<div className="h">no insights data yet</div>
						<p className="p">
							capture starts when insights is enabled in settings — the first
							samples appear within a minute of using the app.
						</p>
						<button type="button" className="idb-act" onClick={onOpenSettings}>
							open settings
						</button>
					</div>
				)}

				{data.status === "error" && (
					<div className="idb-state idb-state--error">
						<span className="glyph">!</span>
						<div className="h">insights store unavailable</div>
						<p className="p">
							the local insights database could not be read. your data is
							intact; this view will recover on retry.
						</p>
						<button type="button" className="idb-act" onClick={data.retry}>
							retry
						</button>
					</div>
				)}

				<div className="idb-foot">
					<span>
						{data.footer.glyph === "◐" ? (
							<span className="is-partial">
								{data.footer.glyph} {data.footer.framing}
							</span>
						) : (
							`${data.footer.glyph} ${data.footer.framing}`
						)}
						{data.footer.text.slice(data.footer.framing.length)}
					</span>
					<span>
						updated {formatUpdatedAt(data.updatedAt)} · local store · no network
					</span>
				</div>
			</div>
		</div>
	);
}
