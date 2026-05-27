// Process items in batches of `batchSize`, yielding to the event loop via
// setImmediate between batches so a large run never blocks. `onBatch` fires
// after each batch (used for progressive snapshot emits). Resolves when done.
export function processInBatches<T>(
	items: T[],
	batchSize: number,
	step: (item: T) => void,
	onBatch?: () => void,
): Promise<void> {
	return new Promise((resolve) => {
		if (items.length === 0) {
			resolve();
			return;
		}
		let i = 0;
		const tick = (): void => {
			const end = Math.min(i + batchSize, items.length);
			for (; i < end; i++) step(items[i]);
			onBatch?.();
			if (i < items.length) setImmediate(tick);
			else resolve();
		};
		setImmediate(tick);
	});
}
