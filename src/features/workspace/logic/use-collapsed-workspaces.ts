import { useCallback, useState } from "react";

const STORAGE_KEY = "ai14all.collapsedWorkspaces";

function read(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : [];
		return Array.isArray(parsed)
			? parsed.filter((x): x is string => typeof x === "string")
			: [];
	} catch {
		return [];
	}
}

export function useCollapsedWorkspaces(): {
	collapsedIds: string[];
	toggle: (id: string) => void;
} {
	const [collapsedIds, setCollapsedIds] = useState<string[]>(read);

	const toggle = useCallback((id: string) => {
		setCollapsedIds((prev) => {
			const next = prev.includes(id)
				? prev.filter((x) => x !== id)
				: [...prev, id];
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			} catch {
				/* storage unavailable (e.g. private mode) — keep in-memory state */
			}
			return next;
		});
	}, []);

	return { collapsedIds, toggle };
}
