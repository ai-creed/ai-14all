import type { ObservationInput } from "./store/observations.js";

export interface OutboxEvent {
	eventId: string;
	observation: ObservationInput;
}

/**
 * Cap on unacked events (spec §6). Reaching it is the explicit scope limit on
 * the at-least-once guarantee: delivery is assured only for events retained
 * within the cap, and an overflow drop is reported, never silent.
 */
export const OUTBOX_CAP = 500;

/**
 * Bounded, in-memory, insertion-ordered buffer of producer events awaiting a
 * worker `ack`. Electron-free so it is unit-testable; the host composes it and
 * replays `pending()` after every worker spawn.
 */
export class Outbox {
	private readonly buf = new Map<string, OutboxEvent>();
	private dropped = 0;

	constructor(
		private readonly cap: number = OUTBOX_CAP,
		private readonly onDrop?: (droppedTotal: number, eventId: string) => void,
	) {}

	add(event: OutboxEvent): void {
		this.buf.set(event.eventId, event);
		while (this.buf.size > this.cap) {
			const oldest = this.buf.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			this.buf.delete(oldest);
			this.dropped += 1;
			this.onDrop?.(this.dropped, oldest);
		}
	}

	ack(eventId: string): void {
		this.buf.delete(eventId);
	}

	/** Still-unacked events, oldest first — the replay list. */
	pending(): OutboxEvent[] {
		return [...this.buf.values()];
	}

	clear(): void {
		this.buf.clear();
	}

	get size(): number {
		return this.buf.size;
	}

	get droppedCount(): number {
		return this.dropped;
	}
}
