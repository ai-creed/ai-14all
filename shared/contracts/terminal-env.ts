/** Injected into every app-spawned PTY; agents echo it back in
 *  register_agent_session for pane-exact attribution (spec §5.1). */
export const TERMINAL_SESSION_ENV_VAR = "AI14ALL_TERMINAL_SESSION_ID";
