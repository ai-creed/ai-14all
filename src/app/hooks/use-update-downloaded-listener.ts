import { useEffect, useState } from "react";
import type { UpdateInfo } from "../../../shared/contracts/commands";
import { system } from "../../lib/desktop-client";

/**
 * Subscribe to update-downloaded events from the main process. When set, a
 * version has finished downloading and is ready to install on restart.
 */
export function useUpdateDownloadedListener(): UpdateInfo | null {
	const [info, setInfo] = useState<UpdateInfo | null>(null);
	useEffect(() => {
		return system.onUpdateDownloaded((next) => {
			setInfo(next);
		});
	}, []);
	return info;
}
