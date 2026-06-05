// String-key seam over Monaco so the provisioner is unit-testable without a real
// Monaco runtime. Keys are file:// URI strings.
export interface ModelHost {
	has(key: string): boolean;
	create(content: string, language: string, key: string): void;
	dispose(key: string): void;
}

export interface ProvisionRef {
	workspaceId: string;
	worktreeId: string;
	worktreeRoot: string | null;
}

export type ReadResult =
	| { kind: "text"; content: string }
	| { kind: "binary" }
	| { kind: "error" };

function basename(relFile: string): string {
	return relFile.split("/").pop() ?? relFile;
}

/**
 * Guarantees a resolvable Monaco model exists for a worktree file so Peek
 * Definition can render its preview. Owns only the models it creates, bounds
 * them with an LRU, and clears them on a worktree switch. Never touches models
 * it did not create (e.g. the viewer's inmemory model).
 */
export class ModelProvisioner {
	private readonly owned: string[] = []; // LRU order, oldest first
	private readonly ownedSet = new Set<string>();
	private readonly cap: number;
	private lastWorktreeId: string | null = null;

	constructor(
		private readonly host: ModelHost,
		private readonly toFileUri: (
			worktreeRoot: string,
			relFile: string,
		) => string,
		private readonly readFile: (
			ref: ProvisionRef,
			relFile: string,
		) => Promise<ReadResult>,
		private readonly languageForBasename: (basename: string) => string,
		opts?: { cap?: number },
	) {
		this.cap = opts?.cap ?? 50;
	}

	async ensureModel(ref: ProvisionRef, relFile: string): Promise<string | null> {
		if (!ref.worktreeRoot) return null;
		if (
			this.lastWorktreeId !== null &&
			this.lastWorktreeId !== ref.worktreeId
		) {
			this.disposeAll();
		}
		this.lastWorktreeId = ref.worktreeId;

		const key = this.toFileUri(ref.worktreeRoot, relFile);
		if (this.host.has(key)) {
			this.touch(key);
			return key;
		}
		let r: ReadResult;
		try {
			r = await this.readFile(ref, relFile);
		} catch {
			return null;
		}
		if (r.kind !== "text") return null;
		if (this.host.has(key)) {
			// A concurrent ensureModel created it while we awaited.
			this.touch(key);
			return key;
		}
		try {
			this.host.create(
				r.content,
				this.languageForBasename(basename(relFile)),
				key,
			);
		} catch {
			return this.host.has(key) ? key : null;
		}
		this.own(key);
		this.evict();
		return key;
	}

	disposeAll(): void {
		for (const key of this.owned) this.host.dispose(key);
		this.owned.length = 0;
		this.ownedSet.clear();
	}

	private own(key: string): void {
		this.ownedSet.add(key);
		this.owned.push(key);
	}

	private touch(key: string): void {
		if (!this.ownedSet.has(key)) return;
		const i = this.owned.indexOf(key);
		if (i >= 0) {
			this.owned.splice(i, 1);
			this.owned.push(key);
		}
	}

	private evict(): void {
		while (this.owned.length > this.cap) {
			const oldest = this.owned.shift();
			if (oldest !== undefined) {
				this.ownedSet.delete(oldest);
				this.host.dispose(oldest);
			}
		}
	}
}
