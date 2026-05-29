import * as monaco from "monaco-editor";
import { codeNavClient } from "../ipc/client.js";
import { encodeCortexUri } from "../nav/cortex-uri.js";
import { getActiveWorktreeRef } from "../nav/active-worktree-ref.js";

function relativeFromUri(uri: string): string | undefined {
	if (!uri.startsWith("cortex://nav/")) return undefined;
	const u = new URL(uri);
	return u.pathname
		.replace(/^\//, "")
		.split("/")
		.slice(2)
		.map(decodeURIComponent)
		.join("/");
}

export const referenceProvider: monaco.languages.ReferenceProvider = {
	async provideReferences(model, position) {
		const word = model.getWordAtPosition(position);
		if (!word) return [];
		const ref = getActiveWorktreeRef();
		if (!ref) return [];

		const callerFile = relativeFromUri(model.uri.toString());
		const defs = await codeNavClient.findDefinitions(
			{ workspaceId: ref.workspaceId, worktreeId: ref.worktreeId },
			{ name: word.word, callerFile },
		);
		const here = defs.find(
			(d) => d.file === callerFile && d.line === position.lineNumber,
		);
		if (!here) return [];
		const callers = await codeNavClient.findCallers(
			{ workspaceId: ref.workspaceId, worktreeId: ref.worktreeId },
			{ fnId: here.id },
		);
		return callers.map((c) => ({
			uri: monaco.Uri.parse(
				encodeCortexUri({
					workspaceId: ref.workspaceId,
					worktreeId: ref.worktreeId,
					file: c.file,
					line: c.line,
				}),
			),
			range: new monaco.Range(c.line, 1, c.line, 1),
		}));
	},
};
