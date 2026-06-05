import * as monaco from "monaco-editor";
import {
	definitionProvider,
	invalidateDefinitionCache,
} from "./definition-provider.js";
import {
	documentLinkProvider,
	OUTSIDE_WORKTREE_URI,
} from "./document-link-provider.js";
import { NavHistory } from "../nav/nav-history.js";
import { NavRouter, type ActiveContext } from "../nav/nav-router.js";
import { subscribeWorktreeIndexRefreshed } from "../ipc/events.js";
import {
	getCodeNavToast,
	getModelProvisioner,
	getNavRouter,
	setCodeNavToast,
	setModelProvisioner,
	setNavRouter,
} from "../nav/router-singleton.js";
import { files } from "../../../lib/desktop-client.js";
import { languageForBasename } from "../../viewer/logic/language-for-basename.js";
import { ModelProvisioner, type ReadResult } from "./model-provisioner.js";
import { handleNavResource } from "./handle-nav-resource.js";
import { toFileUri } from "../nav/nav-file-uri.js";
import { getActiveWorktreeRef } from "../nav/active-worktree-ref.js";

type MonacoModule = typeof monaco;

const LANGS = ["typescript", "javascript", "python", "c", "cpp"];

const history = new NavHistory({ capacity: 50 });
export let navRouter: NavRouter | null = null;
export let toastFn: ((msg: string) => void) | null = null;

// Make our bundled monaco the singleton @monaco-editor/react's loader prefers.
// Registration no longer depends on this (we register on the exact monaco
// instance handed to onMount), but keeping the bridge avoids a redundant CDN
// monaco being fetched.
if (typeof window !== "undefined") {
	(window as unknown as { monaco?: MonacoModule }).monaco = monaco;
}

// One entry per monaco module instance we've registered on, so re-mounts and
// the diff/inline editors sharing a singleton don't double-register.
const registeredMonaco = new WeakSet<object>();

/**
 * Register code-nav providers AND the cortex:// editor/link openers on the
 * exact monaco module the editor uses — the instance passed to
 * `@monaco-editor/react`'s `onMount(editor, monaco)`.
 *
 * This is the root-cause fix for the dead "Go to Definition" / cmd+click /
 * diff-link gestures: Monaco routes "open a resource other than the current
 * model" through `StandaloneServices.get(ICodeEditorService)` (and links
 * through `IOpenerService`). `monaco.editor.registerEditorOpener` /
 * `registerLinkOpener` register on those very singletons, so the gotoDefinition
 * and openLink actions actually invoke our handler — unlike the old approach of
 * monkey-patching a per-editor `_codeEditorService`, which the actions never
 * consulted. Idempotent per monaco instance.
 *
 * See docs/superpowers/specs/2026-05-30-native-monaco-nav-design.md.
 */
export function ensureCortexNavRegistered(m: MonacoModule): void {
	if (typeof window === "undefined") return;
	if (!m?.languages || !m.editor) return;
	if (registeredMonaco.has(m as unknown as object)) return;
	registeredMonaco.add(m as unknown as object);

	for (const lang of LANGS) {
		m.languages.registerDefinitionProvider(lang, definitionProvider);
		// Find-references / peek-references is intentionally NOT registered yet.
		// Standalone Monaco's references peek can't materialize a text-model
		// preview for our virtual cortex:// locations and crashes/renders the
		// opaque URI as the filename. Re-enable together with the peek-preview
		// model resolution (see mem-2026-06-05 peek deferral; reference-provider.ts
		// is kept for that work).
	}
	m.languages.registerLinkProvider("*", documentLinkProvider);

	const navDeps = {
		getRouter: getNavRouter,
		getActiveRef: getActiveWorktreeRef,
		getToast: getCodeNavToast,
		outsideWorktreeUri: OUTSIDE_WORKTREE_URI,
	};
	// "Go to Definition" / cmd+click / Peek selection → ICodeEditorService open.
	// Monaco passes the target selection as the 3rd arg; we use it for line/col.
	m.editor.registerEditorOpener({
		openCodeEditor: (_source, resource, selection) =>
			handleNavResource(
				resource.toString(),
				selection ?? undefined,
				"definition",
				navDeps,
			),
	});
	// Diff/document link click → IOpenerService.
	m.editor.registerLinkOpener({
		open: (resource) =>
			handleNavResource(resource.toString(), undefined, "link", navDeps),
	});

	// This is a read-only code viewer with its own (ai-cortex) navigation, not a
	// TypeScript IDE. The bundled TS worker can't resolve the viewed code's
	// modules (node:fs, third-party deps, path aliases), so its semantic
	// diagnostics are pure noise — e.g. "Cannot find module 'node:fs'". Turn off
	// semantic + suggestion validation; keep syntax validation for genuine parse
	// errors.
	// `monaco.languages.typescript` is typed as a deprecated stub, but the full
	// bundled monaco populates it at runtime (it's the very service emitting
	// these diagnostics), so reach it through a cast.
	type ModeConfig = Record<string, boolean | undefined> & {
		definitions?: boolean;
		references?: boolean;
	};
	type TsDefaults = {
		setDiagnosticsOptions(o: {
			noSemanticValidation?: boolean;
			noSyntaxValidation?: boolean;
			noSuggestionDiagnostics?: boolean;
		}): void;
		modeConfiguration: ModeConfig;
		setModeConfiguration(config: ModeConfig): void;
	};
	const ts = (
		m.languages as unknown as {
			typescript?: {
				typescriptDefaults: TsDefaults;
				javascriptDefaults: TsDefaults;
			};
		}
	).typescript;
	if (ts) {
		const diag = {
			noSemanticValidation: true,
			noSyntaxValidation: false,
			noSuggestionDiagnostics: true,
		};
		ts.typescriptDefaults.setDiagnosticsOptions(diag);
		ts.javascriptDefaults.setDiagnosticsOptions(diag);

		// Code navigation is powered solely by ai-cortex. Monaco's bundled TS/JS
		// language service ALSO answers Go to Definition / Find References (e.g.
		// it resolves an imported symbol to its import statement). That extra
		// result makes Monaco open its multi-result *peek* widget — which can't
		// materialize a text model for our virtual cortex:// locations and
		// crashes with "Model not found" (rendering the opaque URI as the file
		// name). Disable the built-in definitions + references providers so our
		// cortex provider is the sole source and Go to Definition stays a clean
		// single-result jump. (References peek is deferred; see mem-2026-06-05.)
		const navOnly = (d: TsDefaults): void =>
			d.setModeConfiguration({
				...d.modeConfiguration,
				definitions: false,
				references: false,
			});
		navOnly(ts.typescriptDefaults);
		navOnly(ts.javascriptDefaults);
	}
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
	const provisioner = new ModelProvisioner(
		{
			has: (k) => monaco.editor.getModel(monaco.Uri.parse(k)) !== null,
			create: (content, language, k) => {
				monaco.editor.createModel(content, language, monaco.Uri.parse(k));
			},
			dispose: (k) => {
				monaco.editor.getModel(monaco.Uri.parse(k))?.dispose();
			},
		},
		toFileUri,
		async (ref, relFile): Promise<ReadResult> => {
			try {
				const r = await files.read(ref.workspaceId, ref.worktreeId, relFile);
				if (r.ok) return { kind: "text", content: r.view.content };
				return { kind: r.reason.kind === "binary" ? "binary" : "error" };
			} catch {
				return { kind: "error" };
			}
		},
		languageForBasename,
	);
	setModelProvisioner(provisioner);
	// E2E hook: expose the live NavRouter + dispatch so Playwright can drive
	// nav-back / nav-forward (no keybinding wire-up in MVP) and seed reducer
	// state for the diff-link test. Harmless in prod.
	if (typeof window !== "undefined") {
		const w = window as unknown as {
			__codeNavTestRouter?: NavRouter | null;
			__codeNavTestDispatch?: (action: unknown) => void;
		};
		w.__codeNavTestRouter = navRouter;
		w.__codeNavTestDispatch = deps.dispatch;
	}
	const unsub = subscribeWorktreeIndexRefreshed(() => {
		invalidateDefinitionCache();
		getModelProvisioner()?.disposeAll();
	});
	return () => {
		unsub();
		getModelProvisioner()?.disposeAll();
		setModelProvisioner(null);
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
