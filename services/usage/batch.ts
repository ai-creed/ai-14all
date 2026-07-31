// Process items in batches of `batchSize`, yielding to the event loop via
// setImmediate between batches so a large run never blocks. `onBatch` fires
// after each batch (used for progressive snapshot emits). Resolves when done.
//
// `step` and `onBatch` run inside a setImmediate callback — i.e. AFTER the
// Promise executor has returned — so a throw there is an uncaught exception on
// the macrotask queue, not a rejection, and it kills the process (in the usage
// worker it killed the whole utilityProcess and wedged the dashboard; see
// tests/unit/usage/batch.test.ts). Catching and rejecting is what makes the
// returned Promise<void> honest: every `await` site can now handle a failure,
// and no further ticks are scheduled once one is caught.
export function processInBatches<T>(
	items: T[],
	batchSize: number,
	step: (item: T) => void,
	onBatch?: () => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (items.length === 0) {
			resolve();
			return;
		}
		let i = 0;
		const tick = (): void => {
			try {
				const end = Math.min(i + batchSize, items.length);
				for (; i < end; i++) step(items[i]);
				onBatch?.();
			} catch (err) {
				reject(err); // stop here: no further tick is scheduled
				return;
			}
			if (i < items.length) setImmediate(tick);
			else resolve();
		};
		setImmediate(tick);
	});
}
