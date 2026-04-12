import { useCallback, useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import { terminals } from "../../lib/desktop-client";
import { logRendererShellEvent } from "./shell-event-logger";

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
	const unsubOutputRef = useRef<(() => void) | null>(null);
	const paneInstanceIdRef = useRef(`pane_${session.id}_${Math.random().toString(36).slice(2, 8)}`);
	const isLive = session.status === "running" || session.status === "idle";

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
			scrollback: 1000,
			screenReaderMode: true,
			fontSize: 12,
			fontFamily:
				'"AI14All Terminal Powerline", "Meslo LG M DZ for Powerline", "Meslo LG M for Powerline", "Hack", ui-monospace, Menlo, Monaco, monospace',
		});
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
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
			const isClearShortcut =
				key === "k" &&
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				!event.shiftKey;
			if (!isClearShortcut) return true;
			term.clear();
			return false;
		});
		fitAddon.fit();

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

		// Subscribe to output events, filtered to this session.
		const unsubOutput = terminals.onOutput((event) => {
			if (event.sessionId === session.id) {
				term.write(event.data);
			}
		});
		unsubOutputRef.current = unsubOutput;

		// Send initial resize so the PTY knows the terminal dimensions.
		if (isLive && term.cols > 0 && term.rows > 0) {
			terminals.resize(session.id, term.cols, term.rows).catch(() => undefined);
		}

		return () => {
			onDataDispose.dispose();
			onTitleChangeDispose.dispose();
			unsubOutput();
			unsubOutputRef.current = null;
			term.dispose();
			termRef.current = null;
			fitAddonRef.current = null;
		};
		// session.id is stable for the lifetime of this component instance.
	}, [isLive, session.id]);

	// Log pane visibility changes.
	useEffect(() => {
		void logRendererShellEvent({
			event: visible ? "terminal-pane-visible" : "terminal-pane-hidden",
			windowId: null,
			data: { terminalSessionId: session.id, paneInstanceId: paneInstanceIdRef.current },
		});
	}, [visible, session.id]);

	// Fit + resize PTY when the pane becomes visible.
	useEffect(() => {
		if (!visible || !isLive) return;
		const term = termRef.current;
		const fitAddon = fitAddonRef.current;
		if (!term || !fitAddon) return;

		const wasAtBottom =
			term.buffer.active.viewportY >= term.buffer.active.baseY;
		fitAddon.fit();
		if (wasAtBottom) term.scrollToBottom();
		terminals.resize(session.id, term.cols, term.rows).catch(() => undefined);
	}, [isLive, visible, session.id]);

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
			const wasAtBottom =
				term.buffer.active.viewportY >= term.buffer.active.baseY;
			fitAddon.fit();
			if (wasAtBottom) term.scrollToBottom();
			terminals.resize(session.id, term.cols, term.rows).catch(() => undefined);
		});

		observer.observe(el);
		return () => observer.disconnect();
	}, [isLive, session.id, visible]);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			const files = e.dataTransfer?.files;
			if (!files || files.length === 0) return;

			const paths = Array.from(files)
				.map((f) => (f as File & { path?: string }).path)
				.filter(Boolean)
				.map((p) => p!.replace(/([\\  !"#$&'()*,:;<>?@[\]^`{|}~])/g, "\\$1"));

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
		</section>
	);
}
