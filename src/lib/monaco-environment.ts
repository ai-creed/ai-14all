import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// The bundled (ESM) monaco-editor — the instance @monaco-editor/loader adopts
// from `window.monaco` — runs its editor/language services in Web Workers and
// requires a worker factory. Without it monaco logs "You must define
// MonacoEnvironment.getWorker" and falls back to running worker code on the
// main thread. That fallback freezes the UI and, critically, lets the async
// go-to-definition query get cancelled mid-flight by main-thread churn, so the
// "Go to Definition" / references / link menu actions silently no-op.
//
// Imported for its side effect at renderer entry (before any editor mounts).
(self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
	getWorker(_workerId: string, label: string): Worker {
		switch (label) {
			case "json":
				return new jsonWorker();
			case "css":
			case "scss":
			case "less":
				return new cssWorker();
			case "html":
			case "handlebars":
			case "razor":
				return new htmlWorker();
			case "typescript":
			case "javascript":
				return new tsWorker();
			default:
				return new editorWorker();
		}
	},
};
