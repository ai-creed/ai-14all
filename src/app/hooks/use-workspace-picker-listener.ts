import { useEffect } from "react";
import { workspace } from "../../lib/desktop-client";

type Options = {
	startupMode: string;
	onOpen: () => void;
};

/**
 * Listen for the main process's "open workspace picker" event (fired by the
 * application menu accelerator) and invoke `onOpen` once startup is ready.
 */
export function useWorkspacePickerListener(options: Options): void {
	const { startupMode, onOpen } = options;
	useEffect(
		() =>
			workspace.onOpenPicker(() => {
				if (startupMode !== "ready") return;
				onOpen();
			}),
		[startupMode, onOpen],
	);
}
