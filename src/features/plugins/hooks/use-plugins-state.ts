import { useEffect, useState } from "react";
import type { PluginSnapshot } from "../../../../shared/models/ecosystem-plugin";
import { plugins } from "../../../lib/desktop-client";

export function usePluginsState(): PluginSnapshot[] {
	const [snapshots, setSnapshots] = useState<PluginSnapshot[]>([]);
	useEffect(() => {
		let alive = true;
		void plugins.list().then((s) => {
			if (alive) setSnapshots(s);
		});
		const off = plugins.onStateChanged((s) => setSnapshots(s));
		return () => {
			alive = false;
			off();
		};
	}, []);
	return snapshots;
}
