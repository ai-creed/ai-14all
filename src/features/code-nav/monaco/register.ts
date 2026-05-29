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

const LANGS = ["typescript", "javascript", "python", "c", "cpp"];

const history = new NavHistory({ capacity: 50 });
export let navRouter: NavRouter | null = null;
export let toastFn: ((msg: string) => void) | null = null;

export function registerCodeNavProviders(deps: {
	dispatch: (action: unknown) => void;
	toast: (msg: string) => void;
	getActive: () => ActiveContext | null;
}): () => void {
	toastFn = deps.toast;
	navRouter = new NavRouter({
		history,
		dispatch: deps.dispatch,
		toast: deps.toast,
		getActive: deps.getActive,
	});
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
	const unsub = subscribeWorktreeIndexRefreshed(() => invalidateDefinitionCache());
	return () => {
		for (const d of disposers) d.dispose();
		unsub();
		navRouter = null;
		toastFn = null;
	};
}

export { history as codeNavHistory };
