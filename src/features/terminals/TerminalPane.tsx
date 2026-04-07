import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import { terminals } from "../../lib/desktop-client";

type Props = {
	session: TerminalSession;
	visible: boolean;
	onTitleChange?: (title: string) => void;
};

/**
 * Renders a single xterm.js terminal pane for a given session.
 * When `visible` is false the container is hidden via CSS but NOT unmounted,
 * so the xterm instance keeps buffering output from the still-running PTY.
 */
export function TerminalPane({ session, visible, onTitleChange }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const unsubOutputRef = useRef<(() => void) | null>(null);
	const isLive = session.status === "running" || session.status === "idle";

	// Mount the xterm instance once.
	useEffect(() => {
		if (!containerRef.current) return;

		const term = new Terminal({
			cursorBlink: true,
			scrollback: 1000,
			screenReaderMode: true,
			fontSize: 11,
			fontFamily:
				'"AI14All Terminal Powerline", "Meslo LG M DZ for Powerline", "Meslo LG M for Powerline", "Hack", ui-monospace, Menlo, Monaco, monospace',
		});
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.open(containerRef.current);
		term.attachCustomKeyEventHandler((event) => {
			if (event.type !== "keydown") return true;
			const key = event.key.toLowerCase();
			const isClearShortcut =
				key === "k" &&
				(event.metaKey || event.ctrlKey) &&
				!event.altKey;
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

	// Fit + resize PTY when the pane becomes visible.
	useEffect(() => {
		if (!visible || !isLive) return;
		const term = termRef.current;
		const fitAddon = fitAddonRef.current;
		if (!term || !fitAddon) return;

		fitAddon.fit();
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
			fitAddon.fit();
			terminals.resize(session.id, term.cols, term.rows).catch(() => undefined);
		});

		observer.observe(el);
		return () => observer.disconnect();
	}, [isLive, session.id, visible]);

	return (
		<section
			aria-hidden={!visible}
			className="shell-panel shell-terminal-pane"
			data-terminal-session-id={session.id}
			style={{ display: visible ? "block" : "none" }}
		>
			<div ref={containerRef} className="shell-terminal-pane__viewport" />
		</section>
	);
}
