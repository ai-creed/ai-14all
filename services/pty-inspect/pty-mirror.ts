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
	private wroteSinceTick = false; // set true in write() completion callback
	private lastViewportTopAbs = 0;

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
			if (this.linesScrolled > TERMINAL_SCROLLBACK_ROWS) {
				this.trimmed++;
				this.stamps.delete(this.trimmed - 1);
				this.fingerprints.delete(this.trimmed - 1);
			}
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
			this.wroteSinceTick = true;
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

	private bumpEpoch(): void {
		this.epochValue++;
		this.watermarkValue = 0;
		this.linesScrolled = 0;
		this.trimmed = 0;
		this.dirtyAbsolute.clear();
		this.stamps.clear();
		this.fingerprints.clear();
		// Post-bump absolute space starts at trimmed = 0.
		this.lastViewportTopAbs = Math.max(0, this.buffer.length - this.term.rows);
		for (const cb of this.epochBumpListeners) cb();
	}

	// FNV-1a over the row's translated text and packed cell attrs. Only
	// viewport rows can mutate in place (scrolled-out rows are immutable
	// within an epoch — reflow/RIS/ED3 bump the epoch), so hashing the
	// viewport is sufficient. Spec §2 dirty-line tracking.
	private rowFingerprint(retainedIndex: number): number {
		const line = this.buffer.getLine(retainedIndex);
		if (!line) return 0;
		let h = 0x811c9dc5;
		const mix = (n: number) => {
			h ^= n & 0xff;
			h = Math.imul(h, 0x01000193);
			h ^= (n >>> 8) & 0xff;
			h = Math.imul(h, 0x01000193);
		};
		const text = line.translateToString(false);
		for (let i = 0; i < text.length; i++) mix(text.charCodeAt(i));
		const cell = this.buffer.getNullCell();
		for (let x = 0; x < line.length; x++) {
			line.getCell(x, cell);
			mix(cell.getFgColor() + 1);
			mix(cell.getBgColor() + 1);
			mix(
				(cell.isBold() ? 1 : 0) |
					(cell.isDim() ? 2 : 0) |
					(cell.isItalic() ? 4 : 0) |
					(cell.isUnderline() ? 8 : 0) |
					(cell.isInverse() ? 16 : 0),
			);
		}
		return h >>> 0;
	}

	// One coalesce tick (spec §2): stamp rows that departed the viewport
	// since the last tick (dirty by construction — a burst larger than the
	// viewport cannot silently lose rows), fingerprint-diff the current
	// viewport, stamp dirty rows with ++watermark, clear the dirty set.
	tick(): boolean {
		if (this.resetPending) return false; // §2 barrier: nothing stamps mid-reset
		if (!this.wroteSinceTick && this.dirtyAbsolute.size === 0) return false;
		this.wroteSinceTick = false;
		const viewportStart = Math.max(0, this.buffer.length - this.term.rows);
		// Rows that left the viewport since the last tick can never change
		// again (scrolled-out rows are immutable within an epoch), so they are
		// dirty by construction — a burst larger than the viewport must not
		// silently lose its earliest rows (spec §2).
		const viewportTopAbs = viewportStart + this.trimmed;
		for (let abs = this.lastViewportTopAbs; abs < viewportTopAbs; abs++) {
			if (abs >= this.trimmed) this.dirtyAbsolute.add(abs);
		}
		this.lastViewportTopAbs = viewportTopAbs;
		for (let r = viewportStart; r < this.buffer.length; r++) {
			const abs = r + this.trimmed;
			const fp = this.rowFingerprint(r);
			if (this.fingerprints.get(abs) !== fp) {
				this.fingerprints.set(abs, fp);
				this.dirtyAbsolute.add(abs);
			}
		}
		// Evict fingerprints of rows that scrolled out of the viewport.
		for (const abs of this.fingerprints.keys()) {
			if (abs < viewportStart + this.trimmed) this.fingerprints.delete(abs);
		}
		if (this.dirtyAbsolute.size === 0) return false;
		this.watermarkValue++;
		for (const abs of this.dirtyAbsolute) {
			if (abs >= this.trimmed) this.stamps.set(abs, this.watermarkValue);
		}
		this.dirtyAbsolute.clear();
		return true;
	}

	takeStamps(): ReadonlyMap<number, number> {
		return this.stamps;
	}
}
