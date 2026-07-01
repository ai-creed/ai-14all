import type { SamanthaSessionSlice } from "../../../shared/contracts/plugins";

export function createSessionSliceStore() {
	let slice: SamanthaSessionSlice | null = null;
	const listeners = new Set<() => void>();
	return {
		get: () => slice,
		set: (next: SamanthaSessionSlice) => {
			slice = next;
			for (const cb of listeners) cb();
		},
		subscribe: (cb: () => void) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
	};
}
