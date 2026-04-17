import type { ElectronApplication } from "@playwright/test";

/**
 * Close the Electron app with a hard-kill fallback.
 * `app.close()` can hang when Monaco or xterm hold the renderer, so we
 * race it against a short timeout and force-kill the process if needed.
 */
export async function closeApp(app: ElectronApplication | undefined): Promise<void> {
	if (!app) return;
	const proc = app.process();
	await Promise.race([
		app.close(),
		new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
	]);
	if (!proc.killed) proc.kill("SIGKILL");
	// Give the OS a moment to release file descriptors and ports before the
	// next Electron instance launches in a subsequent beforeAll.
	await new Promise<void>((resolve) => setTimeout(resolve, 500));
}
