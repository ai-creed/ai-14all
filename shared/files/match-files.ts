export interface ScoredPath {
	path: string;
	score: number;
}

const SCORE_BASENAME_PREFIX = 4000;
const SCORE_BASENAME_SUBSTRING = 3000;
const SCORE_PATH_SUBSTRING = 2000;
const SCORE_SUBSEQUENCE = 1000;

function scorePath(query: string, path: string): number | null {
	const q = query.toLowerCase();
	const p = path.toLowerCase();
	const slash = p.lastIndexOf("/");
	const basename = slash === -1 ? p : p.slice(slash + 1);

	const basenameIdx = basename.indexOf(q);
	if (basenameIdx === 0) return SCORE_BASENAME_PREFIX - p.length;
	if (basenameIdx > 0) return SCORE_BASENAME_SUBSTRING - p.length;

	if (p.includes(q)) return SCORE_PATH_SUBSTRING - p.length;

	let pi = 0;
	for (const c of q) {
		const next = p.indexOf(c, pi);
		if (next === -1) return null;
		pi = next + 1;
	}
	return SCORE_SUBSEQUENCE - p.length;
}

function compareScored(a: ScoredPath, b: ScoredPath): number {
	if (a.score !== b.score) return b.score - a.score;
	if (a.path.length !== b.path.length) return a.path.length - b.path.length;
	return a.path.localeCompare(b.path);
}

export function matchFiles(
	query: string,
	paths: readonly string[],
): ScoredPath[] {
	const trimmed = query.trim();
	if (trimmed.length === 0) {
		return [...paths]
			.sort((a, b) => a.localeCompare(b))
			.map((path) => ({ path, score: 0 }));
	}
	const scored: ScoredPath[] = [];
	for (const path of paths) {
		const score = scorePath(trimmed, path);
		if (score !== null) scored.push({ path, score });
	}
	scored.sort(compareScored);
	return scored;
}
