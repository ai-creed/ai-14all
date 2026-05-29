import * as monaco from "monaco-editor";
import { findPathReferences } from "./document-link-parser.js";
import { encodeCortexUri } from "../nav/cortex-uri.js";
import { getActiveWorktreeRef } from "../nav/active-worktree-ref.js";

export const OUTSIDE_WORKTREE_URI = "cortex://outside-worktree";

const fileSetCache = new Map<string, { at: number; files: Set<string> }>();
const TTL_MS = 30_000;

async function loadFileSet(ref: {
	workspaceId: string;
	worktreeId: string;
}): Promise<Set<string>> {
	const k = `${ref.workspaceId}/${ref.worktreeId}`;
	const cached = fileSetCache.get(k);
	if (cached && Date.now() - cached.at < TTL_MS) return cached.files;
	const list: string[] = await window.ai14all.codeNav
		.listFiles(ref)
		.catch(() => []);
	const set = new Set<string>(list);
	fileSetCache.set(k, { at: Date.now(), files: set });
	return set;
}

function isUnderWorktree(absPath: string, worktreeRoot: string | null): boolean {
	if (!worktreeRoot) return false;
	const root = worktreeRoot.endsWith("/") ? worktreeRoot : `${worktreeRoot}/`;
	return absPath === worktreeRoot || absPath.startsWith(root);
}

function relativeToWorktree(absPath: string, worktreeRoot: string): string {
	const root = worktreeRoot.endsWith("/") ? worktreeRoot : `${worktreeRoot}/`;
	return absPath.slice(root.length);
}

function stripLeadingDot(p: string): string {
	return p.replace(/^\.\//, "");
}

export const documentLinkProvider: monaco.languages.LinkProvider = {
	async provideLinks(model) {
		const ref = getActiveWorktreeRef();
		if (!ref) return { links: [] };
		const text = model.getValue();
		const refs = findPathReferences(text);
		if (refs.length === 0) return { links: [] };

		const files = await loadFileSet({
			workspaceId: ref.workspaceId,
			worktreeId: ref.worktreeId,
		});
		const links: monaco.languages.ILink[] = [];
		for (const r of refs) {
			const startPos = model.getPositionAt(r.matchStart);
			const endPos = model.getPositionAt(r.matchEnd);
			const range = new monaco.Range(
				startPos.lineNumber,
				startPos.column,
				endPos.lineNumber,
				endPos.column,
			);

			if (r.isAbsolute) {
				if (isUnderWorktree(r.path, ref.worktreeRoot)) {
					const rel = relativeToWorktree(r.path, ref.worktreeRoot!);
					if (files.has(rel)) {
						links.push({
							range,
							url: encodeCortexUri({
								workspaceId: ref.workspaceId,
								worktreeId: ref.worktreeId,
								file: rel,
								line: r.line ?? 1,
								column: r.column,
							}),
						});
					}
				} else {
					links.push({ range, url: OUTSIDE_WORKTREE_URI });
				}
				continue;
			}

			const rel = stripLeadingDot(r.path);
			if (files.has(rel)) {
				links.push({
					range,
					url: encodeCortexUri({
						workspaceId: ref.workspaceId,
						worktreeId: ref.worktreeId,
						file: rel,
						line: r.line ?? 1,
						column: r.column,
					}),
				});
			}
		}
		return { links };
	},
};
