import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalWatchStateEvent } from "../../../../shared/contracts/events";
import { terminals } from "../../../lib/desktop-client";

// Tail cap on the retained watch-byte buffer used to render the pleat
// preview: 2 MiB of UTF-16 code units.
const BYTE_BUFFER_CAP = 2 * 1024 * 1024;

export type PhoneWatchChipState = {
	label: string | null;
	provider: string | null;
	since: number;
	cols: number | null;
	rows: number | null;
};

export type PhoneWatchPleatState = {
	from: number;
	to: number | null; // null while the watch is still active
	cols: number;
	rows: number;
};

export type UsePhoneWatchState = {
	chip: PhoneWatchChipState | null; // non-null exactly while frozen
	pleat: PhoneWatchPleatState | null;
	frozenRef: React.MutableRefObject<boolean>; // read inside the output handler
	captureWatchBytes: (data: string) => void; // identity-stable
	readPleatBytes: () => string; // identity-stable
	dismissPleat: () => void; // identity-stable
};

/**
 * Turns `terminal/watchState` events (Task 6's `terminals.onWatchState` /
 * `getWatchState`) into the R2 freeze/chip/pleat presentation state (child
 * spec §5/§6):
 *
 * - `phoneOwned: true` freezes the pane (`frozenRef.current = true`), sets the
 *   chip, and opens a pleat. A NEW watch (its `since` differs from the
 *   current pleat's `from`) resets the byte buffer; the SAME watch (same
 *   `since` — a geometry/rotation update, or a re-assert after a grace-period
 *   reclaim) only updates geometry and re-opens the pleat (`to` back to
 *   null) without touching the buffer.
 * - `phoneOwned: false` unfreezes, clears the chip, and closes the pleat
 *   (`to = Date.now()`) while retaining the buffer for the preview. A
 *   duplicate `ended` with no intervening owned event (the main process's
 *   grace-fires-after-reclaim path can emit it twice) is a no-op: it must not
 *   overwrite an already-closed pleat's `to` or touch the buffer.
 *
 * All returned functions and `frozenRef` are identity-stable (`useRef` /
 * `useCallback` with empty deps) because `TerminalPane`'s output subscription
 * mounts once per `session.id` and reads them from that one-time closure.
 */
export function usePhoneWatchState(sessionId: string): UsePhoneWatchState {
	const [chip, setChip] = useState<PhoneWatchChipState | null>(null);
	const [pleat, setPleat] = useState<PhoneWatchPleatState | null>(null);

	const frozenRef = useRef(false);
	const bufferRef = useRef("");
	// Mirrors `pleat` so applyEvent (registered once, in the effect below) can
	// decide "same watch vs. new watch" without depending on the `pleat` state
	// value in its closure.
	const pleatRef = useRef<PhoneWatchPleatState | null>(null);

	const applyEvent = useCallback(
		(ev: TerminalWatchStateEvent) => {
			if (ev.sessionId !== sessionId) return;

			if (ev.phoneOwned) {
				const current = pleatRef.current;
				const sameWatch = current !== null && current.from === ev.since;
				if (!sameWatch) {
					bufferRef.current = "";
				}
				const nextPleat: PhoneWatchPleatState = {
					from: ev.since,
					to: null,
					cols: ev.cols ?? current?.cols ?? 0,
					rows: ev.rows ?? current?.rows ?? 0,
				};
				pleatRef.current = nextPleat;
				setPleat(nextPleat);
				frozenRef.current = true;
				setChip({
					label: ev.label,
					provider: ev.provider,
					since: ev.since,
					cols: ev.cols,
					rows: ev.rows,
				});
				return;
			}

			// phoneOwned: false — unfreeze and close the pleat. Idempotent: a
			// duplicate `ended` (no intervening owned event) must not overwrite an
			// already-closed pleat's `to` or touch the buffer.
			frozenRef.current = false;
			setChip(null);
			const current = pleatRef.current;
			if (current === null || current.to !== null) return;
			const closed: PhoneWatchPleatState = { ...current, to: Date.now() };
			pleatRef.current = closed;
			setPleat(closed);
		},
		[sessionId],
	);

	useEffect(() => {
		let cancelled = false;
		// The getWatchState seed below is an async snapshot taken at mount; a
		// live event can arrive — and even fully resolve a watch (owned then
		// ended) — before that snapshot's promise settles. Once any live event
		// has been applied, the seed is stale and must be discarded rather than
		// clobbering state a real event already produced (see the "seed-vs-
		// live-event race" test).
		let sawLiveEvent = false;
		const unsubscribe = terminals.onWatchState((ev) => {
			sawLiveEvent = true;
			applyEvent(ev);
		});
		terminals
			.getWatchState(sessionId)
			.then((seed) => {
				if (cancelled || sawLiveEvent || seed === null) return;
				applyEvent(seed);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [sessionId, applyEvent]);

	const captureWatchBytes = useCallback((data: string) => {
		let buf = bufferRef.current + data;
		if (buf.length > BYTE_BUFFER_CAP) {
			buf = buf.slice(buf.length - BYTE_BUFFER_CAP);
		}
		bufferRef.current = buf;
	}, []);

	const readPleatBytes = useCallback(() => bufferRef.current, []);

	const dismissPleat = useCallback(() => {
		bufferRef.current = "";
		pleatRef.current = null;
		setPleat(null);
	}, []);

	return {
		chip,
		pleat,
		frozenRef,
		captureWatchBytes,
		readPleatBytes,
		dismissPleat,
	};
}
