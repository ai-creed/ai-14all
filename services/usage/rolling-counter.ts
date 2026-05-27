export interface RollingCounterOptions {
	windowMs: number;
	bucketMs: number;
}

export class RollingCounter {
	private readonly windowMs: number;
	private readonly bucketMs: number;
	private readonly buckets = new Map<number, number>();
	private latest = Number.NEGATIVE_INFINITY;

	constructor(opts: RollingCounterOptions) {
		this.windowMs = opts.windowMs;
		this.bucketMs = opts.bucketMs;
	}

	add(timestampMs: number, amount: number): void {
		const bucket = Math.floor(timestampMs / this.bucketMs);
		this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + amount);
		if (timestampMs > this.latest) this.latest = timestampMs;
		this.prune();
	}

	sum(nowMs: number): number {
		const minBucket = Math.floor((nowMs - this.windowMs) / this.bucketMs);
		let total = 0;
		for (const [bucket, amount] of this.buckets) {
			if (bucket >= minBucket) total += amount;
		}
		return total;
	}

	// Sum amounts at or after a fixed timestamp (for fixed-reset windows, as long
	// as fromMs is within the retained window).
	sumSince(fromMs: number): number {
		const minBucket = Math.floor(fromMs / this.bucketMs);
		let total = 0;
		for (const [bucket, amount] of this.buckets) {
			if (bucket >= minBucket) total += amount;
		}
		return total;
	}

	bucketCount(): number {
		return this.buckets.size;
	}

	// Drop buckets older than the window relative to the newest timestamp seen,
	// so the counter stays bounded even when events arrive out of order.
	private prune(): void {
		const minBucket = Math.floor((this.latest - this.windowMs) / this.bucketMs);
		for (const bucket of this.buckets.keys()) {
			if (bucket < minBucket) this.buckets.delete(bucket);
		}
	}
}
