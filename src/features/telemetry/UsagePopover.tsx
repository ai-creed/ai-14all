import { Fragment, useState, type CSSProperties, type Ref } from "react";
import type {
	UsageConfig,
	UsageRow,
	UsageSnapshot,
} from "../../../shared/models/usage.js";
import { Icon } from "@/components/ui/icon";
import { formatReset, formatTokens } from "./format.js";
import { Gauge } from "./Gauge.js";
import { groupByWorkspace } from "./group.js";

type Scope = "active" | "all";

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

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function BudgetEditor({
	config,
	onSave,
}: {
	config: UsageConfig;
	// Inputs are prefilled with the current effective values so they aren't
	// blank-overwritten by accident.
	onSave: (
		fiveHour: number | null,
		weekly: number | null,
		resetDay: number,
		resetHour: number,
	) => void;
}) {
	// Inputs are in millions of tokens for readability; convert on save.
	const toM = (n: number): string => String(n / 1_000_000);
	const fromM = (s: string): number | null =>
		s.trim() ? Math.round(Number(s) * 1_000_000) : null;
	const [fiveHour, setFiveHour] = useState(toM(config.fiveHourBudget));
	const [weekly, setWeekly] = useState(toM(config.weeklyBudget));
	const [resetDay, setResetDay] = useState(config.weeklyResetDay);
	const [resetHour, setResetHour] = useState(config.weeklyResetHour);
	return (
		<form
			className="usage-budget-editor"
			onSubmit={(e) => {
				e.preventDefault();
				onSave(fromM(fiveHour), fromM(weekly), resetDay, resetHour);
			}}
		>
			<p className="usage-budget-note">
				These settings are for <b>Claude only</b> — Codex uses its own reported
				limits automatically. Budgets are <b>billable tokens</b> (input + output
				+ cache-creation; cache reads excluded). The <b>weekly reset</b> is when
				your Claude limit rolls over — find it in Claude Code&apos;s{" "}
				<code>/usage</code> (the &ldquo;resets…&rdquo; line) and set the
				matching day/time.
			</p>
			<div className="usage-budget-row">
				<label>
					5h budget (M tokens)
					<input
						aria-label="5h budget in millions"
						value={fiveHour}
						onChange={(e) => setFiveHour(e.target.value)}
						inputMode="decimal"
					/>
				</label>
				<label>
					weekly budget (M tokens)
					<input
						aria-label="weekly budget in millions"
						value={weekly}
						onChange={(e) => setWeekly(e.target.value)}
						inputMode="decimal"
					/>
				</label>
				<label>
					weekly reset day
					<select
						aria-label="weekly reset day"
						value={resetDay}
						onChange={(e) => setResetDay(Number(e.target.value))}
					>
						{DAYS.map((d, i) => (
							<option key={d} value={i}>
								{d}
							</option>
						))}
					</select>
				</label>
				<label>
					reset hour (0–23)
					<input
						aria-label="weekly reset hour"
						type="number"
						min={0}
						max={23}
						value={resetHour}
						onChange={(e) => setResetHour(Number(e.target.value))}
					/>
				</label>
				<button type="submit">Save</button>
			</div>
		</form>
	);
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
}) {
	const [scope, setScope] = useState<Scope>("active"); // default Active
	const [includeUntracked, setIncludeUntracked] = useState(false);
	const [editingBudget, setEditingBudget] = useState(false);
	const [showHelp, setShowHelp] = useState(false);
	const now = snapshot.generatedAtMs;

	// When the app tells us which worktrees are open (by path — ids are unstable
	// across processes), that defines "Active"; otherwise fall back to the
	// snapshot's own active flag (e.g. in tests).
	const scopedRows = openWorktreePaths
		? snapshot.rows.map((r) => ({
				...r,
				active:
					r.worktreePath !== null && openWorktreePaths.includes(r.worktreePath),
			}))
		: snapshot.rows;
	const rows = selectRows(scopedRows, scope, includeUntracked);
	const groups = groupByWorkspace(rows);
	const total = rows.reduce(
		(acc, r) => ({
			input: acc.input + r.sinceLaunch.input,
			output: acc.output + r.sinceLaunch.output,
		}),
		{ input: 0, output: 0 },
	);
	const weekTotal = rows.reduce((acc, r) => acc + r.thisWeek.billable, 0);

	function toggleUntracked() {
		const next = !includeUntracked;
		setIncludeUntracked(next);
		void window.ai14all?.usage?.setIncludeUntracked(next); // persist as next-launch default
	}

	function saveBudgets(
		fiveHour: number | null,
		weekly: number | null,
		resetDay: number,
		resetHour: number,
	) {
		setEditingBudget(false);
		void window.ai14all?.usage?.setBudgets(fiveHour, weekly);
		void window.ai14all?.usage?.setWeeklyReset(resetDay, resetHour);
	}

	return (
		<div className="usage-pop" role="dialog" style={style} ref={rootRef}>
			<div className="usage-pop-sec">
				<div className="usage-pop-h">
					<span>Account limits</span>
					<button className="usage-gear" aria-label="close" onClick={onClose}>
						<Icon name="close" />
					</button>
				</div>
				<div className="usage-limits">
					{snapshot.limits.map((l) => {
						const fhReset = formatReset(l.fiveHour.resetsAtMs, now);
						const wkReset = formatReset(l.weekly.resetsAtMs, now);
						const wkDetail = [
							l.weekly.budget
								? `${formatTokens(l.weekly.used ?? 0)} / ${formatTokens(l.weekly.budget)}`
								: "",
							wkReset ? `resets ${wkReset}` : "",
						]
							.filter(Boolean)
							.join(" · ");
						return (
							<Fragment key={l.provider}>
								<span className={`usage-prov usage-prov--${l.provider}`}>
									{l.provider}
								</span>
								<span className="usage-lim-lbl">5h</span>
								<Gauge percent={l.fiveHour.percent} />
								<span className="usage-lim-pct">{l.fiveHour.percent}%</span>
								<span className="usage-reset">
									{fhReset ? `resets ${fhReset}` : ""}
								</span>
								<span className="usage-lim-lbl">week</span>
								<Gauge percent={l.weekly.percent} />
								<span className="usage-lim-pct">{l.weekly.percent}%</span>
								<span className="usage-reset">{wkDetail}</span>
							</Fragment>
						);
					})}
				</div>
			</div>
			<div className="usage-pop-sec">
				<div className="usage-pop-h">
					<span className="usage-seg" role="group" aria-label="scope">
						<button
							className={scope === "active" ? "on" : ""}
							aria-pressed={scope === "active"}
							onClick={() => setScope("active")}
						>
							active
						</button>
						<button
							className={scope === "all" ? "on" : ""}
							aria-pressed={scope === "all"}
							onClick={() => setScope("all")}
						>
							all tracked
						</button>
					</span>
					<label className="usage-toggle">
						include untracked
						<input
							type="checkbox"
							checked={includeUntracked}
							onChange={toggleUntracked}
						/>
					</label>
				</div>
				<table className="usage-tbl">
					<thead>
						<tr>
							<th className="l">workspace / worktree · agent</th>
							<th>
								<Icon name="arrow-up" /> in
							</th>
							<th>
								<Icon name="arrow-down" /> out
							</th>
							<th>this week</th>
						</tr>
					</thead>
					<tbody>
						{groups.map((g) => (
							<Fragment key={g.workspaceId ?? "untracked"}>
								<tr className="usage-ws">
									<td className="l">{g.label}</td>
									<td>{formatTokens(g.subtotal.input)}</td>
									<td className="usage-raw">
										{formatTokens(g.subtotal.output)}
									</td>
									<td />
								</tr>
								{g.rows.map((r, i) => (
									<tr
										key={`${g.workspaceId}-${r.worktreeId}-${r.provider}-${i}`}
									>
										<td className="l usage-wt">
											{r.worktreeTitle} ·{" "}
											<span className={`usage-prov usage-prov--${r.provider}`}>
												{r.provider}
											</span>
										</td>
										<td>{formatTokens(r.sinceLaunch.input)}</td>
										<td className="usage-raw">
											{formatTokens(r.sinceLaunch.output)}
										</td>
										<td className="usage-dim">
											{formatTokens(r.thisWeek.billable)}
										</td>
									</tr>
								))}
							</Fragment>
						))}
					</tbody>
				</table>
			</div>
			<div className="usage-pop-sec usage-foot">
				<span className="usage-dim" data-testid="usage-total">
					session <Icon name="arrow-up" />
					<span className="usage-bill">{formatTokens(total.input)}</span>{" "}
					<Icon name="arrow-down" />
					<span className="usage-bill">{formatTokens(total.output)}</span>
					{" · week "}
					<span className="usage-bill">{formatTokens(weekTotal)}</span>
				</span>
				<span className="usage-foot-actions">
					<button
						className="usage-gear"
						aria-label="how to read these numbers"
						aria-expanded={showHelp}
						onClick={() => setShowHelp((v) => !v)}
					>
						<Icon name="info" /> how to read
					</button>
					<button
						className="usage-gear"
						aria-label="budget settings"
						onClick={() => setEditingBudget((v) => !v)}
					>
						<Icon name="gear" /> budget settings
					</button>
				</span>
			</div>
			{showHelp && (
				<div className="usage-pop-sec usage-help">
					<dl>
						<dt>
							<span className="usage-bill">
								<Icon name="arrow-up" /> in
							</span>{" "}
							/{" "}
							<span className="usage-bill">
								<Icon name="arrow-down" /> out
							</span>
						</dt>
						<dd>
							<b>in</b> = prompt tokens you send (your input + first-time cached
							context). <b>out</b> = tokens the agent generates in reply. Cache
							re-reads of context are excluded — they&apos;re nearly free.
						</dd>
						<dt>session</dt>
						<dd>
							Usage since you launched the app — <b>resets every restart</b>.
							That&apos;s why the number differs run to run; it&apos;s
							&ldquo;your work this sitting&rdquo;, not all-time.
						</dd>
						<dt>this week</dt>
						<dd>Rolling total tied to your weekly limit window.</dd>
						<dt>Active / All tracked</dt>
						<dd>
							<b>active</b> = worktrees open in the app now. <b>all tracked</b>{" "}
							= every worktree with recent activity.
						</dd>
						<dt>account limits</dt>
						<dd>
							<span className="usage-prov usage-prov--codex">codex</span> is the
							real % the provider reports (with reset countdown).{" "}
							<span className="usage-prov usage-prov--claude">claude</span> is
							an estimate vs your budget (⚙) — the API doesn&apos;t expose the
							real number.
						</dd>
					</dl>
				</div>
			)}
			{editingBudget && (
				<div className="usage-pop-sec">
					<BudgetEditor config={snapshot.config} onSave={saveBudgets} />
				</div>
			)}
		</div>
	);
}
