const EXT_ALLOW = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".py",
	".c",
	".cpp",
	".cc",
	".cxx",
	".h",
	".hpp",
]);
const IGNORED = [
	"node_modules",
	".git",
	"dist",
	"build",
	"out",
	".next",
	".superpowers",
	".ai-cortex",
];

export interface WatcherKeys {
	worktreePath: string;
}

interface ChokidarWatcher {
	on(ev: string, cb: (p: string) => void): ChokidarWatcher;
	close(): void;
}

export interface WorktreeWatcherOpts {
	chokidar: {
		watch(path: string, opts: unknown): ChokidarWatcher;
	};
	debounceMs: number;
	onBatch: (batch: { keys: WatcherKeys; changedFiles: string[] }) => void;
}

interface WatchState {
	close: () => void;
	pending: Set<string>;
	timer: ReturnType<typeof setTimeout> | null;
	keys: WatcherKeys;
}

export class WorktreeWatcher {
	private watchers = new Map<string, WatchState>();
	constructor(private readonly opts: WorktreeWatcherOpts) {}

	watch(keys: WatcherKeys): void {
		if (this.watchers.has(keys.worktreePath)) return;
		const w = this.opts.chokidar.watch(keys.worktreePath, {
			ignored: (p: string) => IGNORED.some((seg) => p.includes(`/${seg}/`)),
			ignoreInitial: true,
			persistent: true,
		});
		const state: WatchState = {
			close: () => w.close(),
			pending: new Set<string>(),
			timer: null,
			keys,
		};
		const onEvent = (p: string) => {
			const ext = p.slice(p.lastIndexOf("."));
			if (!EXT_ALLOW.has(ext)) return;
			if (IGNORED.some((seg) => p.includes(`/${seg}/`))) return;
			state.pending.add(p);
			if (state.timer) clearTimeout(state.timer);
			state.timer = setTimeout(() => {
				const changed = Array.from(state.pending);
				state.pending.clear();
				state.timer = null;
				this.opts.onBatch({ keys: state.keys, changedFiles: changed });
			}, this.opts.debounceMs);
		};
		w.on("add", onEvent).on("change", onEvent).on("unlink", onEvent);
		this.watchers.set(keys.worktreePath, state);
	}

	unwatch(keys: WatcherKeys): void {
		const s = this.watchers.get(keys.worktreePath);
		if (!s) return;
		if (s.timer) clearTimeout(s.timer);
		s.close();
		this.watchers.delete(keys.worktreePath);
	}

	dispose(): void {
		for (const s of this.watchers.values()) {
			if (s.timer) clearTimeout(s.timer);
			s.close();
		}
		this.watchers.clear();
	}
}
