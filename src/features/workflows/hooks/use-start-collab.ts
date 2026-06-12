import { useCallback, useEffect, useState } from "react";
import type { WhisperWorktreeState } from "../../../../shared/models/ecosystem-plugin";
import {
	advanceStartCollab,
	type StartCollabPhase,
} from "../logic/start-collab";

export function useStartCollab(options: {
	worktreeId: string;
	whisperState: WhisperWorktreeState | undefined;
	/**
	 * App threads the same createSession + sendInput pair the preset path
	 * uses (terminal creation already goes through the existing id-based
	 * renderer flow — no new path-carrying IPC here).
	 */
	launchInTerminal: (command: string) => Promise<void>;
}) {
	const [phase, setPhase] = useState<StartCollabPhase>({ kind: "idle" });

	useEffect(() => {
		setPhase((current) =>
			advanceStartCollab(
				current,
				options.whisperState?.bindings ?? [],
				Date.now(),
			),
		);
	}, [options.whisperState]);

	const start = useCallback(async () => {
		setPhase({ kind: "waiting", startedAt: Date.now() });
		await options.launchInTerminal("whisper collab mount claude");
		await options.launchInTerminal("whisper collab mount codex");
	}, [options.launchInTerminal]);

	const reset = useCallback(() => {
		setPhase({ kind: "idle" });
	}, []);

	return { phase, start, reset };
}
