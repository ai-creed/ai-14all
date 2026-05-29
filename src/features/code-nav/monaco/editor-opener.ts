import type * as monaco from "monaco-editor";
import { decodeCortexUri } from "../nav/cortex-uri.js";
import { navRouter, toastFn } from "./register.js";
import { OUTSIDE_WORKTREE_URI } from "./document-link-provider.js";

export function installCortexOpener(
	editor: monaco.editor.IStandaloneCodeEditor,
): () => void {
	const svc = (editor as unknown as { _codeEditorService?: { openCodeEditor?: Function } })
		._codeEditorService;
	if (!svc?.openCodeEditor) return () => {};
	const original = svc.openCodeEditor.bind(svc);
	svc.openCodeEditor = async (
		input: { resource?: { toString(): string } },
		source: unknown,
		sideBySide: boolean,
	) => {
		const uri = input?.resource?.toString() ?? "";
		if (uri === OUTSIDE_WORKTREE_URI) {
			toastFn?.("Path outside this worktree");
			return null;
		}
		const loc = decodeCortexUri(uri);
		if (loc) {
			await navRouter?.navigate({ ...loc, source: "definition" });
			return null;
		}
		return original(input, source, sideBySide);
	};
	return () => {
		svc.openCodeEditor = original;
	};
}
