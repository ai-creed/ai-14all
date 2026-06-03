// Side-effect import: install MonacoEnvironment.getWorker before any editor
// mounts. Must precede anything that may load monaco-editor.
import "./lib/monaco-environment.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { installKnownRendererErrorHandler } from "./app/logic/known-renderer-errors.js";
import "./styles/tokens.css";
import "./app/shell.css";

installKnownRendererErrorHandler({ dev: import.meta.env.DEV });

if (import.meta.hot) {
	import.meta.hot.on("vite:beforeFullReload", () => {
		console.warn(
			"[HMR] Full page reload blocked to preserve terminal sessions.",
		);
		throw "[HMR] Blocked";
	});
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
