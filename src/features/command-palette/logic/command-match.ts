import type { Command } from "./command";

/** True if `query` appears in `text` as a case-insensitive subsequence. */
export function subsequenceMatch(query: string, text: string): boolean {
	if (query === "") return true;
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	let qi = 0;
	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) qi++;
	}
	return qi === q.length;
}

/**
 * Filter `commands` to those whose title or any keyword subsequence-matches the
 * query. A blank/whitespace query returns the list unchanged. Input order is
 * preserved (the caller sorts).
 */
export function matchCommands(query: string, commands: Command[]): Command[] {
	const trimmed = query.trim();
	if (trimmed === "") return commands;
	return commands.filter(
		(c) =>
			subsequenceMatch(trimmed, c.title) ||
			(c.keywords ?? []).some((k) => subsequenceMatch(trimmed, k)),
	);
}
