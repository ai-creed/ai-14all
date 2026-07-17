// Single source of truth for terminal buffer geometry. The renderer xterm,
// the PTY spawn call, and the headless inspect mirrors must all read these —
// spec 2026-07-17-xbp-pty-inspect-14all-design.md §1 (retention & geometry
// parity are normative).
export const TERMINAL_SCROLLBACK_ROWS = 10_000;
export const TERMINAL_SPAWN_COLS = 80;
export const TERMINAL_SPAWN_ROWS = 24;
