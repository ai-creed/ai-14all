import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktreePathResolver } from "../../../services/review/worktree-path-resolver";

describe("worktree-path-resolver", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "wpath-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("returns null for unknown paths", async () => {
		const resolver = await createWorktreePathResolver(() => []);
		expect(await resolver.resolve("/no/such/path")).toBeNull();
	});

	it("resolves the canonical path of a registered worktree", async () => {
		const real = join(dir, "repo-real");
		await mkdir(real);
		const resolver = await createWorktreePathResolver(() => [
			{ id: real, path: real },
		]);
		expect(await resolver.resolve(real)).toBe(real);
	});

	it("resolves a symlinked input to the canonical id", async () => {
		const real = join(dir, "repo-real");
		const link = join(dir, "repo-link");
		await mkdir(real);
		await symlink(real, link);
		const resolver = await createWorktreePathResolver(() => [
			{ id: real, path: real },
		]);
		expect(await resolver.resolve(link)).toBe(real);
	});

	it("refresh() picks up new worktrees", async () => {
		const repoA = join(dir, "a");
		const repoB = join(dir, "b");
		await mkdir(repoA);
		await mkdir(repoB);
		let registry = [{ id: repoA, path: repoA }];
		const resolver = await createWorktreePathResolver(() => registry);
		expect(await resolver.resolve(repoB)).toBeNull();
		registry = [...registry, { id: repoB, path: repoB }];
		await resolver.refresh();
		expect(await resolver.resolve(repoB)).toBe(repoB);
	});

	it("self-heals: resolves a worktree added since the last refresh without an explicit refresh()", async () => {
		// Reproduces the whisper-lens race: a repo is registered (its worktrees
		// list now includes the path) but the resolver's cache predates it because
		// the eager consumer (whisper poll) resolved before refresh() landed. The
		// resolver must re-list on a miss and find it, rather than report null.
		const repoA = join(dir, "a");
		const repoB = join(dir, "b");
		await mkdir(repoA);
		await mkdir(repoB);
		let registry = [{ id: repoA, path: repoA }];
		const resolver = await createWorktreePathResolver(() => registry);
		registry = [...registry, { id: repoB, path: repoB }];
		expect(await resolver.resolve(repoB)).toBe(repoB);
	});

	it("re-lists exactly once on a miss, then returns null for a genuinely unknown path", async () => {
		let calls = 0;
		const resolver = await createWorktreePathResolver(() => {
			calls++;
			return [];
		});
		const afterConstruct = calls; // construction performs one initial refresh
		expect(await resolver.resolve("/no/such/path")).toBeNull();
		// The self-heal re-lists once before giving up — bounded, not a loop.
		expect(calls).toBe(afterConstruct + 1);
	});

	describe("refresh throttling", () => {
		// Paths that don't exist on disk canonicalize to themselves, so the
		// resolver stays a pure map lookup — no real dirs, timers, or git needed.
		const virtualRepo = (name: string) => `/virtual/${name}`;

		it("a cache hit resolves without re-listing", async () => {
			const repo = virtualRepo("hit");
			let calls = 0;
			const resolver = await createWorktreePathResolver(() => {
				calls++;
				return [{ id: repo, path: repo }];
			});
			const afterConstruct = calls;
			expect(await resolver.resolve(repo)).toBe(repo);
			expect(await resolver.resolve(repo)).toBe(repo);
			expect(calls).toBe(afterConstruct);
		});

		it("repeated misses within the cooldown re-list exactly once and still return null", async () => {
			const t = { value: 0 };
			let calls = 0;
			const resolver = await createWorktreePathResolver(
				() => {
					calls++;
					return [];
				},
				{ now: () => t.value, refreshCooldownMs: 1000 },
			);
			const afterConstruct = calls;
			expect(await resolver.resolve(virtualRepo("miss-a"))).toBeNull();
			expect(await resolver.resolve(virtualRepo("miss-b"))).toBeNull();
			expect(await resolver.resolve(virtualRepo("miss-c"))).toBeNull();
			// The first miss pays the re-list; the rest are answered from the map.
			expect(calls).toBe(afterConstruct + 1);
		});

		it("a miss after the cooldown elapses re-lists and discovers a newly registered worktree", async () => {
			const t = { value: 0 };
			let calls = 0;
			const late = virtualRepo("late");
			let registry: { id: string; path: string }[] = [];
			const resolver = await createWorktreePathResolver(
				() => {
					calls++;
					return registry;
				},
				{ now: () => t.value, refreshCooldownMs: 1000 },
			);
			const afterConstruct = calls;
			// First miss re-lists (finds nothing) and arms the cooldown at t=0.
			expect(await resolver.resolve(late)).toBeNull();
			registry = [{ id: late, path: late }];
			// Inside the cooldown: no re-list, so the new repo is not seen yet.
			t.value = 500;
			expect(await resolver.resolve(late)).toBeNull();
			expect(calls).toBe(afterConstruct + 1);
			// Cooldown elapsed: the miss re-lists and the repo is discovered.
			t.value = 1500;
			expect(await resolver.resolve(late)).toBe(late);
			expect(calls).toBe(afterConstruct + 2);
		});

		it("explicit refresh() always re-lists and updates the cooldown timestamp", async () => {
			const t = { value: 0 };
			let calls = 0;
			const resolver = await createWorktreePathResolver(
				() => {
					calls++;
					return [];
				},
				{ now: () => t.value, refreshCooldownMs: 1000 },
			);
			const afterConstruct = calls;
			// Arm the cooldown via a miss at t=0.
			expect(await resolver.resolve(virtualRepo("miss"))).toBeNull();
			expect(calls).toBe(afterConstruct + 1);
			// Explicit refresh inside the cooldown must still re-list.
			t.value = 100;
			await resolver.refresh();
			expect(calls).toBe(afterConstruct + 2);
			// 1050ms after the miss-refresh but only 950ms after refresh(): a miss
			// must stay throttled, proving refresh() moved the timestamp forward.
			t.value = 1050;
			expect(await resolver.resolve(virtualRepo("miss-2"))).toBeNull();
			expect(calls).toBe(afterConstruct + 2);
		});

		it("a miss during an in-flight re-list rides it instead of fast-failing", async () => {
			// Reproduces the whisper-lens race the throttle introduced: listing is
			// async (git subprocesses), so a second miss can arrive while the first
			// miss's re-list is still in flight. The cooldown must not fast-fail
			// that second miss to null — the answer is milliseconds away on the
			// in-flight listing.
			const repo = virtualRepo("racy");
			let calls = 0;
			let release!: () => void;
			const gate = new Promise<void>((r) => {
				release = r;
			});
			const resolver = await createWorktreePathResolver(async () => {
				calls++;
				// Construction's initial populate is empty and fast — the repo is
				// "registered" only afterwards. Later re-lists block until released,
				// holding the refresh in flight while the second miss arrives.
				if (calls === 1) return [];
				await gate;
				return [{ id: repo, path: repo }];
			});
			// Both misses land while the map is empty; the first starts the
			// re-list, the second arrives inside the cooldown with it in flight.
			const first = resolver.resolve(repo);
			const second = resolver.resolve(repo);
			release();
			expect(await first).toBe(repo);
			expect(await second).toBe(repo);
			// One re-list served both misses — the storm-collapse the throttle
			// exists for is preserved.
			expect(calls).toBe(2);
		});
	});
});
