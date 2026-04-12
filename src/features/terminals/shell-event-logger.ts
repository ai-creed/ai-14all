import { diagnostics } from "../../lib/desktop-client.js";

let rendererSeq = 0;

export function logRendererShellEvent(
	event: Omit<Parameters<typeof diagnostics.logShellEvent>[0], "source" | "rendererAt" | "rendererSeq">,
) {
	return diagnostics.logShellEvent({
		source: "renderer",
		rendererAt: new Date().toISOString(),
		rendererSeq: ++rendererSeq,
		...event,
	});
}
