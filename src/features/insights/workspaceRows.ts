// Workspace table view-model for the insights dashboard (spec §4.8). This is
// the seam where the worker's raw usage rows / run groups meet the renderer:
// buildRangeResult (services/usage/range.ts) supplies `usageRows`,
// groupRunsByRepo (runStatus.ts) supplies `runGroups`, and this module folds
// both onto a caller-supplied WorkspaceIndex into one table row per
// workspace + a permanent "untracked" row.
//
// Seed-first, fold-second (§4.8): every WorkspaceIndexEntry AND the untracked
// bucket get a zero row unconditionally, before any usage/run data is folded
// in. An implementation that only creates rows for workspaces with present
// data is non-conformant — idle workspaces must still render as zero rows.
//
// No `includeUntracked` config input (decision 14): the untracked row is
// always seeded and always folded into; filtering it is a renderer concern,
// not this view-model's.

import type { UsageRow } from "../../../shared/models/usage.js";
import { emptyRunCounts, type RunOutcomeCounts } from "./runStatus.js";

export interface WorkspaceIndexEntry {
	workspaceId: string;
	title: string;
	repoId: string | null;
	rootPath: string;
	worktreeCount: number;
}
export type WorkspaceIndex = WorkspaceIndexEntry[];

export interface WorkspaceRowVM {
	key: string;
	name: string;
	detail: string;
	runs: RunOutcomeCounts;
	mix: Array<{ provider: string; tokens: number }>;
	tokens: number;
	costUsd: number | null;
}

export const UNTRACKED_KEY = "untracked";

interface RowBuild extends WorkspaceRowVM {
	mixMap: Map<string, number>;
}

export function buildWorkspaceRows(
	usageRows: UsageRow[],
	runGroups: Map<string | null, RunOutcomeCounts>,
	workspaces: WorkspaceIndex,
): {
	rows: WorkspaceRowVM[];
	totals: Pick<WorkspaceRowVM, "runs" | "tokens" | "costUsd">;
} {
	const rows = new Map<string, RowBuild>();
	const seed = (key: string, name: string, detail: string) =>
		rows.set(key, {
			key,
			name,
			detail,
			runs: emptyRunCounts(),
			mix: [],
			mixMap: new Map(),
			tokens: 0,
			costUsd: null,
		});

	// Seed rows first, fold data second (§4.8): zero rows render
	// unconditionally, whether or not usage/run data ever touches them.
	for (const ws of workspaces)
		seed(
			ws.workspaceId,
			ws.title,
			`${ws.rootPath} · ${ws.worktreeCount} worktree${ws.worktreeCount === 1 ? "" : "s"}`,
		);
	seed(UNTRACKED_KEY, "untracked", "outside managed workspaces");

	for (const r of usageRows) {
		const key = r.workspaceId ?? UNTRACKED_KEY;
		if (!rows.has(key)) seed(key, r.worktreeTitle, r.worktreePath ?? ""); // ghost workspace: own row, never merged into untracked
		const row = rows.get(key)!;
		row.tokens += r.tokens.billable;
		row.mixMap.set(
			r.provider,
			(row.mixMap.get(r.provider) ?? 0) + r.tokens.billable,
		);
		if (r.costUsd !== null) row.costUsd = (row.costUsd ?? 0) + r.costUsd;
	}

	const byRepo = new Map(
		workspaces.filter((w) => w.repoId).map((w) => [w.repoId!, w.workspaceId]),
	);
	for (const [repoId, counts] of runGroups) {
		const key = (repoId !== null && byRepo.get(repoId)) || UNTRACKED_KEY; // null + unmatched repoId -> untracked
		const row = rows.get(key)!;
		for (const k of Object.keys(counts) as (keyof RunOutcomeCounts)[])
			row.runs[k] += counts[k];
	}

	const list: WorkspaceRowVM[] = [...rows.values()].map((r) => {
		const { mixMap, ...rest } = r;
		return {
			...rest,
			mix: [...mixMap.entries()]
				.map(([provider, tokens]) => ({ provider, tokens }))
				.sort((a, b) => b.tokens - a.tokens),
		};
	});

	list.sort(
		(a, b) =>
			b.tokens - a.tokens ||
			(a.key === UNTRACKED_KEY
				? 1
				: b.key === UNTRACKED_KEY
					? -1
					: a.name.localeCompare(b.name)),
	);

	const totals = list.reduce(
		(t, r) => ({
			runs: Object.fromEntries(
				(Object.keys(t.runs) as (keyof RunOutcomeCounts)[]).map((k) => [
					k,
					t.runs[k] + r.runs[k],
				]),
			) as RunOutcomeCounts,
			tokens: t.tokens + r.tokens,
			costUsd: r.costUsd === null ? t.costUsd : (t.costUsd ?? 0) + r.costUsd,
		}),
		{ runs: emptyRunCounts(), tokens: 0, costUsd: null as number | null },
	);

	return { rows: list, totals };
}
