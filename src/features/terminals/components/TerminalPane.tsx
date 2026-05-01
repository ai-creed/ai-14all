import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "xterm-addon-search";
import "xterm/css/xterm.css";
import type { TerminalSession } from "../../../../shared/models/terminal-session";
import { files, terminals } from "../../../lib/desktop-client";
import { logRendererShellEvent } from "../logic/shell-event-logger";

const FIND_DECORATIONS = {
	matchBackground: "#5f4400",
	matchOverviewRuler: "#d7a300",
	activeMatchBackground: "#a37700",
	activeMatchColorOverviewRuler: "#ffcc33",
} as const;

type Props = {
	session: TerminalSession;
	visible: boolean;
	onTitleChange?: (title: string) => void;
	onActivate?: () => void;
};

/**
 * Renders a single xterm.js terminal pane for a given session.
 * When `visible` is false the container is hidden via CSS but NOT unmounted,
 * so the xterm instance keeps buffering output from the still-running PTY.
 */
export function TerminalPane({
	session,
	visible,
	onTitleChange,
	onActivate,
}: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const searchAddonRef = useRef<SearchAddon | null>(null);
	const searchResultsDisposeRef = useRef<{ dispose: () => void } | null>(null);
	const findInputRef = useRef<HTMLInputElement | null>(null);
	const unsubOutputRef = useRef<(() => void) | null>(null);
	const paneInstanceIdRef = useRef(
		`pane_${session.id}_${Math.random().toString(36).slice(2, 8)}`,
	);
	const isLive = session.status === "running" || session.status === "idle";

	const [findOpen, setFindOpen] = useState(false);
	const [findQuery, setFindQuery] = useState("");
	const [findCaseSensitive, setFindCaseSensitive] = useState(false);
	const [findResults, setFindResults] = useState({
		resultIndex: -1,
		resultCount: 0,
	});

	/**
	 * Fit the terminal to its container while preserving the scroll anchor.
	 *
	 * Anchor rule:
	 *  - Cursor visible in viewport → keep it at the same offset from the
	 *    viewport top (user is at the prompt / interacting with PTY input).
	 *  - Cursor NOT visible → user scrolled away to read history; restore
	 *    the previous viewportY as closely as possible.
	 */
	const ensureSearchAddon = useCallback((): SearchAddon | null => {
		if (searchAddonRef.current) return searchAddonRef.current;
		const term = termRef.current;
		if (!term) return null;
		// Opt into proposed API only now — needed for SearchAddon's decoration
		// rendering. Doing it on first use keeps idle panes off the proposed
		// init path entirely.
		term.options.allowProposedApi = true;
		const addon = new SearchAddon();
		term.loadAddon(addon);
		searchAddonRef.current = addon;
		searchResultsDisposeRef.current = addon.onDidChangeResults(
			({ resultIndex, resultCount }) => {
				setFindResults({ resultIndex, resultCount });
			},
		);
		return addon;
	}, []);

	const fitPreservingScroll = useCallback(
		(term: Terminal, fitAddon: FitAddon) => {
			const buf = term.buffer.active;
			const cursorAbsY = buf.baseY + buf.cursorY;
			const viewportY = buf.viewportY;
			const cursorInView =
				cursorAbsY >= viewportY && cursorAbsY < viewportY + term.rows;
			const cursorOffset = cursorAbsY - viewportY;

			fitAddon.fit();

			if (cursorInView) {
				const newCursorAbsY =
					term.buffer.active.baseY + term.buffer.active.cursorY;
				const targetViewportY = newCursorAbsY - cursorOffset;
				const delta = targetViewportY - term.buffer.active.viewportY;
				if (delta !== 0) term.scrollLines(delta);
			} else {
				const delta = viewportY - term.buffer.active.viewportY;
				if (delta !== 0) term.scrollLines(delta);
			}
		},
		[],
	);

	// Mount the xterm instance once.
	useEffect(() => {
		void logRendererShellEvent({
			event: "renderer-terminal-mounted",
			windowId: null,
			data: {
				terminalSessionId: session.id,
				paneInstanceId: paneInstanceIdRef.current,
				visible,
			},
		});
		return () => {
			void logRendererShellEvent({
				event: "renderer-terminal-unmounted",
				windowId: null,
				reasonKind: "renderer_drop",
				reason: "pane_unmounted",
				data: {
					terminalSessionId: session.id,
					paneInstanceId: paneInstanceIdRef.current,
				},
			});
		};
		// session.id is stable for the lifetime of this component instance.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [session.id]);

	// Mount the xterm instance once.
	useEffect(() => {
		if (!containerRef.current) return;

		const term = new Terminal({
			cursorBlink: true,
			scrollback: 2000,
			screenReaderMode: true,
			fontSize: 12,
			fontFamily:
				'"AI14All Terminal Powerline", "Meslo LG M DZ for Powerline", "Meslo LG M for Powerline", "Hack", ui-monospace, Menlo, Monaco, monospace',
		});
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		// SearchAddon is lazy-loaded on first Cmd+F. Loading it (and enabling
		// allowProposedApi for its decoration API) at mount has been observed
		// to race the renderer init across many panes at app start, surfacing
		// as uncaught "Cannot read properties of undefined (reading
		// 'dimensions')" in Viewport. Idle panes never trigger that path now.
		term.open(containerRef.current);
		term.attachCustomKeyEventHandler((event) => {
			// Shift+Enter: send literal newline so agent TUIs can distinguish it from
			// plain Enter. xterm maps keyCode 13 to '\r' regardless of shiftKey; we
			// intercept and send '\n' instead, which raw-mode apps read as distinct.
			// Must block on keypress too — otherwise xterm's _keyPress fires after our
			// keydown returns false (_keyDownHandled stays false) and sends '\r'.
			if (
				event.key === "Enter" &&
				event.shiftKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.metaKey
			) {
				if (event.type === "keydown") {
					terminals.sendInput(session.id, "\n").catch(() => {});
				}
				return false;
			}
			if (event.type !== "keydown") return true;
			const key = event.key.toLowerCase();
			const isFindShortcut =
				key === "f" &&
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				!event.shiftKey;
			if (isFindShortcut) {
				ensureSearchAddon();
				setFindOpen(true);
				// Defer focus until the input has rendered.
				queueMicrotask(() => findInputRef.current?.select());
				return false;
			}
			const isClearShortcut =
				key === "k" &&
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				!event.shiftKey;
			if (!isClearShortcut) return true;
			term.clear();
			return false;
		});
		// Defer fit() to the next animation frame so xterm finishes its async
		// renderer init before we trigger a Viewport refresh. With
		// allowProposedApi enabled, xterm wires up extra decoration machinery
		// during init; calling fit() synchronously can race that and produce
		// uncaught "Cannot read properties of undefined (reading 'dimensions')"
		// from Viewport._innerRefresh. The initial PTY resize is moved into
		// the same frame so the backend sees the actual cols/rows.
		const initialFitRafId = requestAnimationFrame(() => {
			if (termRef.current !== term) return;
			fitAddon.fit();
			if (isLive && term.cols > 0 && term.rows > 0) {
				terminals
					.resize(session.id, term.cols, term.rows)
					.catch(() => undefined);
			}
		});

		termRef.current = term;
		fitAddonRef.current = fitAddon;

		// Forward user keystrokes to the PTY backend.
		const onDataDispose = term.onData((data) => {
			terminals.sendInput(session.id, data).catch(() => {
				// session may have exited — ignore
			});
		});
		const onTitleChangeDispose = term.onTitleChange((title) => {
			onTitleChange?.(title);
		});

		// Subscribe to output events, filtered to this session. Coalesce
		// per-event writes via requestAnimationFrame so xterm/Monaco aren't
		// thrashed during high-output bursts. Hard-cap the pending buffer at
		// 256 KiB to bound memory.
		let pending = "";
		let rafId: number | null = null;
		const HARD_CAP_BYTES = 256 * 1024;
		const drain = () => {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			if (!pending) return;
			const out = pending;
			pending = "";
			term.write(out);
		};
		const unsubOutput = terminals.onOutput((event) => {
			if (event.sessionId !== session.id) return;
			pending += event.data;
			if (pending.length >= HARD_CAP_BYTES) {
				drain();
				return;
			}
			if (rafId === null) {
				rafId = requestAnimationFrame(drain);
			}
		});
		unsubOutputRef.current = () => {
			drain();
			unsubOutput();
		};

		return () => {
			cancelAnimationFrame(initialFitRafId);
			onDataDispose.dispose();
			onTitleChangeDispose.dispose();
			searchResultsDisposeRef.current?.dispose();
			searchResultsDisposeRef.current = null;
			unsubOutputRef.current?.();
			unsubOutputRef.current = null;
			term.dispose();
			termRef.current = null;
			fitAddonRef.current = null;
			searchAddonRef.current = null;
		};
		// Tie the xterm instance lifecycle to session.id only. isLive transitions
		// (running/idle ↔ exited) must not tear down and rebuild the terminal —
		// xterm 5.3 schedules Viewport refreshes via setTimeout/RAF that would
		// then fire against a disposed RenderService. The captured isLive used
		// for the initial-resize is mount-time; later transitions are handled by
		// the visibility/ResizeObserver effects below, which runtime-check isLive.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [session.id]);

	// Log pane visibility changes.
	useEffect(() => {
		void logRendererShellEvent({
			event: visible ? "terminal-pane-visible" : "terminal-pane-hidden",
			windowId: null,
			data: {
				terminalSessionId: session.id,
				paneInstanceId: paneInstanceIdRef.current,
			},
		});
	}, [visible, session.id]);

	// Fit + resize PTY when the pane becomes visible.
	useEffect(() => {
		if (!visible || !isLive) return;
		const term = termRef.current;
		const fitAddon = fitAddonRef.current;
		if (!term || !fitAddon) return;

		fitPreservingScroll(term, fitAddon);
		terminals.resize(session.id, term.cols, term.rows).catch(() => undefined);
	}, [isLive, visible, session.id, fitPreservingScroll]);

	// Resize on container dimension changes via ResizeObserver.
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;

		const observer = new ResizeObserver(() => {
			const term = termRef.current;
			const fitAddon = fitAddonRef.current;
			if (!term || !fitAddon) return;
			// Only fit/resize when the pane is actually visible.
			if (!visible || !isLive) return;
			fitPreservingScroll(term, fitAddon);
			terminals.resize(session.id, term.cols, term.rows).catch(() => undefined);
		});

		observer.observe(el);
		return () => observer.disconnect();
	}, [isLive, session.id, visible, fitPreservingScroll]);

	const runFind = useCallback(
		(direction: "next" | "prev", queryOverride?: string) => {
			const addon = searchAddonRef.current;
			if (!addon) return;
			const q = queryOverride ?? findQuery;
			if (!q) {
				addon.clearDecorations();
				setFindResults({ resultIndex: -1, resultCount: 0 });
				return;
			}
			const opts = {
				caseSensitive: findCaseSensitive,
				decorations: FIND_DECORATIONS,
			};
			if (direction === "next") addon.findNext(q, opts);
			else addon.findPrevious(q, opts);
		},
		[findQuery, findCaseSensitive],
	);

	const closeFind = useCallback(() => {
		searchAddonRef.current?.clearDecorations();
		setFindOpen(false);
		setFindResults({ resultIndex: -1, resultCount: 0 });
		termRef.current?.focus();
	}, []);

	useEffect(() => {
		if (!findOpen) return;
		runFind("next");
	}, [findOpen, findQuery, findCaseSensitive, runFind]);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			const dropped = e.dataTransfer?.files;
			if (!dropped || dropped.length === 0) return;

			const paths = Array.from(dropped)
				.map((f) => files.getPathForFile(f))
				.filter(Boolean)
				.map((p) => p.replace(/([\\  !"#$&'()*,:;<>?@[\]^`{|}~])/g, "\\$1"));

			if (paths.length > 0) {
				terminals.sendInput(session.id, paths.join(" ")).catch(() => {});
			}
		},
		[session.id],
	);

	return (
		<section
			aria-hidden={visible ? "false" : "true"}
			className="shell-panel shell-terminal-pane"
			data-terminal-session-id={session.id}
			onMouseDown={onActivate}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
			style={{ display: visible ? "block" : "none" }}
		>
			<div ref={containerRef} className="shell-terminal-pane__viewport" />
			{findOpen && (
				<div
					className="shell-terminal-find"
					role="search"
					aria-label="Find in terminal"
					onMouseDown={(e) => e.stopPropagation()}
				>
					<input
						ref={findInputRef}
						autoFocus
						type="text"
						className="shell-terminal-find__input"
						aria-label="Find"
						placeholder="Find"
						value={findQuery}
						onChange={(e) => setFindQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.preventDefault();
								closeFind();
							} else if (e.key === "Enter") {
								e.preventDefault();
								runFind(e.shiftKey ? "prev" : "next");
							}
						}}
					/>
					<span
						className="shell-terminal-find__count"
						aria-live="polite"
					>
						{findQuery
							? findResults.resultCount === 0
								? "No results"
								: `${findResults.resultIndex + 1} of ${findResults.resultCount}`
							: ""}
					</span>
					<button
						type="button"
						className="shell-button shell-button--icon shell-button--compact"
						aria-label="Match case"
						aria-pressed={findCaseSensitive}
						data-active={String(findCaseSensitive)}
						onClick={() => setFindCaseSensitive((v) => !v)}
					>
						Aa
					</button>
					<button
						type="button"
						className="shell-button shell-button--icon shell-button--compact"
						aria-label="Previous match"
						onClick={() => runFind("prev")}
					>
						‹
					</button>
					<button
						type="button"
						className="shell-button shell-button--icon shell-button--compact"
						aria-label="Next match"
						onClick={() => runFind("next")}
					>
						›
					</button>
					<button
						type="button"
						className="shell-button shell-button--icon shell-button--compact"
						aria-label="Close find"
						onClick={closeFind}
					>
						×
					</button>
				</div>
			)}
		</section>
	);
}
