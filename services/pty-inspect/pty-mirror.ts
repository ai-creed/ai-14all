import { Terminal } from "@xterm/headless";
import { TERMINAL_SCROLLBACK_ROWS } from "../../shared/constants/terminal-geometry.js";

// Headless mirror of one PTY byte stream. Spec §§1.3/2 (2026-07-17 child):
// - allowProposedApi is required: the headless parser/buffer getters throw
//   without it, and the serializer reads both.
// - RIS/ED3 are observed via parser handlers that only set a pending flag
//   (handlers run BEFORE xterm's own reset — EscapeSequenceParser dispatches
//   newest-first and `false` falls through); the epoch bump + re-baseline
//   happen in the write completion callback, after the reset has parsed.
// - trimmedBefore: linesScrolled saturates against scrollback capacity.
export class PtyMirror {
	private readonly term: Terminal;
	private lastWrite: Promise<void> = Promise.resolve();
	private resetPending = false;
	private settlePromise: Promise<void> = Promise.resolve();
	private settleResolve: (() => void) | null = null;
	private epochValue = 1;
	private watermarkValue = 0;
	private linesScrolled = 0;
	private trimmed = 0;
	private altScreenActive = false;
	private dirtyAbsolute = new Set<number>();
	private stamps = new Map<number, number>(); // absoluteLine -> watermark
	private fingerprints = new Map<number, number>(); // absoluteLine -> hash (viewport rows)
	private epochBumpListeners: Array<() => void> = [];
	private disposed = false;

	constructor(opts: { cols: number; rows: number }) {
		this.term = new Terminal({
			cols: opts.cols,
			rows: opts.rows,
			scrollback: TERMINAL_SCROLLBACK_ROWS,
			allowProposedApi: true,
		});
		// Phase 1 of RIS handling: arm the barrier only, never touch the buffer.
		this.term.parser.registerEscHandler({ final: "c" }, () => {
			this.armReset();
			return false;
		});
		// ED 3 clears scrollback — same identity invalidation class as RIS.
		this.term.parser.registerCsiHandler({ final: "J" }, (params) => {
			if (params[0] === 3) this.armReset();
			return false;
		});
		this.term.onScroll(() => {
			this.linesScrolled++;
			if (this.linesScrolled > TERMINAL_SCROLLBACK_ROWS) this.trimmed++;
			this.markDirty(this.absoluteTop() + this.term.rows - 1);
		});
		this.term.buffer.onBufferChange((buf) => {
			this.altScreenActive = buf.type === "alternate";
			this.bumpEpoch();
		});
	}

	get cols(): number {
		return this.term.cols;
	}
	get rows(): number {
		return this.term.rows;
	}
	get epoch(): number {
		return this.epochValue;
	}
	get watermark(): number {
		return this.watermarkValue;
	}
	get altScreen(): boolean {
		return this.altScreenActive;
	}
	get trimmedBefore(): number {
		return this.trimmed;
	}
	get buffer() {
		return this.term.buffer.active;
	}

	onEpochBump(cb: () => void): () => void {
		this.epochBumpListeners.push(cb);
		return () => {
			const i = this.epochBumpListeners.indexOf(cb);
			if (i >= 0) this.epochBumpListeners.splice(i, 1);
		};
	}

	setEpochFloor(epoch: number): void {
		// Rebind continuity (spec §1.3/§6.12): the replacement mirror must
		// already present a strictly greater epoch when the rebind hint fires,
		// not after some later bump.
		if (epoch >= this.epochValue) this.epochValue = epoch + 1;
	}

	write(data: string): void {
		if (this.disposed) return;
		let resolve!: () => void;
		const done = new Promise<void>((r) => {
			resolve = r;
		});
		this.lastWrite = done;
		this.term.write(data, () => {
			// Phase 2 of RIS/ED3: the reset has fully parsed by now.
			this.settleReset();
			resolve();
		});
	}

	drained(): Promise<void> {
		return this.lastWrite;
	}

	get isResetSettling(): boolean {
		return this.resetPending;
	}

	// Reset barrier (spec §2): resolved immediately when no reset is pending;
	// otherwise resolves after the carrying write's callback re-baselines.
	settled(): Promise<void> {
		return this.settlePromise;
	}

	/** @internal test-only — identical code path to the RIS/ED3 parser handlers. */
	armResetForTest(): void {
		this.armReset();
	}
	/** @internal test-only — identical code path to the write completion callback. */
	settleResetForTest(): void {
		this.settleReset();
	}

	private armReset(): void {
		if (this.resetPending) return;
		this.resetPending = true;
		this.settlePromise = new Promise((r) => {
			this.settleResolve = r;
		});
	}

	private settleReset(): void {
		if (!this.resetPending) return;
		this.resetPending = false;
		this.bumpEpoch();
		this.settleResolve?.();
		this.settleResolve = null;
	}

	resize(cols: number, rows: number): void {
		if (this.disposed) return;
		this.term.resize(cols, rows);
		this.bumpEpoch();
	}

	dispose(): void {
		this.disposed = true;
		this.term.dispose();
	}

	// Absolute index of the first viewport row within the current epoch.
	absoluteTop(): number {
		return this.trimmed + Math.max(0, this.buffer.length - this.term.rows);
	}

	snapshotLineText(retainedIndex: number): string {
		return this.buffer.getLine(retainedIndex)?.translateToString(true) ?? "";
	}

	markDirty(absoluteLine: number): void {
		this.dirtyAbsolute.add(absoluteLine);
	}

	private bumpEpoch(): void {
		this.epochValue++;
		this.watermarkValue = 0;
		this.linesScrolled = 0;
		this.trimmed = 0;
		this.dirtyAbsolute.clear();
		this.stamps.clear();
		this.fingerprints.clear();
		for (const cb of this.epochBumpListeners) cb();
	}

	// Fingerprint pass — Task 3 fills tick()/takeDirty() behavior in full.
	// Task 2 only establishes the settle barrier: no stamp/hint may escape
	// while a reset is pending (spec §2). Outside the barrier there is no
	// dirty/fingerprint tracking yet (that lands in Task 3), so tick() has
	// nothing to report either way — it always signals "no change."
	tick(): boolean {
		return false;
	}
	takeDirty(): Map<number, number> {
		throw new Error("implemented in Task 3");
	}
}
