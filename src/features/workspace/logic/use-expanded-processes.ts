import { useCallback, useState } from "react";

const STORAGE_KEY = "ai14all.expandedProcessWorktrees";

function read(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : [];
		return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

export function useExpandedProcesses(): { expandedIds: string[]; toggle: (worktreeId: string) => void } {
	const [expandedIds, setExpandedIds] = useState<string[]>(read);
	const toggle = useCallback((worktreeId: string) => {
		setExpandedIds((prev) => {
			const next = prev.includes(worktreeId) ? prev.filter((x) => x !== worktreeId) : [...prev, worktreeId];
			try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
			return next;
		});
	}, []);
	return { expandedIds, toggle };
}
