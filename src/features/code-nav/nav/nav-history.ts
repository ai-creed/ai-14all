import type { CortexNavLocation } from "./cortex-uri.js";

interface Stacks {
	back: CortexNavLocation[];
	forward: CortexNavLocation[];
}

export class NavHistory {
	private byWorktree = new Map<string, Stacks>();
	constructor(private readonly opts: { capacity: number }) {}

	private get(wt: string): Stacks {
		let s = this.byWorktree.get(wt);
		if (!s) {
			s = { back: [], forward: [] };
			this.byWorktree.set(wt, s);
		}
		return s;
	}

	push(wt: string, loc: CortexNavLocation): void {
		const s = this.get(wt);
		s.back.push(loc);
		s.forward.length = 0;
		while (s.back.length > this.opts.capacity) s.back.shift();
	}

	back(wt: string): CortexNavLocation | null {
		const s = this.get(wt);
		const top = s.back.pop();
		if (!top) return null;
		const prev = s.back[s.back.length - 1] ?? null;
		if (prev) s.forward.push(top);
		return prev ?? top;
	}

	forward(wt: string): CortexNavLocation | null {
		const s = this.get(wt);
		const top = s.forward.pop();
		if (!top) return null;
		s.back.push(top);
		return top;
	}

	size(wt: string): number {
		return this.byWorktree.get(wt)?.back.length ?? 0;
	}

	clear(wt: string): void {
		this.byWorktree.delete(wt);
	}
}
