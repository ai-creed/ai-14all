import { useEffect, useRef } from "react";
import { diagnostics } from "../../lib/desktop-client";
import { useToast } from "../../features/ui/toast/use-toast";

/**
 * On cold start, query the resolved agent-attention diagnostics mode from the
 * main process. When it is `full`, surface a one-time toast warning the user
 * that raw terminal output is being captured to disk.
 *
 * Renders nothing — it only fires a side-effecting toast. Must be mounted
 * inside `ToastProvider`.
 */
export function AgentAttentionBanner(): null {
	const toast = useToast();
	const shown = useRef(false);

	useEffect(() => {
		if (shown.current) return;
		let cancelled = false;
		void diagnostics
			.getAgentAttentionStatus()
			.then((status) => {
				if (cancelled || shown.current) return;
				if (status.mode !== "full") return;
				shown.current = true;
				toast.show(
					`Raw terminal output is being captured to ${status.logsDir}/agent-attention-*.jsonl (diagnostics mode = full). Unset the AI14ALL_AGENT_ATTENTION_LOG environment variable and relaunch to disable.`,
				);
			})
			.catch(() => {
				// Best-effort: a missing/failed status query must not break boot.
			});
		return () => {
			cancelled = true;
		};
	}, [toast]);

	return null;
}
