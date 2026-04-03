import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import { terminals } from "../../lib/desktop-client";

type Props = {
  session: TerminalSession;
  visible: boolean;
};

/**
 * Renders a single xterm.js terminal pane for a given session.
 * When `visible` is false the container is hidden via CSS but NOT unmounted,
 * so the xterm instance keeps buffering output from the still-running PTY.
 */
export function TerminalPane({ session, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unsubOutputRef = useRef<(() => void) | null>(null);

  // Mount the xterm instance once.
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({ cursorBlink: true, scrollback: 1000, screenReaderMode: true });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Forward user keystrokes to the PTY backend.
    const onDataDispose = term.onData((data) => {
      terminals.sendInput(session.id, data).catch(() => {
        // session may have exited — ignore
      });
    });

    // Subscribe to output events, filtered to this session.
    const unsubOutput = terminals.onOutput((event) => {
      if (event.sessionId === session.id) {
        term.write(event.data);
      }
    });
    unsubOutputRef.current = unsubOutput;

    // Send initial resize so the PTY knows the terminal dimensions.
    if (term.cols > 0 && term.rows > 0) {
      terminals
        .resize(session.id, term.cols, term.rows)
        .catch(() => undefined);
    }

    return () => {
      onDataDispose.dispose();
      unsubOutput();
      unsubOutputRef.current = null;
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // session.id is stable for the lifetime of this component instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Fit + resize PTY when the pane becomes visible.
  useEffect(() => {
    if (!visible) return;
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;

    fitAddon.fit();
    terminals
      .resize(session.id, term.cols, term.rows)
      .catch(() => undefined);
  }, [visible, session.id]);

  // Resize on container dimension changes via ResizeObserver.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      const term = termRef.current;
      const fitAddon = fitAddonRef.current;
      if (!term || !fitAddon) return;
      // Only fit/resize when the pane is actually visible.
      if (!visible) return;
      fitAddon.fit();
      terminals
        .resize(session.id, term.cols, term.rows)
        .catch(() => undefined);
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [session.id, visible]);

  return (
    <div
      style={{
        display: visible ? "flex" : "none",
        flexDirection: "column",
        height: 300,
        border: "1px solid #444",
        borderRadius: 4,
        overflow: "hidden",
        marginBottom: 8,
      }}
    >
      <div
        style={{
          padding: "2px 8px",
          fontSize: "0.75em",
          background: "#222",
          color: "#aaa",
          flexShrink: 0,
        }}
      >
        Session {session.id.slice(0, 8)} — {session.status}
      </div>
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, background: "#1e1e1e" }}
      />
    </div>
  );
}
