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
});
