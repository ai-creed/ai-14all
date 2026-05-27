import { useEffect, useState } from "react";
import type { UsageSnapshot } from "../../../shared/models/usage.js";

export function useUsageSnapshot(): UsageSnapshot | null {
	const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
	useEffect(() => {
		const api = window.ai14all?.usage;
		if (!api) return;
		return api.onSnapshot(setSnapshot);
	}, []);
	return snapshot;
}
