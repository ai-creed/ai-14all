import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export type SkillAsset = { content: string };

const SKILL_ID = "ai-14all-fix-review";
const SKILL_FILENAME = "SKILL.md";

// Tried in order. The canonical layout (electron-builder copies
// `assets/agent-skills/**/*` into `Resources/assets/agent-skills/...`) is
// first; the legacy unprefixed path is kept as a cheap fallback so the
// installer keeps working if the build config is ever flattened.
const CANDIDATE_PREFIXES: ReadonlyArray<readonly string[]> = [
	["assets", "agent-skills"],
	["agent-skills"],
];

const RECURSIVE_SEARCH_MAX_DEPTH = 4;
const RECURSIVE_SEARCH_SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"app.asar",
	"app.asar.unpacked",
]);

/**
 * Locate and read the bundled review-fix skill. Tries the canonical packaged
 * layout first, then a legacy fallback, then a bounded recursive search of
 * `appResourcesPath` so a packaging tweak (e.g. flattening the assets dir)
 * doesn't silently break installation.
 */
export async function loadBundledSkill(
	appResourcesPath: string,
): Promise<SkillAsset> {
	for (const prefix of CANDIDATE_PREFIXES) {
		const path = join(appResourcesPath, ...prefix, SKILL_ID, SKILL_FILENAME);
		const content = await tryReadFile(path);
		if (content !== null) return { content };
	}

	const found = await findSkillFile(
		appResourcesPath,
		SKILL_ID,
		SKILL_FILENAME,
		RECURSIVE_SEARCH_MAX_DEPTH,
	);
	if (found) {
		const content = await tryReadFile(found);
		if (content !== null) return { content };
	}

	const triedList = CANDIDATE_PREFIXES.map((p) =>
		[...p, SKILL_ID, SKILL_FILENAME].join("/"),
	).join(", ");
	throw new Error(
		`Bundled skill "${SKILL_ID}" not found under ${appResourcesPath}. Looked for: ${triedList} and recursively up to depth ${RECURSIVE_SEARCH_MAX_DEPTH}.`,
	);
}

async function tryReadFile(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf-8");
	} catch (err) {
		if (isEnoent(err)) return null;
		throw err;
	}
}

function isEnoent(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		(err as { code?: string }).code === "ENOENT"
	);
}

async function findSkillFile(
	root: string,
	skillId: string,
	skillFilename: string,
	maxDepth: number,
): Promise<string | null> {
	type Frame = { path: string; depth: number };
	const stack: Frame[] = [{ path: root, depth: 0 }];

	while (stack.length > 0) {
		const { path, depth } = stack.pop()!;
		let entries;
		try {
			entries = await readdir(path, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (RECURSIVE_SEARCH_SKIP_DIRS.has(entry.name)) continue;
			if (entry.name === skillId) {
				const candidate = join(path, entry.name, skillFilename);
				try {
					await readFile(candidate);
					return candidate;
				} catch {
					// keep searching
				}
			}
			if (depth + 1 <= maxDepth) {
				stack.push({ path: join(path, entry.name), depth: depth + 1 });
			}
		}
	}
	return null;
}
