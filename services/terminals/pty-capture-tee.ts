import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Dev-only capture gate (reflow child spec §2). Pure so the production
 * invariant is unit-testable: capture is possible ONLY when
 * AI14ALL_PTY_CAPTURE_DIR is non-empty AND the app is not packaged. The
 * Electron main composition root calls this; TerminalService never reads
 * process.env itself.
 */
export function resolvePtyCaptureDir(opts: {
	env: Record<string, string | undefined>;
	isPackaged: boolean;
}): string | undefined {
	const dir = opts.env.AI14ALL_PTY_CAPTURE_DIR;
	if (!dir || opts.isPackaged) return undefined;
	return dir;
}

/**
 * Per-session raw-byte tee. Appends are serialized through a promise chain
 * so on-disk order always equals arrival order even while an earlier write
 * is pending. `push` is synchronous and never throws: the terminal data
 * path (mirror write, OutputBatcher enqueue) must never block on capture.
 * The first fs error disables the tee for the session and logs once.
 */
export class PtyCaptureTee {
	private chain: Promise<void> = Promise.resolve();
	private disabled = false;
	private dirReady = false;
	private readonly filePath: string;

	constructor(
		private readonly dir: string,
		sessionId: string,
		private readonly logError: (message: string) => void = (message) =>
			console.error(message),
	) {
		this.filePath = path.join(dir, `${sessionId}.bytes`);
	}

	push(chunk: string): void {
		if (this.disabled) return;
		this.chain = this.chain.then(async () => {
			if (this.disabled) return;
			try {
				if (!this.dirReady) {
					await mkdir(this.dir, { recursive: true });
					this.dirReady = true;
				}
				await appendFile(this.filePath, chunk, "utf8");
			} catch (err) {
				this.disabled = true;
				this.logError(
					`pty capture tee disabled for ${this.filePath}: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		});
	}
}
