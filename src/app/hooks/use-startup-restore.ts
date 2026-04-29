import { useEffect } from "react";
import type { PersistedSavedWorkspace } from "../../../shared/models/persisted-workspace-state";
import type { WorkspaceSnapshot } from "../../../shared/models/persisted-workspace-state";
import type { RestorePreference } from "../../../shared/models/persisted-workspace-state";
import { workspace, terminals } from "../../lib/desktop-client";
import { logRendererShellEvent } from "../../features/terminals/logic/shell-event-logger";

type StartupMode = "loading" | "prompt" | "ready";

type Options = {
	setStartupMode: (mode: StartupMode) => void;
	setStartupError: (err: string | null) => void;
	setRestorePreference: (pref: RestorePreference) => void;
	setSavedSnapshot: (snapshot: WorkspaceSnapshot | null) => void;
	setSavedDormantWorkspaces: (workspaces: PersistedSavedWorkspace[]) => void;
	restoreWorkspace: (
		snapshot: WorkspaceSnapshot,
		preference: RestorePreference,
		dormantSaved: PersistedSavedWorkspace[],
	) => void | Promise<void>;
};

/**
 * Drive the startup restore handshake: read persisted state, decide between
 * automatic restore, renderer-reload reconnect, or user prompt, and update
 * startup mode accordingly. Runs once on mount.
 */
export function useStartupRestore(options: Options): void {
	const {
		setStartupMode,
		setStartupError,
		setRestorePreference,
		setSavedSnapshot,
		setSavedDormantWorkspaces,
		restoreWorkspace,
	} = options;

	useEffect(() => {
		let cancelled = false;

		void workspace
			.readRestoreState()
			.then(async (result) => {
				if (cancelled) return;

				const activeSaved = result.activeWorkspaceId
					? result.workspaces.find(
							(w) => w.workspaceId === result.activeWorkspaceId,
						)
					: result.workspaces[0];
				const snapshot = activeSaved?.snapshot ?? null;
				const dormantSaved = result.workspaces.filter(
					(w) => w.workspaceId !== (activeSaved?.workspaceId ?? ""),
				);

				setRestorePreference(result.restorePreference);
				setSavedSnapshot(snapshot);
				setSavedDormantWorkspaces(dormantSaved);

				if (!snapshot) {
					setStartupMode("ready");
					return;
				}
				if (result.restorePreference === "alwaysStartClean") {
					setStartupMode("ready");
					return;
				}
				if (result.restorePreference === "alwaysRestore") {
					void restoreWorkspace(
						snapshot,
						result.restorePreference,
						dormantSaved,
					);
					return;
				}

				// A renderer reload should reconnect immediately when the main
				// process still owns live terminal sessions for the saved workspace.
				if (activeSaved?.workspaceId) {
					try {
						void logRendererShellEvent({
							event: "renderer-reconnect-list-start",
							windowId: null,
							data: { targetWorkspaceId: activeSaved.workspaceId },
						});
						const liveSessions = await terminals.list(activeSaved.workspaceId);
						if (cancelled) return;
						void logRendererShellEvent({
							event: "renderer-reconnect-list-success",
							windowId: null,
							data: {
								targetWorkspaceId: activeSaved.workspaceId,
								liveBackendSessionIds: liveSessions.map((s) => s.id),
							},
						});
						if (liveSessions.length > 0) {
							void logRendererShellEvent({
								event: "renderer-reload-detected",
								windowId: null,
								reasonKind: "window_lifecycle",
								reason: "renderer_reload",
								data: {
									targetWorkspaceId: activeSaved.workspaceId,
									liveSessionCount: liveSessions.length,
								},
							});
							void restoreWorkspace(
								snapshot,
								result.restorePreference,
								dormantSaved,
							);
							return;
						}
					} catch {
						// Fall through to the regular prompt path.
					}
				}

				setStartupMode("prompt");
			})
			.catch((err) => {
				if (cancelled) return;
				setStartupError(`Failed to load workspace state: ${String(err)}`);
				setStartupMode("ready");
			});

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- startup-only effect; intentionally runs once
	}, []);
}
