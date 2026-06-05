type RendererErrorLogger = Pick<Console, "warn">;

type InstallKnownRendererErrorHandlerOptions = {
	dev: boolean;
	logger?: RendererErrorLogger;
	target?: Window;
};

const XTERM_DIMENSIONS_MESSAGE =
	"Cannot read properties of undefined (reading 'dimensions')";

export function isKnownXtermViewportDimensionsError(error: unknown): boolean {
	if (!(error instanceof TypeError)) return false;
	if (error.message !== XTERM_DIMENSIONS_MESSAGE) return false;

	const stack = error.stack ?? "";
	return stack.includes("xterm.js");
}

const MONACO_MODEL_NOT_FOUND_MESSAGE = "Model not found";

/**
 * Standalone Monaco's Peek Definition / Peek References widgets try to
 * materialize a text model for each result so they can render the inline
 * preview. Our code-nav locations are virtual `cortex://` resources with no
 * backing model, and `StandaloneTextModelService.createModelReference` has no
 * content-provider hook (unlike full VS Code), so it throws "Model not found".
 *
 * Go to Definition (F12 / cmd+click) is unaffected — it routes through
 * `monaco.editor.registerEditorOpener` → our NavRouter, never through peek's
 * model resolution. Suppress this specific peek failure so it does not surface
 * as an uncaught error while the find-references / peek preview UX is built out.
 * Matched narrowly (exact message + the `createModelReference` throw site) so it
 * never masks an unrelated "Model not found".
 */
export function isKnownMonacoPeekModelError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	if (error.message !== MONACO_MODEL_NOT_FOUND_MESSAGE) return false;

	const stack = error.stack ?? "";
	return stack.includes("createModelReference");
}

const MONACO_CANCELED_NAME = "Canceled";

/**
 * Monaco rejects in-flight debounced work (its `Delayer`) with a
 * `CancellationError` when it disposes that work mid-flight — e.g. tearing down
 * the goto-definition hover contribution right after a cmd+click jump resolves.
 * Those rejections have no `.catch` on Monaco's internal path, so they surface
 * as "Uncaught (in promise) Canceled". Navigation is unaffected; this is purely
 * cosmetic console noise.
 *
 * Matched exactly as Monaco's own `isCancellationError` does (an `Error` whose
 * `name` AND `message` are both "Canceled") so a genuine error that merely
 * mentions "Canceled" in its message is never swallowed.
 */
export function isKnownMonacoCancellation(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.name === MONACO_CANCELED_NAME &&
		error.message === MONACO_CANCELED_NAME
	);
}

export function installKnownRendererErrorHandler({
	dev,
	logger = console,
	target = window,
}: InstallKnownRendererErrorHandlerOptions): () => void {
	const messageFor = (error: unknown): string | null => {
		if (isKnownXtermViewportDimensionsError(error))
			return "[xterm] Suppressed known viewport dimensions error";
		if (isKnownMonacoPeekModelError(error))
			return "[code-nav] Suppressed Monaco peek 'Model not found' (peek preview UX is WIP)";
		if (isKnownMonacoCancellation(error))
			return "[monaco] Suppressed benign cancellation (Delayer disposed mid-flight)";
		return null;
	};

	const handleError = (event: ErrorEvent) => {
		const message = messageFor(event.error);
		if (!message) return;

		event.preventDefault();
		event.stopImmediatePropagation();

		if (dev) logger.warn(message, event.error);
	};

	// Monaco's peek model resolution and its debounced Delayers run in cancelable
	// promises, so a known failure can surface as an unhandled rejection rather
	// than an error event. Same suppression set as handleError, via messageFor.
	const handleRejection = (event: PromiseRejectionEvent) => {
		const message = messageFor(event.reason);
		if (!message) return;

		event.preventDefault();
		event.stopImmediatePropagation();

		if (dev) logger.warn(message, event.reason);
	};

	target.addEventListener("error", handleError, { capture: true });
	target.addEventListener("unhandledrejection", handleRejection, {
		capture: true,
	});
	return () => {
		target.removeEventListener("error", handleError, { capture: true });
		target.removeEventListener("unhandledrejection", handleRejection, {
			capture: true,
		});
	};
}
