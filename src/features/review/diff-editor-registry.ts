import type { editor as MonacoEditor } from "monaco-editor";

type Event =
	| { kind: "registered"; filePath: string }
	| { kind: "unregistered"; filePath: string };

export type DiffEditorRegistry = {
	register: (filePath: string, editor: MonacoEditor.IStandaloneDiffEditor) => void;
	unregister: (filePath: string) => void;
	get: (filePath: string) => MonacoEditor.IStandaloneDiffEditor | undefined;
	subscribe: (listener: (event: Event) => void) => () => void;
};

export function createDiffEditorRegistry(): DiffEditorRegistry {
	const map = new Map<string, MonacoEditor.IStandaloneDiffEditor>();
	const listeners = new Set<(e: Event) => void>();
	const emit = (e: Event) => {
		for (const l of [...listeners]) l(e);
	};
	return {
		register(filePath, editor) {
			map.set(filePath, editor);
			emit({ kind: "registered", filePath });
		},
		unregister(filePath) {
			if (map.delete(filePath)) emit({ kind: "unregistered", filePath });
		},
		get(filePath) {
			return map.get(filePath);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
