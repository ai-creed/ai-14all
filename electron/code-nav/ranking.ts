export interface DefinitionRow {
	id: number;
	qualified_name: string;
	bare_name: string;
	file: string;
	line: number;
	exported: number;
	is_default: number;
	is_declaration_only: number;
}

export interface RankInput {
	query: string;
	callerFile?: string;
	importedFiles: Set<string>;
}

function dirname(p: string): string {
	const i = p.lastIndexOf("/");
	return i < 0 ? "" : p.slice(0, i);
}

function tier(row: DefinitionRow, q: RankInput): number {
	if (row.qualified_name === q.query) return 0;
	if (q.importedFiles.has(row.file)) return 1;
	if (q.callerFile && dirname(row.file) === dirname(q.callerFile)) return 2;
	return 3;
}

export function rankDefinitions(
	rows: DefinitionRow[],
	q: RankInput,
): DefinitionRow[] {
	return [...rows].sort((a, b) => {
		const ta = tier(a, q);
		const tb = tier(b, q);
		if (ta !== tb) return ta - tb;
		if (a.is_declaration_only !== b.is_declaration_only)
			return a.is_declaration_only - b.is_declaration_only;
		return a.file.localeCompare(b.file);
	});
}
