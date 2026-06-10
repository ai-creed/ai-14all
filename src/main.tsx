import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { UiGallery } from "./app/UiGallery.js";
import { installKnownRendererErrorHandler } from "./app/logic/known-renderer-errors.js";
import "./styles/tokens.css";
import "./app/shell.css";
import "./styles/tui.css";

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
	<StrictMode>{showGallery ? <UiGallery /> : <App />}</StrictMode>,
);
