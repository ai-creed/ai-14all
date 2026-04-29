import { useEffect } from "react";
import type { PersistedWorkspaceStateV2 } from "../../../shared/models/persisted-workspace-state";
import { workspace } from "../../lib/desktop-client";

type Options = {
	startupMode: string;
	persistableState: PersistedWorkspaceStateV2;
	persistableStateJson: string;
};

export function useWorkspacePersistence({
	startupMode,
	persistableState,
	persistableStateJson,
}: Options): void {
	useEffect(() => {
		if (startupMode !== "ready") return;
		void workspace.writeRestoreState(persistableState);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- persistableStateJson for change detection; persistableState for the write
	}, [startupMode, persistableStateJson]);
}
