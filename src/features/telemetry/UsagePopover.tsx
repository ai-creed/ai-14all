import { Fragment, useState, type CSSProperties, type Ref } from "react";
import type {
	UsageConfig,
	UsageRow,
	UsageSnapshot,
} from "../../../shared/models/usage.js";
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
			className="flex flex-col gap-3.5"
			onSubmit={(e) => {
				e.preventDefault();
				onSave(fromM(fiveHour), fromM(weekly), resetDay, resetHour);
			}}
		>
			<p className="m-0 text-[10px] leading-relaxed text-secondary-foreground">
				These settings are for <b className="text-foreground">Claude only</b> —
				Codex uses its own reported limits automatically. Budgets are{" "}
				<b className="text-foreground">billable tokens</b> (input + output +
				cache-creation; cache reads excluded). The{" "}
				<b className="text-foreground">weekly reset</b> is when your Claude limit
				rolls over — find it in Claude Code&apos;s{" "}
				<code className="text-foreground bg-background px-1 rounded-sm">
					/usage
				</code>{" "}
				(the &ldquo;resets…&rdquo; line) and set the matching day/time.
			</p>
			<div className="flex gap-2 items-end flex-nowrap">
				<label className="flex flex-col gap-1 text-[10px] text-secondary-foreground whitespace-nowrap">
					5h budget (M tokens)
					<input
						aria-label="5h budget in millions"
						value={fiveHour}
						onChange={(e) => setFiveHour(e.target.value)}
						inputMode="decimal"
						className="w-[72px] h-[26px] box-border bg-background border border-border rounded-[5px] text-foreground px-1.5 py-0.5"
					/>
				</label>
				<label className="flex flex-col gap-1 text-[10px] text-secondary-foreground whitespace-nowrap">
					weekly budget (M tokens)
					<input
						aria-label="weekly budget in millions"
						value={weekly}
						onChange={(e) => setWeekly(e.target.value)}
						inputMode="decimal"
						className="w-[72px] h-[26px] box-border bg-background border border-border rounded-[5px] text-foreground px-1.5 py-0.5"
					/>
				</label>
				<label className="flex flex-col gap-1 text-[10px] text-secondary-foreground whitespace-nowrap">
					weekly reset day
					<select
						aria-label="weekly reset day"
						value={resetDay}
						onChange={(e) => setResetDay(Number(e.target.value))}
						className="w-[72px] h-[26px] box-border bg-background border border-border rounded-[5px] text-foreground px-1.5 py-0.5"
					>
						{DAYS.map((d, i) => (
							<option key={d} value={i}>
								{d}
							</option>
						))}
					</select>
				</label>
				<label className="flex flex-col gap-1 text-[10px] text-secondary-foreground whitespace-nowrap">
					reset hour (0–23)
					<input
						aria-label="weekly reset hour"
						type="number"
						min={0}
						max={23}
						value={resetHour}
						onChange={(e) => setResetHour(Number(e.target.value))}
						className="w-[72px] h-[26px] box-border bg-background border border-border rounded-[5px] text-foreground px-1.5 py-0.5"
					/>
				</label>
				<button
					type="submit"
					className="h-[26px] bg-popover border border-border rounded-[5px] text-foreground px-3 cursor-pointer whitespace-nowrap"
				>
					Save
				</button>
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
		<div
			className="absolute z-50 top-full right-0 mt-1.5 max-h-[70vh] overflow-y-auto bg-popover border border-[var(--panel-border-strong)] rounded-[10px] shadow-[0_12px_40px_rgba(0,0,0,0.4)] w-[760px] text-secondary-foreground text-[11px] font-mono tabular-nums"
			role="dialog"
			style={style}
			ref={rootRef}
		>
			{/* ── Account limits section ── */}
			<div className="px-3.5 py-3 border-b border-border">
				<div className="text-muted-foreground text-[9px] tracking-[0.06em] uppercase mb-2 flex justify-between items-center">
					<span>Account limits</span>
					<button
						className="bg-transparent border-none text-muted-foreground text-[11px] cursor-pointer"
						aria-label="close"
						onClick={onClose}
					>
						✕
					</button>
				</div>
				<div className="grid grid-cols-[auto_auto_auto_auto_auto_auto_auto_auto_1fr] gap-x-2.5 gap-y-[7px] items-center">
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
								<span
									className={`font-semibold ${l.provider === "claude" ? "text-[var(--provider-claude)]" : "text-[var(--provider-codex)]"}`}
								>
									{l.provider}
								</span>
								<span className="text-muted-foreground">5h</span>
								<Gauge percent={l.fiveHour.percent} />
								<span className="text-right text-foreground">
									{l.fiveHour.percent}%
								</span>
								<span className="text-muted-foreground">
									{fhReset ? `resets ${fhReset}` : ""}
								</span>
								<span className="text-muted-foreground">week</span>
								<Gauge percent={l.weekly.percent} />
								<span className="text-right text-foreground">
									{l.weekly.percent}%
								</span>
								<span className="text-muted-foreground">{wkDetail}</span>
							</Fragment>
						);
					})}
				</div>
			</div>

			{/* ── Breakdown table section ── */}
			<div className="px-3.5 py-3 border-b border-border">
				<div className="text-muted-foreground text-[9px] tracking-[0.06em] uppercase mb-2 flex justify-between items-center">
					<span
						className="inline-flex bg-background border border-border rounded-md overflow-hidden"
						role="group"
						aria-label="scope"
					>
						<button
							className={`px-2.5 py-0.5 text-[10px] border-none cursor-pointer ${scope === "active" ? "bg-popover text-foreground" : "bg-transparent text-muted-foreground"}`}
							aria-pressed={scope === "active"}
							onClick={() => setScope("active")}
						>
							active
						</button>
						<button
							className={`px-2.5 py-0.5 text-[10px] border-none cursor-pointer ${scope === "all" ? "bg-popover text-foreground" : "bg-transparent text-muted-foreground"}`}
							aria-pressed={scope === "all"}
							onClick={() => setScope("all")}
						>
							all tracked
						</button>
					</span>
					<label className="inline-flex items-center gap-1.5 normal-case tracking-normal text-secondary-foreground">
						include untracked
						<input
							type="checkbox"
							checked={includeUntracked}
							onChange={toggleUntracked}
						/>
					</label>
				</div>
				<table className="w-full border-collapse">
					<thead>
						<tr>
							<th className="text-left text-muted-foreground text-[9px] uppercase font-medium pb-1.5">
								workspace / worktree · agent
							</th>
							<th className="text-right text-muted-foreground text-[9px] uppercase font-medium pb-1.5 w-16 pl-2.5">
								↑ in
							</th>
							<th className="text-right text-muted-foreground text-[9px] uppercase font-medium pb-1.5 w-16 pl-2.5">
								↓ out
							</th>
							<th className="text-right text-muted-foreground text-[9px] uppercase font-medium pb-1.5 w-16 pl-2.5">
								this week
							</th>
						</tr>
					</thead>
					<tbody>
						{groups.map((g) => (
							<Fragment key={g.workspaceId ?? "untracked"}>
								<tr>
									<td className="text-left pt-2 border-t border-border font-bold text-foreground py-0.5 whitespace-nowrap">
										{g.label}
									</td>
									<td className="text-right pt-2 border-t border-border font-bold text-foreground py-0.5 whitespace-nowrap w-16 pl-2.5">
										{formatTokens(g.subtotal.input)}
									</td>
									<td className="text-right pt-2 border-t border-border text-muted-foreground py-0.5 whitespace-nowrap w-16 pl-2.5">
										{formatTokens(g.subtotal.output)}
									</td>
									<td className="w-16 pl-2.5" />
								</tr>
								{g.rows.map((r, i) => (
									<tr
										key={`${g.workspaceId}-${r.worktreeId}-${r.provider}-${i}`}
									>
										<td className="text-left pl-3.5 text-secondary-foreground py-0.5 whitespace-nowrap">
											{r.worktreeTitle} ·{" "}
											<span
												className={`font-semibold ${r.provider === "claude" ? "text-[var(--provider-claude)]" : "text-[var(--provider-codex)]"}`}
											>
												{r.provider}
											</span>
										</td>
										<td className="text-right py-0.5 whitespace-nowrap w-16 pl-2.5">
											{formatTokens(r.sinceLaunch.input)}
										</td>
										<td className="text-right text-muted-foreground py-0.5 whitespace-nowrap w-16 pl-2.5">
											{formatTokens(r.sinceLaunch.output)}
										</td>
										<td className="text-right text-muted-foreground py-0.5 whitespace-nowrap w-16 pl-2.5">
											{formatTokens(r.thisWeek.billable)}
										</td>
									</tr>
								))}
							</Fragment>
						))}
					</tbody>
				</table>
			</div>

			{/* ── Footer ── */}
			<div className="px-3.5 py-3 bg-background flex items-center justify-between">
				<span className="text-muted-foreground" data-testid="usage-total">
					session ↑
					<span className="text-foreground font-semibold">
						{formatTokens(total.input)}
					</span>{" "}
					↓
					<span className="text-foreground font-semibold">
						{formatTokens(total.output)}
					</span>
					{" · week "}
					<span className="text-foreground font-semibold">
						{formatTokens(weekTotal)}
					</span>
				</span>
				<span className="inline-flex gap-3 items-center">
					<button
						className="bg-transparent border-none text-muted-foreground text-[11px] cursor-pointer"
						aria-label="how to read these numbers"
						aria-expanded={showHelp}
						onClick={() => setShowHelp((v) => !v)}
					>
						ⓘ how to read
					</button>
					<button
						className="bg-transparent border-none text-muted-foreground text-[11px] cursor-pointer"
						aria-label="budget settings"
						onClick={() => setEditingBudget((v) => !v)}
					>
						⚙ budget settings
					</button>
				</span>
			</div>

			{/* ── Help section ── */}
			{showHelp && (
				<div className="px-3.5 py-3 border-b border-border">
					<dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1.5 text-[11px]">
						<dt className="text-foreground font-semibold whitespace-nowrap">
							<span className="text-foreground font-semibold">↑ in</span> /{" "}
							<span className="text-foreground font-semibold">↓ out</span>
						</dt>
						<dd className="m-0 text-secondary-foreground leading-relaxed">
							<b className="text-foreground">in</b> = prompt tokens you send
							(your input + first-time cached context).{" "}
							<b className="text-foreground">out</b> = tokens the agent generates
							in reply. Cache re-reads of context are excluded — they&apos;re
							nearly free.
						</dd>
						<dt className="text-foreground font-semibold whitespace-nowrap">
							session
						</dt>
						<dd className="m-0 text-secondary-foreground leading-relaxed">
							Usage since you launched the app —{" "}
							<b className="text-foreground">resets every restart</b>.
							That&apos;s why the number differs run to run; it&apos;s
							&ldquo;your work this sitting&rdquo;, not all-time.
						</dd>
						<dt className="text-foreground font-semibold whitespace-nowrap">
							this week
						</dt>
						<dd className="m-0 text-secondary-foreground leading-relaxed">
							Rolling total tied to your weekly limit window.
						</dd>
						<dt className="text-foreground font-semibold whitespace-nowrap">
							Active / All tracked
						</dt>
						<dd className="m-0 text-secondary-foreground leading-relaxed">
							<b className="text-foreground">active</b> = worktrees open in the
							app now. <b className="text-foreground">all tracked</b> = every
							worktree with recent activity.
						</dd>
						<dt className="text-foreground font-semibold whitespace-nowrap">
							account limits
						</dt>
						<dd className="m-0 text-secondary-foreground leading-relaxed">
							<span className="font-semibold text-[var(--provider-codex)]">
								codex
							</span>{" "}
							is the real % the provider reports (with reset countdown).{" "}
							<span className="font-semibold text-[var(--provider-claude)]">
								claude
							</span>{" "}
							is an estimate vs your budget (⚙) — the API doesn&apos;t expose
							the real number.
						</dd>
					</dl>
				</div>
			)}

			{/* ── Budget editor ── */}
			{editingBudget && (
				<div className="px-3.5 py-3">
					<BudgetEditor config={snapshot.config} onSave={saveBudgets} />
				</div>
			)}
		</div>
	);
}
