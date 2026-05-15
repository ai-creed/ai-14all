import { randomUUID } from "node:crypto";
import type { ReviewComment } from "../../shared/models/review-comment.js";
import type { ReviewCommentStore } from "./review-comment-store.js";

export type ChangeKind =
	| "created"
	| "updated"
	| "addressed"
	| "reopened"
	| "deleted"
	| "rebased";
export type ChangeListener = (kind: ChangeKind) => void;

export type CreateInput = Omit<
	ReviewComment,
	"id" | "createdAt" | "addressedAt" | "status"
>;

export class ReviewCommentService {
	private byWorktree = new Map<string, ReviewComment[]>();
	private listeners = new Set<ChangeListener>();

	constructor(private readonly store: ReviewCommentStore) {}

	async init(): Promise<void> {
		const all = await this.store.load();
		this.byWorktree.clear();
		for (const c of all) {
			const list = this.byWorktree.get(c.worktreeId) ?? [];
			list.push(c);
			this.byWorktree.set(c.worktreeId, list);
		}
	}

	listByWorktree(worktreeId: string): ReviewComment[] {
		return [...(this.byWorktree.get(worktreeId) ?? [])];
	}

	listOpenByWorktree(worktreeId: string): ReviewComment[] {
		return this.listByWorktree(worktreeId).filter((c) => c.status === "open");
	}

	async create(input: CreateInput): Promise<ReviewComment> {
		const c: ReviewComment = {
			...input,
			id: randomUUID(),
			status: "open",
			createdAt: new Date().toISOString(),
			addressedAt: null,
		};
		const list = this.byWorktree.get(c.worktreeId) ?? [];
		list.push(c);
		this.byWorktree.set(c.worktreeId, list);
		await this.persist();
		this.emit("created");
		return c;
	}

	async markAddressed(
		id: string,
	): Promise<
		{ ok: true } | { ok: false; error: "not_found" | "already_addressed" }
	> {
		const found = this.find(id);
		if (!found) return { ok: false, error: "not_found" };
		if (found.status === "addressed")
			return { ok: false, error: "already_addressed" };
		found.status = "addressed";
		found.addressedAt = new Date().toISOString();
		await this.persist();
		this.emit("addressed");
		return { ok: true };
	}

	async reopen(id: string): Promise<ReviewComment | null> {
		const found = this.find(id);
		if (!found) return null;
		found.status = "open";
		found.addressedAt = null;
		await this.persist();
		this.emit("reopened");
		return { ...found };
	}

	async update(
		id: string,
		patch: { body: string },
	): Promise<
		| { ok: true; comment: ReviewComment }
		| { ok: false; error: "not_found" | "not_open" | "empty_body" }
	> {
		const trimmed = patch.body.trim();
		if (trimmed.length === 0) return { ok: false, error: "empty_body" };
		const found = this.find(id);
		if (!found) return { ok: false, error: "not_found" };
		if (found.status !== "open") return { ok: false, error: "not_open" };
		found.body = trimmed;
		await this.persist();
		this.emit("updated");
		return { ok: true, comment: { ...found } };
	}

	async delete(id: string): Promise<boolean> {
		for (const [wid, list] of this.byWorktree.entries()) {
			const idx = list.findIndex((c) => c.id === id);
			if (idx >= 0) {
				list.splice(idx, 1);
				if (list.length === 0) this.byWorktree.delete(wid);
				await this.persist();
				this.emit("deleted");
				return true;
			}
		}
		return false;
	}

	async bulkRemoveAddressed(input: {
		worktreeId: string;
		ids: string[];
	}): Promise<
		| { ok: true; removed: number }
		| { ok: false; error: "worktree_mismatch" | "not_found" | "not_addressed" }
	> {
		if (input.ids.length === 0) return { ok: true, removed: 0 };
		const list = this.byWorktree.get(input.worktreeId) ?? [];
		const byId = new Map(list.map((c) => [c.id, c]));
		for (const id of input.ids) {
			const c = byId.get(id);
			if (!c) {
				const exists = this.find(id);
				return { ok: false, error: exists ? "worktree_mismatch" : "not_found" };
			}
			if (c.status !== "addressed")
				return { ok: false, error: "not_addressed" };
		}
		const idSet = new Set(input.ids);
		const remaining = list.filter((c) => !idSet.has(c.id));
		if (remaining.length === 0) this.byWorktree.delete(input.worktreeId);
		else this.byWorktree.set(input.worktreeId, remaining);
		await this.persist();
		this.emit("deleted");
		return { ok: true, removed: input.ids.length };
	}

	async removeByWorktree(worktreeId: string): Promise<void> {
		if (!this.byWorktree.has(worktreeId)) return;
		this.byWorktree.delete(worktreeId);
		await this.persist();
		this.emit("deleted");
	}

	async rebaseWorktreeIds(mapping: Map<string, string>): Promise<void> {
		if (mapping.size === 0) return;
		let changed = false;
		const next = new Map<string, ReviewComment[]>();
		for (const [wid, list] of this.byWorktree.entries()) {
			const target = mapping.get(wid) ?? wid;
			if (target !== wid) changed = true;
			const remapped = list.map((c) =>
				target === wid ? c : { ...c, worktreeId: target },
			);
			const merged = next.get(target) ?? [];
			next.set(target, merged.concat(remapped));
		}
		this.byWorktree = next;
		if (changed) {
			await this.persist();
			this.emit("rebased");
		}
	}

	onChange(listener: ChangeListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private find(id: string): ReviewComment | undefined {
		for (const list of this.byWorktree.values()) {
			const c = list.find((x) => x.id === id);
			if (c) return c;
		}
		return undefined;
	}

	private async persist(): Promise<void> {
		const all: ReviewComment[] = [];
		for (const list of this.byWorktree.values()) all.push(...list);
		await this.store.save(all);
	}

	private emit(kind: ChangeKind): void {
		for (const l of [...this.listeners]) {
			try {
				l(kind);
			} catch {
				/* swallow listener errors */
			}
		}
	}
}
