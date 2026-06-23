import { describe, it, expect, vi } from "vitest";
import { WorkspaceRegistryService } from "../../../services/workspace/workspace-registry-service";
import type { Repository } from "../../../shared/models/repository";

const repo = (id: string, root: string): Repository =>
	({
		id,
		name: id,
		rootPath: root,
		repoId: null,
	}) as Repository;

describe("WorkspaceRegistryService", () => {
	it("listRepositories returns every registered repository", () => {
		const svc = new WorkspaceRegistryService();
		svc.register({ workspaceId: "a", repository: repo("r1", "/a") });
		svc.register({ workspaceId: "b", repository: repo("r2", "/b") });
		const all = svc.listRepositories();
		expect(all.map((r) => r.rootPath).sort()).toEqual(["/a", "/b"]);
	});

	it("onChange fires on register", () => {
		const svc = new WorkspaceRegistryService();
		const listener = vi.fn();
		const off = svc.onChange(listener);
		svc.register({ workspaceId: "a", repository: repo("r1", "/a") });
		expect(listener).toHaveBeenCalledTimes(1);
		off();
		svc.register({ workspaceId: "b", repository: repo("r2", "/b") });
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("onChange fires when an existing entry's path is updated via re-register", () => {
		const svc = new WorkspaceRegistryService();
		svc.register({ workspaceId: "a", repository: repo("r1", "/old") });
		const listener = vi.fn();
		svc.onChange(listener);
		svc.register({ workspaceId: "a", repository: repo("r1", "/new") });
		expect(listener).toHaveBeenCalled();
	});
});

describe("WorkspaceRegistryService.listEntries", () => {
	it("returns workspaceId paired with each repository", () => {
		const svc = new WorkspaceRegistryService();
		const repository = repo("ai-14all", "/repo");
		svc.register({ workspaceId: "ws1", repository });
		expect(svc.listEntries()).toEqual([{ workspaceId: "ws1", repository }]);
	});
});
