// Cross-process dirty-state + close-gate for the InlineEditor.
//
// Renderer's InlineEditor pushes its dirty bit via the `app:setEditorDirty`
// IPC. Main keeps a map keyed by `${workspaceId}|${worktreeId}|${relativePath}`
// of currently-dirty buffers. When the user tries to close the window:
//   1. If the map is empty, the close proceeds.
//   2. Otherwise we preventDefault the close, send `app:requestClose` to the
//      renderer, and wait for `app:confirmClose({ proceed })`.
//   3. On `proceed: true` we destroy the window; on `false` we leave it open.
//   4. A 5 s safety timeout treats a non-replying renderer as `proceed: true`
//      so a crashed renderer can never permanently block app close.

const REPLY_TIMEOUT_MS = 5_000;

export interface CloseGateWindow {
	on(
		event: "close",
		listener: (event: { preventDefault(): void }) => void,
	): unknown;
	webContents: {
		send(channel: string, payload?: unknown): void;
	};
	destroy(): void;
}

export interface CloseGateOptions {
	replyTimeoutMs?: number;
}

export type CloseGateDirtyArgs = {
	workspaceId: string;
	worktreeId: string;
	relativePath: string;
	dirty: boolean;
};

export interface CloseGate {
	setDirty(args: CloseGateDirtyArgs): void;
	isAnyDirty(): boolean;
	dirtyKeys(): string[];
	attach(window: CloseGateWindow, opts?: CloseGateAttachOptions): void;
	confirmClose(args: { proceed: boolean }): void;
}

export interface CloseGateAttachOptions {
	// When provided, the gate only guards a `close` if this returns true (i.e. a
	// real app quit). On macOS the window is hidden — not destroyed — on a normal
	// close, so unsaved editor buffers survive and there is nothing to guard.
	isQuitting?: () => boolean;
}

function keyFor(args: {
	workspaceId: string;
	worktreeId: string;
	relativePath: string;
}): string {
	return `${args.workspaceId}|${args.worktreeId}|${args.relativePath}`;
}

export function createCloseGate(opts: CloseGateOptions = {}): CloseGate {
	const replyTimeoutMs = opts.replyTimeoutMs ?? REPLY_TIMEOUT_MS;
	const dirty = new Set<string>();
	let pendingWindow: CloseGateWindow | null = null;
	let pendingTimer: ReturnType<typeof setTimeout> | null = null;

	function clearPending(): void {
		if (pendingTimer !== null) {
			clearTimeout(pendingTimer);
			pendingTimer = null;
		}
		pendingWindow = null;
	}

	return {
		setDirty(args) {
			const k = keyFor(args);
			if (args.dirty) dirty.add(k);
			else dirty.delete(k);
		},
		isAnyDirty() {
			return dirty.size > 0;
		},
		dirtyKeys() {
			return [...dirty];
		},
		attach(window, attachOpts = {}) {
			window.on("close", (event) => {
				// Not a real quit: let hide-on-close handle it (hiding never loses
				// buffers, so there is nothing to guard here).
				if (attachOpts.isQuitting && !attachOpts.isQuitting()) return;
				if (dirty.size === 0) return; // allow default close
				if (pendingWindow) {
					// A close is already in flight; just block this event.
					event.preventDefault();
					return;
				}
				event.preventDefault();
				pendingWindow = window;
				window.webContents.send("app:requestClose", { keys: [...dirty] });
				pendingTimer = setTimeout(() => {
					const w = pendingWindow;
					clearPending();
					try {
						w?.destroy();
					} catch {
						// best-effort
					}
				}, replyTimeoutMs);
			});
		},
		confirmClose({ proceed }) {
			const w = pendingWindow;
			clearPending();
			if (!w) return;
			if (proceed) {
				try {
					w.destroy();
				} catch {
					// best-effort
				}
			}
		},
	};
}
