import * as monaco from "monaco-editor";
import { codeNavClient } from "../ipc/client.js";
import { encodeCortexUri } from "../nav/cortex-uri.js";
import { getActiveWorktreeRef } from "../nav/active-worktree-ref.js";

const cache = new Map<string, { at: number; result: monaco.languages.Location[] }>();
const TTL_MS = 30_000;

export const definitionProvider: monaco.languages.DefinitionProvider = {
	async provideDefinition(model, position) {
		const word = model.getWordAtPosition(position);
		if (!word) return null;
		const ref = getActiveWorktreeRef();
		if (!ref) return null;

		const callerFile = relativeFromCortexUri(model.uri.toString());
		const key = `${ref.worktreeId}:${(model as { id?: string }).id ?? model.uri.toString()}:${position.lineNumber}:${position.column}`;
		const cached = cache.get(key);
		if (cached && Date.now() - cached.at < TTL_MS) return cached.result;

		const rows = await codeNavClient.findDefinitions(
			{ workspaceId: ref.workspaceId, worktreeId: ref.worktreeId },
			{ name: word.word, callerFile },
		);
		const locs: monaco.languages.Location[] = rows.map((r) => ({
			uri: monaco.Uri.parse(
				encodeCortexUri({
					workspaceId: ref.workspaceId,
					worktreeId: ref.worktreeId,
					file: r.file,
					line: r.line,
				}),
			),
			range: new monaco.Range(r.line, 1, r.line, 1),
		}));
		cache.set(key, { at: Date.now(), result: locs });
		return locs;
	},
};

function relativeFromCortexUri(uri: string): string | undefined {
	if (!uri.startsWith("cortex://nav/")) return undefined;
	const u = new URL(uri);
	const parts = u.pathname.replace(/^\//, "").split("/");
	return parts.slice(2).map(decodeURIComponent).join("/");
}

export function invalidateDefinitionCache(): void {
	cache.clear();
}
