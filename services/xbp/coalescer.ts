// services/xbp/coalescer.ts
export function createCoalescer(fn: () => void, ms: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return {
		trigger() {
			if (timer) return;
			timer = setTimeout(() => {
				timer = null;
				fn();
			}, ms);
		},
		cancel() {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		},
	};
}
