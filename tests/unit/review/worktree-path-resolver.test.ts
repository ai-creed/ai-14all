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
});
