/**
 * Renderer-side per-session terminal output buffer used to repopulate a freshly
 * mounted xterm after its pane was unmounted and remounted.
 *
 * Switching the selected worktree-session within a workspace re-renders that
 * workspace's terminal panel with a different session's slots, so React
 * unmounts the leaving session's panes (disposing the xterm and its client-side
 * scrollback) and mounts the returning session's panes as fresh, empty xterms.
 * The PTY keeps running in the backend, but its output is a live stream with no
 * replay, so without this buffer the remounted pane has nothing to show and the
 * terminal renders blank (see docs/bugreports/bug-terminal-empty-on-workspace-
 * switch.md).
 *
 * The app-wide PTY output subscription (use-terminal-runtime) feeds every
 * session's raw output here regardless of whether a pane is currently mounted,
 * so the buffer survives unmount/remount. On mount a pane replays the buffer
 * synchronously — before its own live subscription can deliver anything — so
 * there is neither duplication (the buffer covers output up to mount) nor a gap
 * (the live subscription covers output after mount).
 *
 * The buffer is keyed by the global terminal-session id and bounded to the most
 * recent `REPLAY_LIMIT` characters, trimmed at a line boundary so a replay never
 * begins mid-escape-sequence.
 */

/** Max characters retained per session (≈ xterm's default 10k-line scrollback). */
export const REPLAY_LIMIT = 256 * 1024;

/**
 * Append `data` to `prev`, keeping at most `limit` characters. When trimming,
 * drop the partial leading line (up to the first newline) so the retained tail
 * starts on a fresh line rather than in the middle of an ANSI escape sequence.
 */
export function appendBoundedReplay(
	prev: string,
	data: string,
	limit = REPLAY_LIMIT,
): string {
	const combined = prev + data;
	if (combined.length <= limit) return combined;
	const tail = combined.slice(combined.length - limit);
	const nl = tail.indexOf("\n");
	return nl >= 0 && nl < tail.length - 1 ? tail.slice(nl + 1) : tail;
}

const buffers = new Map<string, string>();

/** Record raw PTY output for a session. Called for every output event. */
export function recordReplayOutput(sessionId: string, data: string): void {
	if (!data) return;
	buffers.set(
		sessionId,
		appendBoundedReplay(buffers.get(sessionId) ?? "", data),
	);
}

/** The buffered output to replay into a freshly mounted xterm for a session. */
export function getReplayOutput(sessionId: string): string {
	return buffers.get(sessionId) ?? "";
}

/** Drop a session's buffer (on exit/error/removal) to bound memory. */
export function clearReplayOutput(sessionId: string): void {
	buffers.delete(sessionId);
}
