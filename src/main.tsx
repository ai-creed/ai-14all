// Side-effect import: install MonacoEnvironment.getWorker before any editor
// mounts. Must precede anything that may load monaco-editor.
import "./lib/monaco-environment.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { UiGallery } from "./app/UiGallery.js";
import { CommandRegistryProvider } from "./features/command-palette/components/CommandRegistryProvider.js";
import { installKnownRendererErrorHandler } from "./app/logic/known-renderer-errors.js";
// Self-hosted reading font for markdown document bodies (spec D18):
// registers the "Hanken Grotesk Variable" font-face; consumed via
// --font-reading in base.css. No network fetch — works packaged.
import "@fontsource-variable/hanken-grotesk/index.css";
// All app CSS flows through the single cascade authority. Do NOT add other
// CSS imports here — see src/styles/index.css and docs/shared/styling-architecture.md.
import "./styles/index.css";

installKnownRendererErrorHandler({ dev: import.meta.env.DEV });

/* Primitive gallery for theme review (docs/tui-css-spec.md §10.2). Hash-gated
 * (not DEV-gated) so the Playwright screenshot run can reach it in a
 * production build; inert unless explicitly navigated to. */
const showGallery = window.location.hash.startsWith("#/ui-gallery");

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
		{showGallery ? (
			<UiGallery />
		) : (
			<CommandRegistryProvider>
				<App />
			</CommandRegistryProvider>
		)}
	</StrictMode>,
);
