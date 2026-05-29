export interface PathReference {
	path: string;
	line?: number;
	column?: number;
	isAbsolute: boolean;
	matchStart: number;
	matchEnd: number;
}

const ABSOLUTE_POSIX = String.raw`(?:\/[\w.\-]+(?:\/[\w.\-]+)*\.[A-Za-z][\w]*)`;
const ABSOLUTE_WIN = String.raw`(?:[A-Za-z]:(?:\\|\/)[\w.\-\\\/]+\.[A-Za-z][\w]*)`;
const RELATIVE = String.raw`(?:(?:\.\.?\/)?[\w.\-]+(?:\/[\w.\-]+)*\.[A-Za-z][\w]*)`;
const PATTERN = new RegExp(
	`(?<![\\w/.])(${ABSOLUTE_POSIX}|${ABSOLUTE_WIN}|${RELATIVE})(?::(\\d+))?(?::(\\d+))?`,
	"g",
);

function isAbsolutePath(p: string): boolean {
	return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

export function findPathReferences(text: string): PathReference[] {
	const out: PathReference[] = [];
	for (const m of text.matchAll(PATTERN)) {
		const [whole, path, line, column] = m;
		const start = m.index ?? 0;
		if (start >= 3 && text.slice(start - 3, start) === "://") continue;
		out.push({
			path,
			line: line ? Number(line) : undefined,
			column: column ? Number(column) : undefined,
			isAbsolute: isAbsolutePath(path),
			matchStart: start,
			matchEnd: start + whole.length,
		});
	}
	return out;
}
