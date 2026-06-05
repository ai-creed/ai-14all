import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ModelProvisioner,
	type ModelHost,
	type ProvisionRef,
	type ReadResult,
} from "../../../../src/features/code-nav/monaco/model-provisioner.js";

const ref: ProvisionRef = {
	workspaceId: "ws1",
	worktreeId: "/wt",
	worktreeRoot: "/wt",
};

function fakeHost() {
	const models = new Set<string>();
	const disposed: string[] = [];
	const created: Array<{ content: string; language: string; key: string }> = [];
	const host: ModelHost = {
		has: (k) => models.has(k),
		create: (content, language, k) => {
			models.add(k);
			created.push({ content, language, key: k });
		},
		dispose: (k) => {
			models.delete(k);
			disposed.push(k);
		},
	};
	return { host, models, disposed, created };
}

const toFileUri = (worktreeRoot: string, relFile: string) =>
	`file://${worktreeRoot}/${relFile}`;
const language = (basename: string) =>
	basename.endsWith(".ts") ? "typescript" : "plaintext";

describe("ModelProvisioner", () => {
	let read: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		read = vi.fn(
			async (_ref: ProvisionRef, _rel: string): Promise<ReadResult> => ({
				kind: "text",
				content: "x",
			}),
		);
	});

	it("creates a model with content + basename language; reuses on a second call", async () => {
		const { host, created } = fakeHost();
		const p = new ModelProvisioner(host, toFileUri, read, language);
		const k1 = await p.ensureModel(ref, "src/a.ts");
		expect(k1).toBe("file:///wt/src/a.ts");
		expect(created[0]).toMatchObject({ content: "x", language: "typescript" });
		const k2 = await p.ensureModel(ref, "src/a.ts");
		expect(k2).toBe(k1);
		expect(read).toHaveBeenCalledTimes(1); // reused
	});

	it("returns null on binary/error (no model created)", async () => {
		const { host, models } = fakeHost();
		read.mockResolvedValueOnce({ kind: "binary" });
		const p = new ModelProvisioner(host, toFileUri, read, language);
		expect(await p.ensureModel(ref, "logo.png")).toBeNull();
		read.mockResolvedValueOnce({ kind: "error" });
		expect(await p.ensureModel(ref, "gone.ts")).toBeNull();
		expect(models.size).toBe(0);
	});

	it("returns null when worktreeRoot is absent", async () => {
		const { host } = fakeHost();
		const p = new ModelProvisioner(host, toFileUri, read, language);
		expect(
			await p.ensureModel({ ...ref, worktreeRoot: null }, "src/a.ts"),
		).toBeNull();
	});

	it("evicts the oldest owned model beyond the cap", async () => {
		const { host, disposed } = fakeHost();
		const p = new ModelProvisioner(host, toFileUri, read, language, { cap: 2 });
		await p.ensureModel(ref, "a.ts");
		await p.ensureModel(ref, "b.ts");
		await p.ensureModel(ref, "c.ts");
		expect(disposed).toEqual(["file:///wt/a.ts"]);
	});

	it("never disposes a model it did not create", async () => {
		const { host, disposed } = fakeHost();
		host.create("y", "typescript", "inmemory://model/1");
		const p = new ModelProvisioner(host, toFileUri, read, language, { cap: 1 });
		await p.ensureModel(ref, "a.ts");
		await p.ensureModel(ref, "b.ts");
		p.disposeAll();
		expect(disposed).not.toContain("inmemory://model/1");
	});

	it("disposes all owned models when the active worktree changes", async () => {
		const { host, disposed } = fakeHost();
		const p = new ModelProvisioner(host, toFileUri, read, language);
		await p.ensureModel(ref, "a.ts");
		await p.ensureModel(
			{ workspaceId: "ws1", worktreeId: "/wt2", worktreeRoot: "/wt2" },
			"b.ts",
		);
		expect(disposed).toEqual(["file:///wt/a.ts"]); // old worktree's model gone
	});

	it("disposeAll disposes every owned model", async () => {
		const { host, disposed } = fakeHost();
		const p = new ModelProvisioner(host, toFileUri, read, language);
		await p.ensureModel(ref, "a.ts");
		await p.ensureModel(ref, "b.ts");
		p.disposeAll();
		expect(disposed.sort()).toEqual(["file:///wt/a.ts", "file:///wt/b.ts"]);
	});
});
