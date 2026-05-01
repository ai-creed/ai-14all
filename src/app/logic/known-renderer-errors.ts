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
	return stack.includes("xterm.js") && stack.includes("Viewport._innerRefresh");
}

export function installKnownRendererErrorHandler({
	dev,
	logger = console,
	target = window,
}: InstallKnownRendererErrorHandlerOptions): () => void {
	const handleError = (event: ErrorEvent) => {
		if (!isKnownXtermViewportDimensionsError(event.error)) return;

		event.preventDefault();
		event.stopImmediatePropagation();

		if (dev) {
			logger.warn(
				"[xterm] Suppressed known viewport dimensions error",
				event.error,
			);
		}
	};

	target.addEventListener("error", handleError, { capture: true });
	return () =>
		target.removeEventListener("error", handleError, { capture: true });
}
