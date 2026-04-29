const HARD_CAP_BYTES = 256 * 1024;

export class OutputBatcher {
	private buf = "";
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly windowMs: number,
		private readonly flushFn: (data: string) => void,
	) {}

	push(chunk: string): void {
		this.buf += chunk;
		if (this.buf.length >= HARD_CAP_BYTES) {
			this.drain();
			return;
		}
		if (!this.timer) {
			this.timer = setTimeout(() => this.drain(), this.windowMs);
		}
	}

	drain(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (!this.buf) return;
		const out = this.buf;
		this.buf = "";
		this.flushFn(out);
	}
}
