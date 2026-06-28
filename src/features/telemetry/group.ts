import type { TokenTotals, UsageRow } from "../../../shared/models/usage.js";

export interface WorkspaceGroup {
	workspaceId: string | null;
	label: string;
	rows: UsageRow[];
	subtotal: TokenTotals;
}

export function groupByWorkspace(rows: UsageRow[]): WorkspaceGroup[] {
	const map = new Map<string, WorkspaceGroup>();
	for (const r of rows) {
		const key = r.workspaceId ?? " untracked";
		let g = map.get(key);
		if (!g) {
			g = {
				workspaceId: r.workspaceId,
				label: r.workspaceId === null ? "other (untracked)" : r.worktreeTitle,
				rows: [],
				subtotal: { input: 0, output: 0, billable: 0, raw: 0 },
			};
			map.set(key, g);
		}
		g.rows.push(r);
		g.subtotal = {
			input: g.subtotal.input + r.tokens.input,
			output: g.subtotal.output + r.tokens.output,
			billable: g.subtotal.billable + r.tokens.billable,
			raw: g.subtotal.raw + r.tokens.raw,
		};
	}
	const groups = [...map.values()];
	groups.sort((a, b) =>
		a.workspaceId === null ? 1 : b.workspaceId === null ? -1 : 0,
	);
	return groups;
}
