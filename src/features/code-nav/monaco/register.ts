import * as monaco from "monaco-editor";
import {
	definitionProvider,
	invalidateDefinitionCache,
} from "./definition-provider.js";
import { referenceProvider } from "./reference-provider.js";
import { documentLinkProvider } from "./document-link-provider.js";
import { NavHistory } from "../nav/nav-history.js";
import { NavRouter, type ActiveContext } from "../nav/nav-router.js";
import { subscribeWorktreeIndexRefreshed } from "../ipc/events.js";
import {
	setCodeNavToast,
	setNavRouter,
} from "../nav/router-singleton.js";

const LANGS = ["typescript", "javascript", "python", "c", "cpp"];

const history = new NavHistory({ capacity: 50 });
export let navRouter: NavRouter | null = null;
export let toastFn: ((msg: string) => void) | null = null;

// Make our bundled monaco the singleton @monaco-editor/react's loader picks
// up (it checks `window.monaco` before falling back to CDN). Without this,
// the loader fetches a separate monaco from the network, and our
// DefinitionProvider / DocumentLinkProvider registrations land on a
// different singleton than the editor's — so cmd+click and link-click
// silently invoke nothing. Setting it here (at module evaluation time of
// the lazy code-nav chunk) runs before any <Editor> mount, since this
// chunk is imported during the App-mount effect and the InlineEditor only
// mounts on file select.
// See docs/superpowers/specs/2026-05-29-code-nav-mvp-design.md §312-323.
if (typeof window !== "undefined") {
	(window as unknown as { monaco?: typeof monaco }).monaco = monaco;
}

export function registerCodeNavProviders(deps: {
	dispatch: (action: unknown) => void;
	toast: (msg: string) => void;
	getActive: () => ActiveContext | null;
}): () => void {
	toastFn = deps.toast;
	setCodeNavToast(deps.toast);
	navRouter = new NavRouter({
		history,
		dispatch: deps.dispatch,
		toast: deps.toast,
		getActive: deps.getActive,
	});
	setNavRouter(navRouter);
	// E2E hook: expose the live NavRouter + dispatch so Playwright can drive
	// nav-back / nav-forward (no keybinding wire-up in MVP) and seed reducer
	// state for the diff-link test (selectChangedFile). Harmless in prod.
	if (typeof window !== "undefined") {
		const w = window as unknown as {
			__codeNavTestRouter?: NavRouter | null;
			__codeNavTestDispatch?: (action: unknown) => void;
		};
		w.__codeNavTestRouter = navRouter;
		w.__codeNavTestDispatch = deps.dispatch;
	}
	const disposers: Array<{ dispose(): void }> = [];
	for (const lang of LANGS) {
		disposers.push(
			monaco.languages.registerDefinitionProvider(lang, definitionProvider),
		);
		disposers.push(
			monaco.languages.registerReferenceProvider(lang, referenceProvider),
		);
	}
	disposers.push(
		monaco.languages.registerLinkProvider("*", documentLinkProvider),
	);
	registeredLanguagesSingletons.add(
		monaco.languages as unknown as object,
	);
	// ALSO register against the editor's live singleton if @monaco-editor/react
	// resolved a different monaco than the one our chunk imported. Verified
	// by the spec-§419 e2e diagnostic: registering through `window.monaco`
	// from inside the page lands on the singleton the gotoDefinition action
	// queries, while our import-side registration above doesn't.
	ensureCodeNavProvidersRegisteredForEditor();
	const unsub = subscribeWorktreeIndexRefreshed(() => invalidateDefinitionCache());
	return () => {
		for (const d of disposers) d.dispose();
		unsub();
		navRouter = null;
		toastFn = null;
		setNavRouter(null);
		setCodeNavToast(null);
		if (typeof window !== "undefined") {
			const w = window as unknown as {
				__codeNavTestRouter?: unknown;
				__codeNavTestDispatch?: unknown;
			};
			delete w.__codeNavTestRouter;
			delete w.__codeNavTestDispatch;
		}
	};
}

export { history as codeNavHistory };

// One entry per unique `monaco.languages` reference we've registered on, so
// we don't double-register. Covers both our import-time singleton and the
// editor's runtime singleton when they differ.
const registeredLanguagesSingletons = new WeakSet<object>();

/**
 * Per-editor mount hook. Closes the race where @monaco-editor/react's loader
 * resolves a different monaco-editor module instance than our lazy chunk
 * imported (CDN fallback if our `window.monaco` assignment hadn't run yet).
 * If `window.monaco.languages` is a fresh reference we haven't seen, register
 * the providers there too so the gotoDefinition / openLink actions find them.
 * Idempotent.
 */
export function ensureCodeNavProvidersRegisteredForEditor(): void {
	if (typeof window === "undefined") return;
	const w = window as unknown as {
		monaco?: { languages: typeof monaco.languages };
	};
	const langs = w.monaco?.languages;
	if (!langs) return;
	if (registeredLanguagesSingletons.has(langs as unknown as object)) return;
	registeredLanguagesSingletons.add(langs as unknown as object);
	for (const lang of LANGS) {
		langs.registerDefinitionProvider(lang, definitionProvider);
		langs.registerReferenceProvider(lang, referenceProvider);
	}
	langs.registerLinkProvider("*", documentLinkProvider);
}
