export function countOpenCommentsInFiles(
	filePaths: string[],
	openCountsByFile: Record<string, number>,
): number {
	let total = 0;
	for (const f of filePaths) total += openCountsByFile[f] ?? 0;
	return total;
}
