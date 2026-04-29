import { useEffect, useState } from "react";
import type { UpdateInfo } from "../../../shared/contracts/commands";
import { system } from "../../lib/desktop-client";

/**
 * Subscribe to update-available events from the main process and surface
 * the latest version. Caller decides when to show/dismiss the banner.
 */
export function useUpdateInfoListener(): UpdateInfo | null {
	const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
	useEffect(() => {
		return system.onUpdateAvailable((info) => {
			setUpdateInfo(info);
		});
	}, []);
	return updateInfo;
}
